import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import express from 'express';
import request from 'supertest';
import sharp from 'sharp';
import imageRoutes from '../images';
import { prisma, resetDatabase, createUser, createLibrary, createCollection } from '../../test/db';

// The image store must not be the configured one.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-image-routes-'));
const storePath = path.join(scratch, 'store');
fs.writeFileSync(path.join(scratch, 'tubeca.config.json'), JSON.stringify({ imagePath: storePath }));
process.env.TUBECA_CONFIG_PATH = path.join(scratch, 'tubeca.config.json');

const app = express();
app.use(express.json());
app.use('/api/images', imageRoutes);

let collectionId: string;
let editorHeader: string;
let viewerHeader: string;
let png: Buffer;

beforeAll(async () => {
  png = await sharp({ create: { width: 900, height: 1350, channels: 3, background: '#123456' } })
    .png()
    .toBuffer();
});

afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

beforeEach(async () => {
  await resetDatabase();
  const library = await createLibrary({ libraryType: 'Film' });
  const collection = await createCollection({ libraryId: library.id, name: 'Heat', collectionType: 'Film' });
  collectionId = collection.id;
  editorHeader = (await createUser({ role: 'Editor' })).authHeader;
  viewerHeader = (await createUser({ role: 'Viewer' })).authHeader;
});

function upload(header: string, query: Record<string, string>, body: Buffer = png, contentType = 'image/png') {
  return request(app)
    .post('/api/images/upload')
    .query(query)
    .set('Authorization', header)
    .set('Content-Type', contentType)
    .send(body);
}

describe('POST /api/images/upload', () => {
  it('stores an uploaded image as a candidate', async () => {
    const res = await upload(editorHeader, { imageType: 'Poster', collectionId });

    expect(res.status).toBe(201);
    const row = await prisma.image.findFirstOrThrow({ where: { collectionId } });
    expect(row).toMatchObject({ imageType: 'Poster', scraperId: 'manual', width: 900, height: 1350 });
    expect(fs.existsSync(path.join(storePath, row.path))).toBe(true);
  });

  it('keeps an existing scraped image rather than replacing it', async () => {
    await prisma.image.create({
      data: { collectionId, imageType: 'Poster', path: 'collections/x/poster.jpg', isPrimary: true, scraperId: 'tmdb' },
    });

    await upload(editorHeader, { imageType: 'Poster', collectionId });

    const rows = await prisma.image.findMany({ where: { collectionId, imageType: 'Poster' } });
    expect(rows).toHaveLength(2);
  });

  it('can be made the primary in the same request', async () => {
    const scraped = await prisma.image.create({
      data: { collectionId, imageType: 'Poster', path: 'collections/x/poster.jpg', isPrimary: true, scraperId: 'tmdb' },
    });

    await upload(editorHeader, { imageType: 'Poster', collectionId, isPrimary: 'true' });

    const rows = await prisma.image.findMany({ where: { collectionId, imageType: 'Poster' } });
    expect(rows.filter((r) => r.isPrimary)).toHaveLength(1);
    expect(rows.find((r) => r.isPrimary)!.id).not.toBe(scraped.id);
  });

  it('needs an editor', async () => {
    const res = await upload(viewerHeader, { imageType: 'Poster', collectionId });

    expect(res.status).toBe(403);
  });

  it('rejects an unknown image type', async () => {
    const res = await upload(editorHeader, { imageType: 'Sticker', collectionId });

    expect(res.status).toBe(400);
  });

  it('rejects a body that is not an image', async () => {
    const res = await request(app)
      .post('/api/images/upload')
      .query({ imageType: 'Poster', collectionId })
      .set('Authorization', editorHeader)
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('%PDF-1.4'));

    expect(res.status).toBe(400);
  });

  it('needs an entity to attach to', async () => {
    const res = await upload(editorHeader, { imageType: 'Poster' });

    expect(res.status).toBe(400);
  });
});

describe('PUT /api/images/:id/primary', () => {
  it('moves the primary flag between candidates of the same type', async () => {
    const first = await prisma.image.create({
      data: { collectionId, imageType: 'Poster', path: 'a.jpg', isPrimary: true },
    });
    const second = await prisma.image.create({
      data: { collectionId, imageType: 'Poster', path: 'b.jpg', isPrimary: false },
    });

    const res = await request(app).put(`/api/images/${second.id}/primary`).set('Authorization', editorHeader);

    expect(res.status).toBe(200);
    expect((await prisma.image.findUniqueOrThrow({ where: { id: first.id } })).isPrimary).toBe(false);
    expect((await prisma.image.findUniqueOrThrow({ where: { id: second.id } })).isPrimary).toBe(true);
  });

  it('leaves another type alone', async () => {
    const backdrop = await prisma.image.create({
      data: { collectionId, imageType: 'Backdrop', path: 'b.jpg', isPrimary: true },
    });
    const poster = await prisma.image.create({
      data: { collectionId, imageType: 'Poster', path: 'p.jpg', isPrimary: false },
    });

    await request(app).put(`/api/images/${poster.id}/primary`).set('Authorization', editorHeader);

    expect((await prisma.image.findUniqueOrThrow({ where: { id: backdrop.id } })).isPrimary).toBe(true);
  });

  it('needs an editor', async () => {
    const image = await prisma.image.create({ data: { collectionId, imageType: 'Poster', path: 'p.jpg' } });

    const res = await request(app).put(`/api/images/${image.id}/primary`).set('Authorization', viewerHeader);

    expect(res.status).toBe(403);
  });

  it('is a 404 for an image that does not exist', async () => {
    const res = await request(app)
      .put('/api/images/00000000-0000-0000-0000-000000000000/primary')
      .set('Authorization', editorHeader);

    expect(res.status).toBe(404);
  });
});
