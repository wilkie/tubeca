import { jest } from '@jest/globals';
import { chunk, collectInChunks, inChunks, MAX_SQL_PARAMETERS } from '../chunk';

describe('chunk', () => {
  it('splits a list into runs of the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('leaves a short list as one run, and an empty one as none', () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
    expect(chunk([], 10)).toEqual([]);
  });

  it('stays under what SQLite will bind', () => {
    // 999 is the ceiling and the statement binds written values too.
    expect(MAX_SQL_PARAMETERS).toBeLessThan(999);
  });

  it('refuses a size that would never finish', () => {
    expect(() => chunk([1], 0)).toThrow(/at least 1/);
  });
});

describe('inChunks', () => {
  it('runs the work over each chunk in order and adds up the counts', async () => {
    const seen: string[][] = [];
    const total = await inChunks(['a', 'b', 'c'], async (batch) => {
      seen.push(batch);
      return batch.length;
    }, 2);

    expect(seen).toEqual([['a', 'b'], ['c']]);
    expect(total).toBe(3);
  });

  it('does nothing at all for an empty list', async () => {
    const work = jest.fn<(batch: string[]) => Promise<number>>();
    expect(await inChunks([], work)).toBe(0);
    expect(work).not.toHaveBeenCalled();
  });

  it('counts nothing when the work returns nothing', async () => {
    expect(await inChunks(['a'], async () => undefined)).toBe(0);
  });
});

describe('collectInChunks', () => {
  it('joins what each chunk returned, in order', async () => {
    const collected = await collectInChunks(
      ['a', 'b', 'c'],
      async (batch) => batch.map((id) => id.toUpperCase()),
      2
    );

    expect(collected).toEqual(['A', 'B', 'C']);
  });

  it('is empty for an empty list', async () => {
    expect(await collectInChunks([], async () => ['x'])).toEqual([]);
  });
});
