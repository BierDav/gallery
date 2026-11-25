import { isImplausibleStatfs, parseDfOutput } from 'src/noodle/disk-usage.js';

describe('noodle disk usage', () => {
  describe(isImplausibleStatfs.name, () => {
    it('trusts an ordinary 4 KiB filesystem', () => {
      expect(isImplausibleStatfs({ blocks: 26_214_400, bfree: 1, bavail: 1, frsize: 4096 })).toBe(false);
    });

    it('distrusts the 1 MiB block size virtiofs reports', () => {
      expect(isImplausibleStatfs({ blocks: 10_000_000, bfree: 1, bavail: 1, frsize: 1_048_576 })).toBe(true);
    });

    it('distrusts a zero fragment size', () => {
      expect(isImplausibleStatfs({ blocks: 10_000_000, bfree: 1, bavail: 1, frsize: 0 })).toBe(true);
    });

    it('distrusts a volume smaller than 1 GiB', () => {
      expect(isImplausibleStatfs({ blocks: 1000, bfree: 1, bavail: 1, frsize: 4096 })).toBe(true);
    });
  });

  describe(parseDfOutput.name, () => {
    it('reads total and available bytes from df -B1', () => {
      const output = [
        'Filesystem        1B-blocks          Used     Available Use% Mounted on',
        'seaweedfs:/x 150323855360 42949672960 107374182400  29% /data',
      ].join('\n');
      expect(parseDfOutput(output)).toEqual({
        total: 150_323_855_360,
        available: 107_374_182_400,
        free: 107_374_182_400,
      });
    });

    it('returns undefined for output without a data line', () => {
      expect(parseDfOutput('Filesystem 1B-blocks Used Available Use% Mounted on')).toBeUndefined();
    });
  });
});
