/**
 * SQLite binds at most 999 parameters to a statement, and Prisma 7 does not
 * degrade gracefully past it: the query compiler panics with `should have
 * exactly one query for update with selection` rather than raising an error the
 * caller can catch. A `where: { id: { in: ids } }` with a thousand ids is
 * therefore not a slow query, it is a crash.
 *
 * Anywhere a list comes from the library rather than from a request — every
 * media row a scan imported, every image a library owns — has to be chunked.
 * Requests are capped separately at their routes.
 */

/**
 * Comfortably under SQLite's 999, since the statement binds the values being
 * written as well as the ids being matched.
 */
export const MAX_SQL_PARAMETERS = 500;

/** Split a list into runs no longer than `size`. */
export function chunk<T>(items: readonly T[], size = MAX_SQL_PARAMETERS): T[][] {
  if (size < 1) throw new Error('chunk size must be at least 1');
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Run `work` over a list in chunks small enough to bind, in order, and add up
 * what each returns.
 */
export async function inChunks(
  items: readonly string[],
  work: (batch: string[]) => Promise<number | void>,
  size = MAX_SQL_PARAMETERS
): Promise<number> {
  let total = 0;
  for (const batch of chunk(items, size)) {
    total += (await work(batch)) ?? 0;
  }
  return total;
}

/** The same, collecting what each chunk returns into one list. */
export async function collectInChunks<T>(
  items: readonly string[],
  work: (batch: string[]) => Promise<T[]>,
  size = MAX_SQL_PARAMETERS
): Promise<T[]> {
  const collected: T[] = [];
  for (const batch of chunk(items, size)) {
    collected.push(...(await work(batch)));
  }
  return collected;
}
