/**
Server side of the "nearby albums" workflow plugin (noodle/plugins/geofence).

Albums whose name starts with `!` collect new uploads within 250 m of their
manually added images. The WASM plugin does the sorting; Immich has no
workflow trigger for album membership or tag edits, so these hooks keep each
album's `Standortquelle/<album>` tag and the German explanatory note in the
image description in step with album, tag and asset edits as they happen.

Everything runs through the workflow's own runtime API key over the public
API, exactly as the plugin does, so the same permission checks apply.
*/
import type { Kysely } from 'kysely';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import type { DB } from 'src/schema/index.js';

export const SOURCE_TAG = 'Standortquelle';
export const DESCRIPTION_KEY = 'noodle-geofence-description-v1';
export const PLUGIN_NAME = 'noodle-geofence';
export const METHOD_NAME = 'sortUpload';
export const API_URL = 'https://photos.quickme.at/api';

type Json = any;
export type Api = (method: string, path: string, body?: unknown) => Promise<Json>;

export interface SourceConfig {
  apiUrl: string;
  apiKey: string;
  ownerId: string;
  enabledAfter?: string;
  sourceTags?: Record<string, string>;
}

interface AlbumLike {
  id: string;
  albumName: string;
  albumUsers?: Array<{ role?: string; user?: { id?: string } }>;
}

/** The parts of a service (BaseService subclass) the hooks use. */
export interface NotesService {
  logger: { warn(message: string): void };
  workflowRepository: {
    search(dto: { userId?: string; enabled?: boolean }): Promise<Array<{ id: string; steps: Json[] }>>;
    getForWorkflowRun(id: string): Promise<{ steps: Json[] } | undefined>;
  };
  tagRepository: { getAssetIdsByTagId(tagId: string): Promise<string[]> };
  assetRepository: { getForUpdateTags(id: string): Promise<{ tags?: Array<{ value?: string }> } | undefined> };
  /** AlbumService only (private there). */
  findOrFail?(id: string, userId: string): Promise<AlbumLike>;
}

export interface NotesTask {
  service: NotesService;
  config: SourceConfig;
  stepId?: string;
  assetIds: string[];
  albums?: AlbumLike[];
  method?: string;
  args?: unknown[];
  automatic?: boolean;
}

const owner = (album: AlbumLike) =>
  (album.albumUsers?.find((u) => u.role === 'owner') ?? album.albumUsers?.[0])?.user?.id;
const active = (album: AlbumLike, ownerId: string) => album.albumName.startsWith('!') && owner(album) === ownerId;
const isImage = (asset: Json) => asset.type === 'IMAGE' && !asset.isTrashed && asset.visibility !== 'locked';
const hasPoint = (asset: Json) =>
  isImage(asset) &&
  Number.isFinite(asset.exifInfo?.latitude) &&
  Math.abs(asset.exifInfo.latitude) <= 90 &&
  Number.isFinite(asset.exifInfo?.longitude) &&
  Math.abs(asset.exifInfo.longitude) <= 180;
const sourceTag = (tag: Json) => !!tag.value?.startsWith(SOURCE_TAG + '/');
const label = (album: AlbumLike) => album.albumName.replace(/^!/, '').replaceAll('/', '∕') || '(Ohne Namen)';

// The workflow repository keeps its Kysely instance private; the config row
// must be locked in the same database, so reach for it rather than open another.
const database = (service: NotesService) => (service.workflowRepository as unknown as { db: Kysely<DB> }).db;

export function httpApi(config: SourceConfig): Api {
  if (config.apiUrl !== API_URL || !config.apiKey) {
    throw new Error('Invalid source configuration');
  }
  return async (method, path, body) => {
    const response = await fetch(config.apiUrl + path, {
      method,
      headers: { 'x-api-key': config.apiKey, 'Content-Type': 'application/json' },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const error = new Error('Source API returned HTTP ' + response.status) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  };
}

function checkTagResult(result: Json[], id: string) {
  const item = result.find((row) => row.id === id);
  if (!item || (!item.success && item.error !== 'duplicate')) {
    throw new Error('Source tag membership update failed');
  }
}

function includesTag(asset: Json, tag: Json) {
  return !!tag && !!asset.tags?.some((t: Json) => t.id === tag.id || t.value?.startsWith(tag.value + '/'));
}

export const sourceNote = (albumName: string, located: boolean) =>
  located
    ? `Neue Bilder aus der Nähe dieses Ortes (bis zu 250 Meter) kommen automatisch in das Album „${albumName}“. Entferne den Standortquellen Tag, wenn du das nicht mehr möchtest.`
    : `Diesem Bild fehlt ein Ort. Füge einen Ort hinzu, damit neue Bilder aus der Nähe (bis zu 250 Meter) automatisch in das Album „${albumName}“ kommen. Entferne den Standortquellen Tag, wenn du das nicht mehr möchtest.`;

export async function synchronizeSources(
  config: SourceConfig,
  assetIds: string[],
  options: { addSourceAlbumIds?: string[] } = {},
  api: Api = httpApi(config),
) {
  const { addSourceAlbumIds = [] } = options;
  const tags = ((await api('GET', '/tags')) as Json[]).filter((tag) => sourceTag(tag));
  for (const id of new Set(assetIds)) {
    const path = '/assets/' + encodeURIComponent(id);
    let asset: Json;
    try {
      asset = await api('GET', path);
    } catch (error: any) {
      if (error.status === 404) {
        continue;
      }
      throw error;
    }
    if (asset.ownerId !== config.ownerId) {
      continue;
    }
    const albums = ((await api('GET', '/albums?assetId=' + encodeURIComponent(id))) as AlbumLike[])
      .filter((album) => active(album, config.ownerId))
      .toSorted((a, b) => a.id.localeCompare(b.id));
    let attached = false;
    for (const album of albums) {
      const tag = tags.find((t) => t.id === config.sourceTags?.[album.id]);
      if (!(tag && isImage(asset) && addSourceAlbumIds.includes(album.id)) || includesTag(asset, tag)) {
        continue;
      }

      checkTagResult(await api('PUT', '/tags/' + tag.id + '/assets', { ids: [id] }), id);
      attached = true;
    }
    // Metadata extraction may finish while tagging the direct upload.
    if (attached) {
      asset = await api('GET', path);
    }
    // Tags are never removed automatically. Current album membership and its !
    // decide whether an existing source tag is active for that album.
    const sources = isImage(asset)
      ? albums.filter((a) =>
          includesTag(
            asset,
            tags.find((t) => t.id === config.sourceTags?.[a.id]),
          ),
        )
      : [];
    const metadata = (await api('GET', path + '/metadata')) as Json[];
    const previous = metadata.find((row) => row.key === DESCRIPTION_KEY)?.value;
    const original: string = asset.exifInfo?.description ?? '';
    const fragments: string[] = (previous?.fragments ?? []).filter(
      (f: unknown) => typeof f === 'string' && f.length > 0,
    );
    let base = original;
    for (const fragment of fragments) {
      const i = base.lastIndexOf(fragment);
      if (i !== -1) {
        base = base.slice(0, i) + base.slice(i + fragment.length);
      }
    }
    const note = sources.map((album) => sourceNote(album.albumName, hasPoint(asset))).join('\n\n');
    const fragment = note ? (base ? '\n\n' : '') + note : '';
    const description = base + fragment;
    if (description === original) {
      continue;
    }
    const known = [...new Set([...fragments, ...(fragment ? [fragment] : [])])];
    await api('PUT', path + '/metadata', { items: [{ key: DESCRIPTION_KEY, value: { fragments: known } }] });
    await api('PUT', path, { description });
  }
}

async function albumMembers(api: Api, id: string) {
  const ids: string[] = [];
  const visited = new Set<string>();
  let cursor: string | undefined;
  do {
    const result = await api('POST', '/search/metadata', {
      albumIds: [id],
      type: 'IMAGE',
      size: 1000,
      ...(cursor && { cursor }),
    });
    const page = result.assets;
    ids.push(...page.items.map((asset: Json) => asset.id));
    cursor = page.nextCursor ?? undefined;
    if (cursor && visited.has(cursor)) {
      throw new Error('Repeated source search cursor');
    }
    if (cursor) {
      visited.add(cursor);
    }
  } while (cursor);
  return ids;
}

const isSourceStep = (step: Json, ownerId: string) =>
  step.methodName === METHOD_NAME && step.config?.ownerId === ownerId;

/** Cheap check before any per-album work: is the plugin configured anywhere? */
async function anyConfiguration(service: NotesService) {
  const workflows = (await service.workflowRepository.search({ enabled: true })) ?? [];
  return workflows.some((w) =>
    w.steps?.some((s) => s.enabled && s.pluginName === PLUGIN_NAME && s.methodName === METHOD_NAME),
  );
}

async function configuration(service: NotesService, ownerId: string) {
  const workflows = (await service.workflowRepository.search({ userId: ownerId, enabled: true })) ?? [];
  const workflow = workflows.find((w) =>
    w.steps.some((s) => s.enabled && s.pluginName === PLUGIN_NAME && isSourceStep(s, ownerId)),
  );
  if (!workflow) {
    return;
  }
  const run = await service.workflowRepository.getForWorkflowRun(workflow.id);
  const step = run?.steps.find((s) => isSourceStep(s, ownerId));
  return step && { config: step.config as SourceConfig, stepId: step.id as string };
}

const keyIds = new Map<string, Promise<string>>();
/** Requests made with the workflow's own runtime key are the plugin's, i.e. automatic. */
async function ownRequest(auth: AuthDto, config: SourceConfig, api: Api) {
  if (!auth.apiKey) {
    return false;
  }
  if (!keyIds.has(config.apiKey)) {
    keyIds.set(
      config.apiKey,
      api('GET', '/api-keys/me')
        .then((key) => key.id as string)
        .catch((error) => {
          keyIds.delete(config.apiKey);
          throw error;
        }),
    );
  }
  return auth.apiKey.id === (await keyIds.get(config.apiKey));
}

// The config maps album identity to tag identity, never image source membership.
// Lock the config row so two server pods cannot overwrite each other's mappings.
export async function ensureSourceTag(service: NotesService, task: NotesTask, album: AlbumLike): Promise<SourceConfig> {
  return database(service)
    .transaction()
    .execute(async (tx) => {
      const row = await tx
        .selectFrom('workflow_step')
        .select('config')
        .where('id', '=', task.stepId!)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const config = row.config as unknown as SourceConfig;
      const api = httpApi(config);
      const tags = (await api('GET', '/tags')) as Json[];
      let tag = tags.find((t) => t.id === config.sourceTags?.[album.id] && sourceTag(t));
      const used = new Set(
        Object.entries(config.sourceTags ?? {})
          .filter(([id]) => id !== album.id)
          .map(([, id]) => id),
      );
      let name = label(album);
      if (tags.some((t) => t.value === SOURCE_TAG + '/' + name && t.id !== tag?.id && (tag || used.has(t.id)))) {
        name += ' (' + album.id + ')';
      }
      if (tag && tag.name !== name) {
        // Only an album rename changes the display name; the tag ID is retained.
        tag = await api('PUT', '/tags/' + tag.id, { name });
      } else if (!tag) {
        tag = ((await api('PUT', '/tags', { tags: [SOURCE_TAG + '/' + name] })) as Json[]).find(
          (t) => t.value === SOURCE_TAG + '/' + name,
        );
      }
      if (!tag) {
        throw new Error('Album source tag could not be created');
      }
      const next: SourceConfig = { ...config, sourceTags: { ...config.sourceTags, [album.id]: tag.id } };
      await tx
        .updateTable('workflow_step')
        .set({ config: next as never })
        .where('id', '=', task.stepId!)
        .execute();
      return next;
    });
}

export async function prepareAlbumChange(service: NotesService, auth: AuthDto, method: string, args: Json[]) {
  if (!auth.user?.id || auth.sharedLink || !(await anyConfiguration(service))) {
    return [];
  }
  const albumIds: string[] = method === 'create' ? [] : method === 'addAssetsToAlbums' ? args[0].albumIds : [args[0]];
  const albums: AlbumLike[] = [];
  for (const id of albumIds) {
    try {
      albums.push(await service.findOrFail!(id, auth.user.id));
    } catch {
      // the actual mutation validates access
    }
  }
  // Include disabled albums with existing tags when they are renamed/deleted.
  const owners = method === 'create' ? [auth.user.id] : albums.map((album) => owner(album));
  const tasks: NotesTask[] = [];
  for (const ownerId of new Set(owners.filter((id): id is string => !!id))) {
    const entry = await configuration(service, ownerId);
    if (!entry) {
      continue;
    }
    const { config } = entry;
    const api = httpApi(config);
    const automatic = await ownRequest(auth, config, api);
    const relevant = albums.filter(
      (a) =>
        owner(a) === ownerId &&
        (a.albumName.startsWith('!') ||
          config.sourceTags?.[a.id] ||
          (method === 'update' && args[1].albumName?.startsWith('!'))),
    );
    let ids: string[];
    if (method === 'create') {
      ids = args[0].albumName?.startsWith('!') ? (args[0].assetIds ?? []) : [];
    } else if (method === 'update' || method === 'delete') {
      ids = [];
      for (const album of relevant) {
        ids.push(...(await albumMembers(api, album.id)));
      }
    } else {
      ids = relevant.length > 0 ? (method === 'addAssetsToAlbums' ? args[0].assetIds : args[1].ids) : [];
    }
    // Create empty enabled albums' tag too, before any images are added.
    if (
      ids.length > 0 ||
      (method === 'create' && args[0].albumName?.startsWith('!')) ||
      (method === 'update' && relevant.length > 0)
    ) {
      tasks.push({ service, ...entry, assetIds: ids, albums: relevant, method, args, automatic });
    }
  }
  return tasks;
}

// Bound concurrent note transactions per process, leaving DB connections free
// for the authenticated HTTP calls made while an advisory lock is held.
let noteQueue: Promise<unknown> = Promise.resolve();
async function synchronizeLocked(
  service: NotesService,
  config: SourceConfig,
  ids: string[],
  options: { addSourceAlbumIds?: string[] } = {},
) {
  const result = noteQueue.then(async () => {
    for (const id of new Set(ids)) {
      await database(service)
        .transaction()
        .execute(async (tx) => {
          await tx
            .selectNoFrom((eb) =>
              eb
                .fn('pg_advisory_xact_lock', [
                  eb.fn('hashtextextended', [eb.val('noodle-source-note:' + id), eb.val(0)]),
                ])
                .as('sourceNoteLock'),
            )
            .execute();
          await synchronizeSources(config, [id], options);
        });
    }
  });
  noteQueue = result.catch(() => {});
  return result;
}

export async function finishAlbumChange(tasks: NotesTask[], result: Json) {
  for (const task of tasks) {
    const { service, method, automatic } = task;
    let config = task.config;
    const api = httpApi(config);
    const addSourceAlbumIds: string[] = [];
    const ids = method === 'create' ? [result.id] : (task.albums ?? []).map((a) => a.id);
    for (const id of ids) {
      let album: AlbumLike;
      try {
        album = await api('GET', '/albums/' + id);
      } catch (error: any) {
        if (error.status === 404) {
          continue;
        }
        throw error;
      }
      const hadTag = !!config.sourceTags?.[id];
      // Disabled albums keep their tag. A real rename still renames it.
      if (owner(album) !== config.ownerId || (!album.albumName.startsWith('!') && !hadTag)) {
        continue;
      }
      if (method !== 'delete' && !automatic) {
        config = await ensureSourceTag(service, { ...task, config }, album);
      }
      if (
        !automatic &&
        album.albumName.startsWith('!') &&
        (method === 'create' ||
          method === 'addAssets' ||
          method === 'addAssetsToAlbums' ||
          (method === 'update' && !hadTag && !task.albums?.find((a) => a.id === id)?.albumName.startsWith('!')))
      ) {
        addSourceAlbumIds.push(id);
      }
    }
    await synchronizeLocked(service, config, task.assetIds, { addSourceAlbumIds });
  }
}

export async function prepareTagChange(service: NotesService, auth: AuthDto, method: string, args: Json[]) {
  if (!auth.user?.id || auth.sharedLink || !(await anyConfiguration(service))) {
    return [];
  }
  const entry = await configuration(service, auth.user.id);
  if (!entry) {
    return [];
  }
  const { config } = entry;
  const api = httpApi(config);
  if (await ownRequest(auth, config, api)) {
    return [];
  }
  const tags = (await api('GET', '/tags')) as Json[];
  const relevant = (t: Json) => t.value === SOURCE_TAG || sourceTag(t);
  let ids: string[];
  if (method === 'bulkTagAssets') {
    ids = tags.some((t) => relevant(t) && args[0].tagIds.includes(t.id)) ? args[0].assetIds : [];
  } else if (method === 'addAssets' || method === 'removeAssets') {
    ids = tags.some((t) => t.id === args[0] && relevant(t)) ? args[1].ids : [];
  } else {
    const tag = tags.find((t) => t.id === args[0]);
    const affected =
      tag && (relevant(tag) || (method === 'update' && args[1].name === SOURCE_TAG))
        ? tags.filter((t) => t.id === tag.id || t.value.startsWith(tag.value + '/'))
        : [];
    ids = [];
    for (const t of affected) {
      ids.push(...(await service.tagRepository.getAssetIdsByTagId(t.id)));
    }
  }
  return ids.length > 0 ? [{ service, config, assetIds: ids }] : [];
}

export async function finishTagChange(tasks: NotesTask[]) {
  for (const { service, config, assetIds } of tasks) {
    await synchronizeLocked(service, config, assetIds);
  }
}

export async function prepareAssetChange(service: NotesService, auth: AuthDto, method: string, args: Json[]) {
  if (!auth.user?.id || auth.sharedLink || !(await anyConfiguration(service))) {
    return [];
  }
  const entry = await configuration(service, auth.user.id);
  if (!entry || (await ownRequest(auth, entry.config, httpApi(entry.config)))) {
    return [];
  }
  return [{ service, config: entry.config, assetIds: method === 'update' ? [args[0]] : args[0].ids }];
}

export const finishAssetChange = finishTagChange;

export async function synchronizeAfterMetadata(service: NotesService, userId: string, assetId: string) {
  const asset = await service.assetRepository.getForUpdateTags(assetId);
  if (!asset?.tags?.some((t) => sourceTag(t))) {
    return;
  }
  const entry = await configuration(service, userId);
  if (entry) {
    await synchronizeLocked(service, entry.config, [assetId]);
  }
}
