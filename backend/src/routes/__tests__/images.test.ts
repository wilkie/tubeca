import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import express from 'express';
import request from 'supertest';
import sharp from 'sharp';
import imageRoutes from '../images';
import { scraperManager } from '../../plugins/scraperLoader';
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

describe('POST /api/images/download', () => {
  function download(header: string, url: string) {
    return request(app)
      .post('/api/images/download')
      .set('Authorization', header)
      .send({ url, imageType: 'Poster', collectionId });
  }

  it('will not be pointed at this server or the network around it', async () => {
    // An editor asking the server to fetch a URL is asking it to make a request
    // on their behalf; without this it would happily map localhost for them.
    for (const url of [
      'http://127.0.0.1:6379/',
      'http://localhost:3000/api/users',
      'http://169.254.169.254/latest/meta-data/',
      'http://192.168.1.1/',
      'http://[::1]/',
    ]) {
      const res = await download(editorHeader, url);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not an address this server will request|resolves only to addresses/);
    }
  });

  it('will not read a file off the disk either', async () => {
    const res = await download(editorHeader, 'file:///etc/passwd');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/http and https/);
  });

  it('still needs an editor and an entity to attach to', async () => {
    expect((await download(viewerHeader, 'https://example.com/a.png')).status).toBe(403);

    const noEntity = await request(app)
      .post('/api/images/download')
      .set('Authorization', editorHeader)
      .send({ url: 'https://example.com/a.png', imageType: 'Poster' });
    expect(noEntity.status).toBe(400);
  });
});

describe('POST /api/images/download with a scraper installed', () => {
  /** Register a scraper that declares where its artwork lives, then undo it. */
  function withScraper<T>(hosts: string[], run: () => Promise<T>): Promise<T> {
    const manager = scraperManager as unknown as {
      scrapers: Map<string, { plugin: unknown; config: unknown }>;
    };
    const before = new Map(manager.scrapers);
    manager.scrapers.set('fake', {
      plugin: {
        id: 'fake',
        name: 'Fake',
        description: '',
        version: '1',
        supportedTypes: ['video'],
        imageHosts: hosts,
        initialize: async () => {},
        isConfigured: () => true,
      },
      config: {},
    });
    return run().finally(() => {
      manager.scrapers.clear();
      for (const [id, entry] of before) manager.scrapers.set(id, entry);
    });
  }

  function download(url: string) {
    return request(app)
      .post('/api/images/download')
      .set('Authorization', editorHeader)
      .send({ url, imageType: 'Poster', collectionId });
  }

  it('refuses a public host no scraper claims', async () => {
    await withScraper(['image.tmdb.org'], async () => {
      const res = await download('https://example.com/poster.jpg');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('not a host artwork comes from');
    });
  });

  it('cannot be walked past with a host that merely ends in an allowed one', async () => {
    await withScraper(['image.tmdb.org'], async () => {
      const res = await download('https://image.tmdb.org.evil.example/poster.jpg');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('not a host artwork comes from');
    });
  });

  it('cannot be widened by naming a different scraper in the body', async () => {
    await withScraper(['image.tmdb.org'], async () => {
      const res = await request(app)
        .post('/api/images/download')
        .set('Authorization', editorHeader)
        .send({
          url: 'https://example.com/poster.jpg',
          imageType: 'Poster',
          collectionId,
          scraperId: 'something-else',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('not a host artwork comes from');
    });
  });

  it('gets past the host check for an allowed one, and fails later on its own merits', async () => {
    await withScraper(['localhost'], async () => {
      // An allowed host that is nonetheless inside: the two checks are separate
      // questions, and this one is answered by safeFetch.
      const res = await download('http://localhost/poster.jpg');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/resolves only to addresses/);
    });
  });
});

describe('/api/images/orphans', () => {
  let adminHeader: string;

  beforeEach(async () => {
    adminHeader = (await createUser({ role: 'Admin' })).authHeader;
  });

  /** Put a file in the store that no row points at. */
  function stranded(relative: string) {
    const full = path.join(storePath, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.alloc(20, 1));
    return full;
  }

  it('lists what nothing points at, without removing it', async () => {
    const file = stranded('collections/orphan-check/poster.png');

    const res = await request(app).get('/api/images/orphans').set('Authorization', adminHeader);

    expect(res.status).toBe(200);
    expect(res.body.orphans).toContain('collections/orphan-check/poster.png');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('removes them when asked, and says how many', async () => {
    const file = stranded('collections/orphan-remove/poster.png');

    const res = await request(app).delete('/api/images/orphans').set('Authorization', adminHeader);

    expect(res.status).toBe(200);
    expect(res.body.removed).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('is for admins only', async () => {
    expect((await request(app).get('/api/images/orphans').set('Authorization', editorHeader)).status).toBe(403);
    expect((await request(app).delete('/api/images/orphans').set('Authorization', editorHeader)).status).toBe(403);
  });

  it('is not read as an image id', async () => {
    // `GET /:id` is registered in the same router; "orphans" must win.
    const res = await request(app).get('/api/images/orphans').set('Authorization', adminHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('scanned');
  });
});
