/**
 * A tiny fixed-size worker-pool concurrency limiter. No external dependency (none of `p-limit`'s
 * shape is already in this repo's package.json) — this is the whole of what's needed: run `fn`
 * over `items` with at most `limit` calls in flight, preserving result order regardless of which
 * call finishes first.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
