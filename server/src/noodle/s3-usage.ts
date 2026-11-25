import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

/**
Storage figures for an S3-backed library.

With IMMICH_STORAGE_BACKEND=s3 the local statfs/df figures describe the
runtime scratch volume, not the library, so they are meaningless. When
IMMICH_STORAGE_QUOTA_BYTES is set, the server reports that quota as the
total and the sum of all object sizes in the bucket as used.

Summing is a ListObjectsV2 walk, O(#objects): with tens of thousands of
objects it takes a minute or more. So it runs in the background (deduplicated
through one in-flight promise, refreshed every 15 minutes) and the endpoint
returns the last figure instead of blocking. The web app polls the endpoint,
so it corrects itself shortly after the first (empty) read.
*/

export const STORAGE_QUOTA_ENV = 'IMMICH_STORAGE_QUOTA_BYTES';
const REFRESH_MS = 15 * 60 * 1000;

export const getStorageQuotaBytes = (env: NodeJS.ProcessEnv = process.env) => {
  const quota = Number(env[STORAGE_QUOTA_ENV] || 0);
  return Number.isFinite(quota) && quota > 0 ? quota : 0;
};

export const sumBucketObjectSizes = async (env: NodeJS.ProcessEnv = process.env): Promise<number> => {
  const client = new S3Client({
    endpoint: env.IMMICH_S3_ENDPOINT || 'http://minio:9000',
    region: env.IMMICH_S3_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.IMMICH_S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.IMMICH_S3_SECRET_ACCESS_KEY ?? '',
    },
  });
  const bucket = env.IMMICH_S3_BUCKET || 'immich';
  let used = 0;
  let token: string | undefined;
  try {
    do {
      const response = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
      for (const object of response.Contents ?? []) {
        used += object.Size ?? 0;
      }
      token = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (token);
  } finally {
    client.destroy();
  }
  return used;
};

export class BucketUsageCache {
  private bytes = 0;
  private at = 0;
  private inFlight?: Promise<number>;
  private interval?: ReturnType<typeof setInterval>;

  constructor(
    private readonly sum: () => Promise<number>,
    private readonly onError: (error: unknown) => void = () => {},
    private readonly refreshMs = REFRESH_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** The last known usage; starts a background refresh when it is stale. */
  current(): number {
    if (!this.interval) {
      this.interval = setInterval(() => void this.refresh(), this.refreshMs);
      this.interval.unref?.();
    }
    if (this.now() - this.at >= this.refreshMs) {
      void this.refresh();
    }
    return this.bytes;
  }

  refresh(): Promise<number> {
    this.inFlight ??= this.sum()
      .then((bytes) => {
        this.bytes = bytes;
        this.at = this.now();
        return bytes;
      })
      .catch((error: unknown) => {
        this.onError(error);
        return this.bytes;
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    return this.inFlight;
  }

  stop() {
    clearInterval(this.interval);
    this.interval = undefined;
  }
}

let shared: BucketUsageCache | undefined;
export const bucketUsage = (onError?: (error: unknown) => void) =>
  (shared ??= new BucketUsageCache(() => sumBucketObjectSizes(), onError));
