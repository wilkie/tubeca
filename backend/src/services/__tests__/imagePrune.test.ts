import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { prisma, resetDatabase, createLibrary, createCollection } from '../../test/db';
import { findOrphans, originalOf, removeOrphans } from '../imagePrune';

let store: string;

/** Put a file in the store, creating whatever directories it needs. */
function file(relative: string, bytes = 10): string {
  const full = path.join(store, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, Buffer.alloc(bytes, 1));
  return relative;
}

beforeEach(async () => {
  await resetDatabase();
  store = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-prune-'));
});

afterEach(() => fs.rmSync(store, { recursive: true, force: true }));

/** An Image row pointing at a stored path. */
async function row(relativePath: string) {
  const library = await createLibrary({ libraryType: 'Film' });
  const collection = await createCollection({ libraryId: library.id, name: 'Heat' });
  return prisma.image.create({
    data: { imageType: 'Poster', path: relativePath, collectionId: collection.id },
  });
}

describe('originalOf', () => {
  it('strips a generated size suffix', () => {
    expect(originalOf('collections/abc/poster-w400.jpg')).toBe('collections/abc/poster.jpg');
    expect(originalOf('collections/abc/backdrop-w1280.png')).toBe('collections/abc/backdrop.png');
  });

  it('leaves a path with no size suffix alone', () => {
    expect(originalOf('collections/abc/poster.jpg')).toBe('collections/abc/poster.jpg');
  });

  it('leaves the unique suffix of a chosen candidate alone', () => {
    // `allowMultiple` writes poster-a1b2c3d4.jpg, and a row points at it.
    expect(originalOf('collections/abc/poster-a1b2c3d4.jpg')).toBe(
      'collections/abc/poster-a1b2c3d4.jpg'
    );
  });

  it('strips a size from a candidate without losing its own suffix', () => {
    expect(originalOf('collections/abc/poster-a1b2c3d4-w200.jpg')).toBe(
      'collections/abc/poster-a1b2c3d4.jpg'
    );
  });
});

describe('findOrphans', () => {
  it('finds a file nothing points at', async () => {
    await row('collections/abc/poster.jpg');
    file('collections/abc/poster.jpg');
    file('collections/abc/poster.png', 40);

    const report = await findOrphans(store);

    // The format changed; the old file is what was left behind.
    expect(report.orphans).toEqual(['collections/abc/poster.png']);
    expect(report.bytes).toBe(40);
    expect(report.scanned).toBe(2);
  });

  it('keeps the resize cache, which no row points at either', async () => {
    await row('collections/abc/poster.jpg');
    file('collections/abc/poster.jpg');
    file('collections/abc/poster-w200.jpg');
    file('collections/abc/poster-w400.jpg');
    file('collections/abc/poster-w780.jpg');
    file('collections/abc/poster-w1280.jpg');

    const report = await findOrphans(store);

    // Deleting these would throw away work and report four false orphans.
    expect(report.orphans).toEqual([]);
    expect(report.scanned).toBe(5);
  });

  it('does not keep a variant whose original is gone', async () => {
    file('collections/abc/poster-w400.jpg');

    const report = await findOrphans(store);

    expect(report.orphans).toEqual(['collections/abc/poster-w400.jpg']);
  });

  it('looks through every entity folder', async () => {
    await row('collections/abc/poster.jpg');
    file('collections/abc/poster.jpg');
    file('people/xyz/photo.jpg');
    file('media/def/thumbnail.jpg');

    const report = await findOrphans(store);

    expect(report.orphans.sort()).toEqual(['media/def/thumbnail.jpg', 'people/xyz/photo.jpg']);
  });

  it('reports nothing for an empty or missing store', async () => {
    expect(await findOrphans(store)).toEqual({ orphans: [], bytes: 0, scanned: 0 });
    expect(await findOrphans(path.join(store, 'nowhere'))).toEqual({
      orphans: [],
      bytes: 0,
      scanned: 0,
    });
  });
});

describe('removeOrphans', () => {
  it('deletes what it is given and counts it', async () => {
    file('collections/abc/stale.jpg');
    file('collections/abc/keep.jpg');

    const removed = removeOrphans(['collections/abc/stale.jpg'], store);

    expect(removed).toBe(1);
    expect(fs.existsSync(path.join(store, 'collections/abc/stale.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(store, 'collections/abc/keep.jpg'))).toBe(true);
  });

  it('will not follow a path out of the store', () => {
    const outside = path.join(store, '..', `escape-${process.pid}.txt`);
    fs.writeFileSync(outside, 'not ours');

    const removed = removeOrphans([`../escape-${process.pid}.txt`], store);

    expect(removed).toBe(0);
    expect(fs.existsSync(outside)).toBe(true);
    fs.rmSync(outside, { force: true });
  });

  it('does not count a file that was already gone', () => {
    // The scan and the delete are separate passes; something may have removed
    // it in between, and reporting it as deleted would overstate the result.
    expect(removeOrphans(['collections/abc/never-existed.jpg'], store)).toBe(0);
  });
});
