import { unlink } from 'node:fs/promises';

/**
With media in S3, uploads and transcodes pass through pod-local scratch
paths (/data/upload/...) before they move to the bucket. A queued FileDelete
may run on another pod (api and microservices run separately), which then
needs a shared RWX volume to see the file. Unlink absolute paths right where
the job is queued instead, and queue only the bucket keys.
*/
export const splitLocalFileDeletes = (
  files: Array<string | null | undefined>,
  onError: (path: string, error: unknown) => void,
) => {
  const unlinks: Promise<void>[] = [];
  const remote: string[] = [];
  for (const file of files) {
    if (typeof file === 'string' && file.startsWith('/')) {
      unlinks.push(
        unlink(file).catch((error: NodeJS.ErrnoException) => {
          if (error?.code !== 'ENOENT') {
            onError(file, error);
          }
        }),
      );
    } else if (file) {
      remote.push(file);
    }
  }
  return { unlinks, remote };
};
