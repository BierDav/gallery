import { ModuleRef } from '@nestjs/core';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobName, QueueName } from 'src/enum.js';
import { QueueMaintenanceRepository } from 'src/gallery/repositories/queue-maintenance.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';

const setup = () => {
  const queue = { add: vi.fn().mockResolvedValue({}), addBulk: vi.fn().mockResolvedValue([]) };
  const moduleRef = { get: vi.fn().mockReturnValue(queue) } as unknown as ModuleRef;
  const logger = {
    setContext: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    verbose: vi.fn(),
  } as unknown as LoggingRepository;
  const sut = new JobRepository(
    moduleRef,
    {} as ConfigRepository,
    {} as EventRepository,
    logger,
    new QueueMaintenanceRepository(moduleRef, logger),
  );
  (sut as unknown as { handlers: Record<string, { queueName: QueueName }> }).handlers = {
    [JobName.FileDelete]: { queueName: QueueName.BackgroundTask },
  };
  return { sut, queue, logger };
};

describe('JobRepository FileDelete of pod-local files (noodle)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'noodle-file-delete-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('unlinks absolute paths directly and queues only bucket keys', async () => {
    const { sut, queue } = setup();
    const local = join(dir, 'upload.jpg');
    await writeFile(local, 'x');

    await sut.queueAll([{ name: JobName.FileDelete, data: { files: [local, 'upload/user/key.jpg', null] } }]);

    expect(existsSync(local)).toBe(false);
    expect(queue.addBulk).toHaveBeenCalledWith([
      expect.objectContaining({ name: JobName.FileDelete, data: { files: ['upload/user/key.jpg'] } }),
    ]);
  });

  it('queues nothing when every file was local, and ignores files that are already gone', async () => {
    const { sut, queue, logger } = setup();

    await sut.queueAll([{ name: JobName.FileDelete, data: { files: [join(dir, 'missing.mp4')] } }]);

    expect(queue.addBulk).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns when a local file cannot be unlinked', async () => {
    const { sut, logger } = setup();

    // A directory cannot be unlinked (EISDIR/EPERM).
    await sut.queueAll([{ name: JobName.FileDelete, data: { files: [dir] } }]);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(`Failed to unlink local scratch file ${dir}`));
  });
});
