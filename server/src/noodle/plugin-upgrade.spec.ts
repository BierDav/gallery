import {
  CompiledQuery,
  DatabaseConnection,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PluginRepository } from 'src/repositories/plugin.repository.js';
import type { DB } from 'src/schema/index.js';

// Records the SQL it is asked to run and returns no rows.
class CapturingDriver extends DummyDriver {
  constructor(private queries: string[]) {
    super();
  }

  acquireConnection(): Promise<DatabaseConnection> {
    return Promise.resolve({
      executeQuery: (query: CompiledQuery) => {
        this.queries.push(query.sql);
        return Promise.resolve({ rows: [] });
      },
      // eslint-disable-next-line require-yield, @typescript-eslint/require-await
      async *streamQuery() {
        return;
      },
    });
  }
}

describe('PluginRepository.upsert (noodle)', () => {
  it('upgrades a plugin in place by name, so its IDs and workflows survive a version change', async () => {
    const queries: string[] = [];
    const db = new Kysely<DB>({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => new CapturingDriver(queries),
        createIntrospector: (kysely) => new PostgresIntrospector(kysely),
        createQueryCompiler: () => new PostgresQueryCompiler(),
      },
    });
    const logger = { setContext: vi.fn() } as unknown as LoggingRepository;
    const sut = new PluginRepository(db, logger);

    // The offline driver returns no rows, so the upsert stops after the insert.
    await expect(
      sut.upsert(
        {
          name: 'noodle-geofence',
          version: '1.2.1',
          title: 'Nearby albums',
          description: '',
          author: 'Noodle Gallery',
          wasmBytes: Buffer.from(''),
          sha256hash: Buffer.from(''),
          templates: [],
        },
        [],
      ),
    ).rejects.toThrow();

    const insert = queries.find((sql) => sql.startsWith('insert into "plugin"'));
    expect(insert).toContain('on conflict ("name") do update set');
  });
});
