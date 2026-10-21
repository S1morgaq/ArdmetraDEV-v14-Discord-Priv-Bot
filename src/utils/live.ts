/**
 * "Live" embeds: a message that keeps refreshing itself (progress bars, ticking timers) for a short,
 * bounded time. Concurrency and lifetime are capped so this can never become a rate-limit problem.
 */
const MAX_LIVE = 20;
const active = new Set<NodeJS.Timeout>();

export interface LiveOptions {
  intervalMs: number;
  maxTicks: number;
  /** Return false to stop. Errors also stop the loop. */
  tick: () => Promise<boolean>;
}

export function startLive(options: LiveOptions): void {
  if (active.size >= MAX_LIVE) return;
  let ticks = 0;
  const schedule = () => {
    const handle = setTimeout(() => {
      active.delete(handle);
      ticks++;
      options
        .tick()
        .then((keepGoing) => {
          if (keepGoing && ticks < options.maxTicks) schedule();
        })
        .catch(() => undefined);
    }, options.intervalMs);
    handle.unref();
    active.add(handle);
  };
  schedule();
}

export function stopAllLive(): void {
  for (const handle of active) clearTimeout(handle);
  active.clear();
}
