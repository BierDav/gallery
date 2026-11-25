import { BucketUsageCache, getStorageQuotaBytes } from 'src/noodle/s3-usage.js';

describe('noodle S3 usage', () => {
  describe(getStorageQuotaBytes.name, () => {
    it('is off without IMMICH_STORAGE_QUOTA_BYTES', () => {
      expect(getStorageQuotaBytes({})).toBe(0);
    });

    it('reads the quota in bytes', () => {
      expect(getStorageQuotaBytes({ IMMICH_STORAGE_QUOTA_BYTES: '536870912000' })).toBe(536_870_912_000);
    });

    it('ignores garbage', () => {
      expect(getStorageQuotaBytes({ IMMICH_STORAGE_QUOTA_BYTES: 'lots' })).toBe(0);
    });
  });

  describe(BucketUsageCache.name, () => {
    let cache: BucketUsageCache | undefined;
    afterEach(() => cache?.stop());

    it('answers at once with the last figure and refreshes in the background', async () => {
      let now = 1_000_000;
      const sum = vi.fn().mockResolvedValue(42);
      cache = new BucketUsageCache(sum, undefined, 60_000, () => now);

      expect(cache.current()).toBe(0);
      expect(sum).toHaveBeenCalledTimes(1);
      await cache.refresh();
      expect(cache.current()).toBe(42);
      expect(sum).toHaveBeenCalledTimes(1);

      now += 60_000;
      sum.mockResolvedValue(50);
      expect(cache.current()).toBe(42);
      await cache.refresh();
      expect(cache.current()).toBe(50);
      expect(sum).toHaveBeenCalledTimes(2);
    });

    it('runs one walk at a time', async () => {
      let resolve!: (value: number) => void;
      const sum = vi.fn(() => new Promise<number>((r) => (resolve = r)));
      cache = new BucketUsageCache(sum, undefined, 60_000, () => 0);

      const first = cache.refresh();
      const second = cache.refresh();
      expect(sum).toHaveBeenCalledTimes(1);
      resolve(7);
      await expect(first).resolves.toBe(7);
      await expect(second).resolves.toBe(7);
    });

    it('keeps the last figure and reports the error when a walk fails', async () => {
      const onError = vi.fn();
      const sum = vi.fn().mockResolvedValueOnce(9).mockRejectedValueOnce(new Error('S3 down'));
      cache = new BucketUsageCache(sum, onError, 60_000, () => 0);

      await cache.refresh();
      await expect(cache.refresh()).resolves.toBe(9);
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
