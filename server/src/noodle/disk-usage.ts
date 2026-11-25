import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export interface StatfsLike {
  bavail: number;
  bfree: number;
  blocks: number;
  frsize: number;
}

export interface DiskUsageLike {
  available: number;
  free: number;
  total: number;
}

const GIB = 1024 ** 3;

/**
virtiofs and some FUSE filesystems report a bogus block size from statfs()
(e.g. 1048576 instead of 4096), so the multiplied figures are nonsense.
Treat a result as untrustworthy when the volume looks smaller than 1 GiB or
the fragment size is zero or above 64 KiB.
*/
export const isImplausibleStatfs = (stats: StatfsLike) => {
  const total = stats.blocks * stats.frsize;
  return total < GIB || stats.frsize > 65_536 || stats.frsize === 0;
};

/** Parse `df -B1 <folder>` output: total, used, available in bytes. */
export const parseDfOutput = (output: string): DiskUsageLike | undefined => {
  const line = output.trim().split('\n', 2)[1];
  if (!line) {
    return undefined;
  }
  const parts = line.trim().split(/\s+/);
  const total = Number(parts[1]);
  const available = Number(parts[3]);
  if (!Number.isFinite(total) || !Number.isFinite(available)) {
    return undefined;
  }
  // df has no separate "free" column for unprivileged callers; report the
  // available figure for both, as the statfs path does for non-root users.
  return { available, free: available, total };
};

/** Ask df instead of statfs; undefined when df is unavailable or unparsable. */
export const dfDiskUsage = async (folder: string): Promise<DiskUsageLike | undefined> => {
  try {
    const { stdout } = await promisify(execFile)('df', ['-B1', folder], { encoding: 'utf8' });
    return parseDfOutput(stdout);
  } catch {
    return undefined;
  }
};
