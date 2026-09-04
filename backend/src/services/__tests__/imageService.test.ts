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

describe('downloadAndSaveImage safety limits', () => {
  it('refuses a response that is not an image', async () => {
    fetchMock = jest.fn(async () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await service.downloadAndSaveImage(POSTER_URL, { imageType: 'Poster', collectionId });

    expect(result).toMatchObject({ success: false });
    expect(result.error).toMatch(/not an image/i);
    expect(await prisma.image.count({ where: { collectionId } })).toBe(0);
  });

  it('refuses a body larger than the limit', async () => {
    const huge = Buffer.alloc(26 * 1024 * 1024, 1);
    fetchMock = jest.fn(async () => new Response(huge, { headers: { 'content-type': 'image/jpeg' } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await service.downloadAndSaveImage(POSTER_URL, { imageType: 'Poster', collectionId });

    expect(result.error).toMatch(/too large/i);
  });

  it('refuses one that only declares itself too large', async () => {
    fetchMock = jest.fn(
      async () =>
        new Response(pngBytes, {
          headers: { 'content-type': 'image/png', 'content-length': String(99 * 1024 * 1024) },
        })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await service.downloadAndSaveImage(POSTER_URL, { imageType: 'Poster', collectionId });

    expect(result.error).toMatch(/too large/i);
  });

  it('refuses an empty body', async () => {
    fetchMock = jest.fn(async () => new Response(Buffer.alloc(0), { headers: { 'content-type': 'image/png' } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await service.downloadAndSaveImage(POSTER_URL, { imageType: 'Poster', collectionId });

    expect(result.error).toMatch(/empty/i);
  });

  it('gives up on a provider that never answers', async () => {
    fetchMock = jest.fn((_url: unknown, init: unknown) => {
      const signal = (init as { signal?: AbortSignal }).signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')));
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    // The service passes an AbortSignal; abort it as the timeout would.
    const pending = service.downloadAndSaveImage(POSTER_URL, { imageType: 'Poster', collectionId });
    const signal = (fetchMock.mock.calls[0][1] as { signal: AbortSignal }).signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    (signal as AbortSignal & { onabort?: () => void }).dispatchEvent(new Event('abort'));

    await expect(pending).resolves.toMatchObject({ success: false });
  });
});

describe('getSizedPath', () => {
  it('writes a bounded copy next to the original and reuses it', async () => {
    const wide = await sharp({ create: { width: 1000, height: 1500, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    fetchMock = jest.fn(async () => new Response(wide, { headers: { 'content-type': 'image/png' } }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const saved = await service.downloadAndSaveImage(POSTER_URL, { imageType: 'Poster', collectionId });
    const row = await prisma.image.findFirstOrThrow({ where: { collectionId } });

    const sized = await service.getSizedPath(row, 'w200');

    expect(sized).not.toBe(path.join(storePath, saved.path!));
    expect(fs.existsSync(sized)).toBe(true);
    expect((await sharp(sized).metadata()).width).toBe(200);

    // A second request reuses the file rather than resizing again.
    const mtime = fs.statSync(sized).mtimeMs;
    expect(await service.getSizedPath(row, 'w200')).toBe(sized);
    expect(fs.statSync(sized).mtimeMs).toBe(mtime);
  });

  it('serves the original for an unknown size', async () => {
    await service.downloadAndSaveImage(POSTER_URL, { imageType: 'Poster', collectionId });
    const row = await prisma.image.findFirstOrThrow({ where: { collectionId } });

    await expect(service.getSizedPath(row, 'enormous')).resolves.toBe(path.join(storePath, row.path));
  });

  it('serves the original when the image is already smaller', async () => {
    await service.downloadAndSaveImage(POSTER_URL, { imageType: 'Poster', collectionId });
    const row = await prisma.image.findFirstOrThrow({ where: { collectionId } });

    // The fixture is 2x3 pixels.
    await expect(service.getSizedPath(row, 'w400')).resolves.toBe(path.join(storePath, row.path));
  });

  it('serves an SVG unchanged, since it scales on its own', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="200"></svg>');
    fetchMock = jest.fn(async () => new Response(svg, { headers: { 'content-type': 'image/svg+xml' } }));
    global.fetch = fetchMock as unknown as typeof fetch;
    await service.downloadAndSaveImage('https://images.example/logo.svg', { imageType: 'Logo', collectionId });
    const row = await prisma.image.findFirstOrThrow({ where: { collectionId, imageType: 'Logo' } });

    await expect(service.getSizedPath(row, 'w200')).resolves.toBe(path.join(storePath, row.path));
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
