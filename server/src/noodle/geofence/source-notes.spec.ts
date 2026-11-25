import { NotesService, SourceConfig, ensureSourceTag, synchronizeSources } from 'src/noodle/geofence/source-notes.js';

const fixture = () => {
  const f = {
    asset: {
      id: 'seed',
      ownerId: 'owner',
      type: 'IMAGE',
      tags: [{ id: 'source-one', value: 'Standortquelle/Urlaub' }] as any[],
      exifInfo: { latitude: 48 as number | null, longitude: 16, description: 'Mein eigener Text.\n' },
    },
    albums: [{ id: 'one', albumName: '!Urlaub', albumUsers: [{ role: 'owner', user: { id: 'owner' } }] }],
    tags: [
      { id: 'root', name: 'Standortquelle', value: 'Standortquelle' },
      { id: 'source-one', name: 'Urlaub', value: 'Standortquelle/Urlaub' },
      { id: 'source-two', name: 'Zuhause', value: 'Standortquelle/Zuhause' },
    ],
    metadata: [] as any[],
    writes: [] as any[],
    config: { ownerId: 'owner', sourceTags: { one: 'source-one', two: 'source-two' } } as unknown as SourceConfig,
    // eslint-disable-next-line @typescript-eslint/require-await
    api: async (method: string, path: string, body?: any): Promise<any> => {
      if (path === '/tags' && method === 'GET') {
        return structuredClone(f.tags);
      }
      if (path.startsWith('/tags/') && path.endsWith('/assets') && method === 'PUT') {
        const id = path.split('/', 3)[2];
        f.asset.tags.push(f.tags.find((t) => t.id === id));
        return [{ id: 'seed', success: true }];
      }
      if (method === 'GET' && path === '/assets/seed') {
        return structuredClone(f.asset);
      }
      if (method === 'GET' && path === '/assets/seed/metadata') {
        return structuredClone(f.metadata);
      }
      if (method === 'GET' && path === '/albums?assetId=seed') {
        return structuredClone(f.albums);
      }
      f.writes.push({ method, path, body });
      if (method === 'PUT' && path === '/assets/seed/metadata') {
        for (const item of body.items) {
          f.metadata = f.metadata.filter((m) => m.key !== item.key);
          f.metadata.push(structuredClone(item));
        }
        return f.metadata;
      }
      if (method === 'PUT' && path === '/assets/seed') {
        f.asset.exifInfo.description = body.description;
        return f.asset;
      }
      throw new Error('Unexpected call ' + method + ' ' + path);
    },
    run: () => synchronizeSources(f.config, ['seed'], {}, (...args) => f.api(...args)),
  };
  return f;
};

describe('nearby album source notes', () => {
  it('adds the German note once; removing membership restores the original description exactly', async () => {
    const f = fixture();
    const original = f.asset.exifInfo.description;
    await f.run();
    const described = f.asset.exifInfo.description;
    expect(described.startsWith(original)).toBe(true);
    expect(described).toContain('bis zu 250 Meter');
    expect(described).toContain('„!Urlaub“');
    expect(described).not.toMatch(/geofence/i);
    expect(described).toContain('Entferne den Standortquellen Tag, wenn du das nicht mehr möchtest.');
    const writes = f.writes.length;

    await f.run();
    expect(f.asset.exifInfo.description).toBe(described);
    expect(f.writes.length).toBe(writes);

    f.albums = [];
    await f.run();
    expect(f.asset.exifInfo.description).toBe(original);
    expect(f.asset.tags.length).toBe(1);
  });

  it('removing ! removes the note but keeps all source tags', async () => {
    const f = fixture();
    await f.run();
    f.albums[0].albumName = 'Urlaub';
    await f.run();
    expect(f.asset.tags.length).toBe(1);
    expect(f.asset.exifInfo.description).toBe('Mein eigener Text.\n');
    f.albums[0].albumName = '!Urlaub';
    await f.run();
    expect(f.asset.exifInfo.description).toContain('!Urlaub');
  });

  it('an album rename changes the note without duplicating text', async () => {
    const f = fixture();
    await f.run();
    f.albums[0].albumName = '!Wochenende';
    await f.run();
    expect(f.asset.exifInfo.description).not.toContain('!Urlaub');
    expect(f.asset.exifInfo.description).toContain('!Wochenende');
  });

  it('nested tags isolate two albums containing the same image', async () => {
    const f = fixture();
    f.albums.push({ ...f.albums[0], id: 'two', albumName: '!Zuhause' });
    await f.run();
    expect(f.asset.exifInfo.description).not.toContain('!Zuhause');
    await synchronizeSources(f.config, ['seed'], { addSourceAlbumIds: ['two'] }, f.api);
    expect(f.asset.exifInfo.description).toContain('!Zuhause');
    f.albums[0].albumName = 'Urlaub';
    await f.run();
    expect(f.asset.exifInfo.description).not.toContain('!Urlaub');
    expect(f.asset.exifInfo.description).toContain('!Zuhause');
    expect(f.asset.tags.length).toBe(2);
  });

  it('untagged images never become sources from processing metadata', async () => {
    const f = fixture();
    f.asset.tags = [];
    f.metadata = [{ key: 'noodle-geofence-v1', value: { targets: [] } }];
    await f.run();
    expect(f.writes.length).toBe(0);
  });

  it('text the user added after the note survives cleanup', async () => {
    const f = fixture();
    await f.run();
    f.asset.exifInfo.description += '\nNoch ein eigener Satz.';
    f.albums = [];
    await f.run();
    expect(f.asset.exifInfo.description).toBe('Mein eigener Text.\n\nNoch ein eigener Satz.');
  });

  it('a failed description write can be retried without duplicate text', async () => {
    const f = fixture();
    const api = f.api;
    let failed = false;
    f.api = (method, path, body) => {
      if (!failed && method === 'PUT' && path === '/assets/seed') {
        failed = true;
        return Promise.reject(new Error('write failed'));
      }
      return api(method, path, body);
    };
    await expect(f.run()).rejects.toThrow('write failed');
    await f.run();
    expect(f.asset.exifInfo.description.split('Neue Bilder').length).toBe(2);
  });

  it('no Standortquelle tag always removes the managed note, preserving other tags', async () => {
    const f = fixture();
    await f.run();
    f.asset.tags = [{ id: 'unrelated', value: 'Familie' }];
    await f.run();
    expect(f.asset.exifInfo.description).toBe('Mein eigener Text.\n');
    expect(f.asset.tags[0].value).toBe('Familie');
  });

  it('missing GPS shows a simple explanation; other accounts are untouched', async () => {
    const f = fixture();
    await f.run();
    f.asset.exifInfo.latitude = null;
    await f.run();
    expect(f.asset.exifInfo.description).toContain('Diesem Bild fehlt ein Ort.');
    f.asset.ownerId = 'other';
    f.writes = [];
    await f.run();
    expect(f.writes.length).toBe(0);
  });

  it('only a manual album addition attaches its nested source tag', async () => {
    const f = fixture();
    f.asset.tags = [];
    await synchronizeSources(f.config, ['seed'], { addSourceAlbumIds: [] }, f.api);
    expect(f.asset.tags.length).toBe(0);
    await synchronizeSources(f.config, ['seed'], { addSourceAlbumIds: ['one'] }, f.api);
    expect(f.asset.tags[0].id).toBe('source-one');
  });

  it('an album rename keeps the nested tag ID and other mappings under a config row lock', async () => {
    const f = fixture();
    let locked = false;
    let saved: any;
    const config = { ...f.config, apiUrl: 'https://photos.quickme.at/api', apiKey: 'mock' };
    const select = {
      select: () => select,
      where: () => select,
      forUpdate: () => {
        locked = true;
        return select;
      },
      executeTakeFirstOrThrow: () => Promise.resolve({ config }),
    };
    const update = {
      set: (body: any) => {
        saved = body.config;
        return update;
      },
      where: () => update,
      execute: () => Promise.resolve(),
    };
    const service = {
      workflowRepository: {
        db: {
          transaction: () => ({
            execute: (fn: any) => fn({ selectFrom: () => select, updateTable: () => update }),
          }),
        },
      },
    } as unknown as NotesService;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((url, options) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => {
          if (options?.method === 'GET') {
            return Promise.resolve(f.tags);
          }
          expect(String(url).endsWith('/tags/source-one')).toBe(true);
          const name = JSON.parse(options?.body as string).name;
          return Promise.resolve({ id: 'source-one', name, value: 'Standortquelle/' + name });
        },
      } as Response),
    );
    try {
      const next = await ensureSourceTag(
        service,
        { service, config, stepId: 'step', assetIds: [] },
        {
          ...f.albums[0],
          albumName: '!Wochenende',
        },
      );
      expect(locked).toBe(true);
      expect(next.sourceTags?.one).toBe('source-one');
      expect(saved.sourceTags.two).toBe('source-two');
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('tags a direct upload before GPS is ready and refreshes the note when metadata arrives', async () => {
    const f = fixture();
    f.asset.tags = [];
    f.asset.exifInfo.latitude = null;
    await synchronizeSources(f.config, ['seed'], { addSourceAlbumIds: ['one'] }, f.api);
    expect(f.asset.tags[0].id).toBe('source-one');
    expect(f.asset.exifInfo.description).toContain('Diesem Bild fehlt ein Ort.');
    expect(f.asset.exifInfo.description).toContain(
      'Entferne den Standortquellen Tag, wenn du das nicht mehr möchtest.',
    );
    f.asset.exifInfo.latitude = 48;
    await f.run();
    expect(f.asset.exifInfo.description).not.toContain('Diesem Bild fehlt ein Ort.');
    expect(f.asset.exifInfo.description).toContain('Neue Bilder aus der Nähe');
  });
});
