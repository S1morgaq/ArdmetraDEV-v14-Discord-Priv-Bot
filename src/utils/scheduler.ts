import { logger, errorMessage } from './logger';

interface Job {
  name: string;
  handle: NodeJS.Timeout;
  running: boolean;
}

const jobs = new Map<string, Job>();

/**
 * Registers a recurring job. Jobs never overlap (a slow run is skipped, not stacked),
 * errors are contained, and every handle is tracked so shutdown can stop them all.
 */
export function registerInterval(name: string, intervalMs: number, fn: () => Promise<void> | void): void {
  if (jobs.has(name)) return;
  const job: Job = { name, running: false, handle: undefined as unknown as NodeJS.Timeout };
  job.handle = setInterval(() => {
    if (job.running) return;
    job.running = true;
    Promise.resolve()
      .then(fn)
      .catch((error: unknown) => logger.error(`[SCHEDULER] Job "${name}" failed: ${errorMessage(error)}`))
      .finally(() => {
        job.running = false;
      });
  }, intervalMs);
  job.handle.unref();
  jobs.set(name, job);
}

export function stopAllJobs(): void {
  for (const job of jobs.values()) clearInterval(job.handle);
  jobs.clear();
}
