/**
 * `items.map(fn)` with at most `limit` calls in flight, results in input order.
 *
 * For a batch of independent writes: one at a time pays a database round trip per write
 * in series (seconds for a statement's worth), all at once floods the connection pool.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
