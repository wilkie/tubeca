import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ContentDeletionService } from '../contentDeletionService';
import { prisma, resetDatabase, createLibrary, createCollection, createVideoMedia } from '../../test/db';

const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-images-'));
const service = new ContentDeletionService(storage);

function writeImage(rel: string) {
  const full = path.join(storage, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'x');
  return rel;
}

describe('ContentDeletionService', () => {
  beforeEach(resetDatabase);
  afterAll(() => fs.rmSync(storage, { recursive: true, force: true }));

  async function tree() {
    const library = await createLibrary({ libraryType: 'Television' });
    const show = await createCollection({ libraryId: library.id, name: 'Show', collectionType: 'Show' });
    const season = await createCollection({ libraryId: library.id, name: 'Season 1', collectionType: 'Season', parentId: show.id });
    const episode = await createVideoMedia({ path: '/s/e1.mkv', duration: 1, collectionId: season.id });
    const showImg = await prisma.image.create({ data: { collectionId: show.id, imageType: 'Poster', path: writeImage(`c/${show.id}/poster.jpg`) } });
    const seasonImg = await prisma.image.create({ data: { collectionId: season.id, imageType: 'Poster', path: writeImage(`c/${season.id}/poster.jpg`) } });
    const epImg = await prisma.image.create({ data: { mediaId: episode.id, imageType: 'Thumbnail', path: writeImage(`m/${episode.id}/thumb.jpg`) } });
    return { library, show, season, episode, images: [showImg, seasonImg, epImg] };
  }

  it('deletes a whole tree with its media and image files', async () => {
    const { show, season, episode, images } = await tree();
    const removed = await service.deleteCollectionTree(show.id);

    expect(removed).toEqual({ collections: 2, media: 1 });
    expect(await prisma.collection.count({ where: { id: { in: [show.id, season.id] } } })).toBe(0);
    expect(await prisma.media.findUnique({ where: { id: episode.id } })).toBeNull();
    for (const img of images) {
      expect(fs.existsSync(path.join(storage, img.path))).toBe(false);
    }
  });

  it('deletes a season without touching its show', async () => {
    const { show, season, episode } = await tree();
    await service.deleteCollectionTree(season.id);
    expect(await prisma.collection.findUnique({ where: { id: show.id } })).not.toBeNull();
    expect(await prisma.media.findUnique({ where: { id: episode.id } })).toBeNull();
  });

  it('deletes a single media item with its files and reports absence', async () => {
    const { episode, images } = await tree();
    expect(await service.deleteMedia(episode.id)).toBe(true);
    expect(fs.existsSync(path.join(storage, images[2].path))).toBe(false);
    expect(await service.deleteMedia(episode.id)).toBe(false);
  });

  it('cleans credit artwork through the details tables', async () => {
    const { show } = await tree();
    const details = await prisma.showDetails.create({ data: { collectionId: show.id } });
    const person = await prisma.person.create({ data: { name: 'Actor' } });
    const credit = await prisma.showCredit.create({ data: { showDetailsId: details.id, personId: person.id, creditType: 'Actor', name: 'Actor' } });
    const rel = writeImage(`credit/${credit.id}/photo.jpg`);
    await prisma.image.create({ data: { showCreditId: credit.id, imageType: 'Photo', path: rel } });

    await service.deleteCollectionTree(show.id);
    expect(fs.existsSync(path.join(storage, rel))).toBe(false);
  });

  it('empties a library', async () => {
    const { library } = await tree();
    const removed = await service.deleteLibraryContents(library.id);
    expect(removed).toEqual({ collections: 2, media: 1 });
    expect(await prisma.collection.count({ where: { libraryId: library.id } })).toBe(0);
  });
});
