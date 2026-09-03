/**
 * Short-lived cache for provider responses.
 *
 * A library scan asks the same questions over and over: every episode of a
 * show searches for that show, every season of a show re-reads the series
 * record. The answers do not change between those calls, so holding them for
 * a few minutes removes most of the traffic without making stale data
 * visible: entries expire quickly and the cache is per-process, so a restart
 * or a manual refresh always talks to the provider again.
 *
 * In-flight calls are shared too, so two jobs that ask at the same time make
 * one request.
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 500;

interface CacheEntry {
  promise: Promise<unknown>
  expiresAt: number
}

const entries = new Map<string, CacheEntry>();
let hits = 0;
let misses = 0;

function evictExpired(now: number): void {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) {
      entries.delete(key);
    }
  }
}

/**
 * Run `fetch` unless an unexpired result for `key` is already held.
 *
 * A rejected call is never cached: the next caller retries it.
 */
export function cachedCall<T>(key: string, fetch: () => Promise<T>, ttlMs: number = DEFAULT_TTL_MS): Promise<T> {
  const now = Date.now();
  const existing = entries.get(key);
  if (existing && existing.expiresAt > now) {
    hits++;
    return existing.promise as Promise<T>;
  }

  misses++;
  const promise = fetch();
  entries.set(key, { promise, expiresAt: now + ttlMs });

  // Do not hold on to failures; the caller may well succeed on retry.
  promise.catch(() => {
    const current = entries.get(key);
    if (current?.promise === promise) {
      entries.delete(key);
    }
  });

  if (entries.size > MAX_ENTRIES) {
    evictExpired(now);
    // Still oversized: drop the oldest insertions, which Map iterates first.
    while (entries.size > MAX_ENTRIES) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
  }

  return promise;
}

/** Build a stable cache key from a scraper id, a method name and its arguments. */
export function scrapeCacheKey(scraperId: string, method: string, ...args: Array<string | number | undefined>): string {
  return `${scraperId}:${method}:${args.map((a) => (a === undefined ? '' : String(a))).join(':')}`;
}

/** Drop every cached response. Used by tests and by a forced refresh. */
export function clearScrapeCache(): void {
  entries.clear();
  hits = 0;
  misses = 0;
}

/** Counters for logging and the queue status endpoints. */
export function scrapeCacheStats(): { size: number; hits: number; misses: number } {
  return { size: entries.size, hits, misses };
}
