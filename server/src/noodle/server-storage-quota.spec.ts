import { ServerService } from 'src/services/server.service.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const current = vi.hoisted(() => vi.fn<() => number>());
vi.mock('src/noodle/s3-usage.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('src/noodle/s3-usage.js')>()),
  bucketUsage: () => ({ current }),
}));

describe(`${ServerService.name} storage quota (noodle)`, () => {
  let sut: ServerService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(ServerService));
    current.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it('reports the quota and the bucket usage instead of the local disk', async () => {
    vi.stubEnv('IMMICH_STORAGE_QUOTA_BYTES', String(500 * 1024 ** 3));
    current.mockReturnValue(125 * 1024 ** 3);

    await expect(sut.getStorage()).resolves.toEqual({
      diskAvailable: '375.0 GiB',
      diskAvailableRaw: 375 * 1024 ** 3,
      diskSize: '500.0 GiB',
      diskSizeRaw: 500 * 1024 ** 3,
      diskUsagePercentage: 25,
      diskUse: '125.0 GiB',
      diskUseRaw: 125 * 1024 ** 3,
    });
    expect(mocks.storage.checkDiskUsage).not.toHaveBeenCalled();
  });

  it('reports usage above the quota without going negative on available', async () => {
    vi.stubEnv('IMMICH_STORAGE_QUOTA_BYTES', '1000');
    current.mockReturnValue(1500);

    await expect(sut.getStorage()).resolves.toMatchObject({
      diskAvailableRaw: 0,
      diskSizeRaw: 1000,
      diskUseRaw: 1500,
      diskUsagePercentage: 150,
    });
  });

  it('falls back to the local disk without a quota', async () => {
    vi.stubEnv('IMMICH_STORAGE_QUOTA_BYTES', '');
    mocks.storage.checkDiskUsage.mockResolvedValue({ free: 200, available: 300, total: 500 });

    await expect(sut.getStorage()).resolves.toMatchObject({ diskSizeRaw: 500, diskUseRaw: 300 });
    expect(current).not.toHaveBeenCalled();
  });
});
