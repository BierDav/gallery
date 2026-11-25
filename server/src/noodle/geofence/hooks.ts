import type { AuthDto } from 'src/dtos/auth.dto.js';
import {
  NotesService,
  NotesTask,
  finishAlbumChange,
  finishAssetChange,
  finishTagChange,
  prepareAlbumChange,
  prepareAssetChange,
  prepareTagChange,
} from 'src/noodle/geofence/source-notes.js';

const hooks = {
  album: { prepare: prepareAlbumChange, finish: finishAlbumChange },
  asset: { prepare: prepareAssetChange, finish: finishAssetChange },
  tag: { prepare: prepareTagChange, finish: finishTagChange },
};

type Edit = (this: NotesService, auth: AuthDto, ...args: unknown[]) => Promise<unknown>;

/**
Keep "nearby album" source tags and image notes in step with these service
edits (see source-notes.ts). Each edit itself always runs and its result is
returned unchanged; a failed note update is only logged, and the next album
or tag edit retries it.

This wraps the prototype rather than decorating the methods: a method
decorator would make TypeScript emit parameter metadata for the zod DTO
types, which are not runtime values.
*/
export function syncNearbyAlbumNotes<T extends object>(
  service: abstract new (...args: never[]) => T,
  kind: keyof typeof hooks,
  methods: Array<keyof T & string>,
) {
  const { prepare, finish } = hooks[kind];
  const prototype = service.prototype as Record<string, Edit>;
  for (const method of methods) {
    const original = prototype[method];
    if (typeof original !== 'function') {
      throw new TypeError(`${service.name}.${method} is not a method`);
    }
    prototype[method] = async function (this: NotesService, auth: AuthDto, ...args: unknown[]) {
      let tasks: NotesTask[] = [];
      try {
        tasks = await prepare(this, auth, method, args);
      } catch {
        this.logger.warn('Could not prepare nearby album image notes');
      }
      const result = await original.call(this, auth, ...args);
      try {
        await finish(tasks, result);
      } catch {
        this.logger.warn('Could not update nearby album image notes');
      }
      return result;
    };
  }
}
