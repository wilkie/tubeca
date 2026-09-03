import { jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { prisma, resetDatabase, createLibrary, createCollection } from '../../test/db';
import { ImageService } from '../imageService';

// Point the image store at a scratch directory before anything asks for it;
// the path is resolved on first use, not at import.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-images-'));
const storePath = path.join(scratch, 'store');
const configPath = path.join(scratch, 'tubeca.config.json');
fs.writeFileSync(configPath, JSON.stringify({ imagePath: storePath }));
process.env.TUBECA_CONFIG_PATH = configPath;

const service = new ImageService();
const POSTER_URL = 'https://images.example/poster.png';

let pngBytes: Buffer;
let fetchMock: jest.Mock;
let collectionId: string;

beforeAll(async () => {
  pngBytes = await sharp({
    create: { width: 2, height: 3, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
});

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDatabase();
  const library = await createLibrary({ name: 'Films', libraryType: 'Film' });
  const collection = await createCollection({ libraryId: library.id, name: 'Heat', collectionType: 'Film' });
  collectionId = collection.id;

  fetchMock = jest.fn(async () => new Response(pngBytes, { headers: { 'content-type': 'image/png' } }));
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('downloadAndSaveImage', () => {
  it('writes the file and the row on a first download', async () => {
    const result = await service.downloadAndSaveImage(POSTER_URL, { imageType: 'Poster', collectionId });

    expect(result).toMatchObject({ success: true, format: 'png', width: 2, height: 3 });
    expect(result.reused).toBeUndefined();
    expect(fs.existsSync(path.join(storePath, result.path!))).toBe(true);

    const row = await prisma.image.findFirstOrThrow({ where: { collectionId } });
    expect(row.sourceUrl).toBe(POSTER_URL);
  });

  it('re-downloads on every scrape by default', async () => {
    await service.downloadAndSaveImage(POSTER_URL, { imageType: 'Poster', collectionId });
    await service.downloadAndSaveImage(POSTER_URL, { imageType: 'Poster', collectionId });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await prisma.image.count({ where: { collectionId } })).toBe(1);
  });
});

describe('downloadAndSaveImage with reuseExisting', () => {
  it('keeps the file already on disk when the URL has not changed', async () => {
    const first = await service.downloadAndSaveImage(POSTER_URL, {
      imageType: 'Poster',
      collectionId,
      reuseExisting: true,
    });
    const second = await service.downloadAndSaveImage(POSTER_URL, {
      imageType: 'Poster',
      collectionId,
      reuseExisting: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ success: true, reused: true, path: first.path, width: 2, height: 3 });
  });

  it('downloads again when the provider points somewhere else', async () => {
    await service.downloadAndSaveImage(POSTER_URL, { imageType: 'Poster', collectionId, reuseExisting: true });
    const second = await service.downloadAndSaveImage('https://images.example/new-poster.png', {
      imageType: 'Poster',
      collectionId,
      reuseExisting: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second.reused).toBeUndefined();
    const row = await prisma.image.findFirstOrThrow({ where: { collectionId } });
    expect(row.sourceUrl).toBe('https://images.example/new-poster.png');
  });

  it('downloads again when the stored file has gone missing', async () => {
    const first = await service.downloadAndSaveImage(POSTER_URL, {
      imageType: 'Poster',
      collectionId,
      reuseExisting: true,
    });
    fs.rmSync(path.join(storePath, first.path!));

    const second = await service.downloadAndSaveImage(POSTER_URL, {
      imageType: 'Poster',
      collectionId,
      reuseExisting: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second.reused).toBeUndefined();
    expect(fs.existsSync(path.join(storePath, second.path!))).toBe(true);
  });

  it('still promotes a reused image to primary', async () => {
    await service.downloadAndSaveImage(POSTER_URL, { imageType: 'Poster', collectionId, reuseExisting: true });
    await prisma.image.updateMany({ where: { collectionId }, data: { isPrimary: false } });

    const second = await service.downloadAndSaveImage(POSTER_URL, {
      imageType: 'Poster',
      collectionId,
      isPrimary: true,
      reuseExisting: true,
    });

    expect(second.reused).toBe(true);
    const row = await prisma.image.findFirstOrThrow({ where: { collectionId } });
    expect(row.isPrimary).toBe(true);
  });

  it('reuses per image type, not per entity', async () => {
    await service.downloadAndSaveImage(POSTER_URL, { imageType: 'Poster', collectionId, reuseExisting: true });
    await service.downloadAndSaveImage('https://images.example/backdrop.png', {
      imageType: 'Backdrop',
      collectionId,
      reuseExisting: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await prisma.image.count({ where: { collectionId } })).toBe(2);
  });
});
