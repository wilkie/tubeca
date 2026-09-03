import { jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import type { CreditInfo } from '@tubeca/scraper-types';
import { applyCredits, downloadArtwork, mapCreditType, shouldDownloadArtwork, type CreditRow } from '../scrapeApply';
import { prisma, resetDatabase, createLibrary, createCollection } from '../../test/db';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-apply-'));
const configPath = path.join(scratch, 'tubeca.config.json');
fs.writeFileSync(configPath, JSON.stringify({ imagePath: path.join(scratch, 'store') }));
process.env.TUBECA_CONFIG_PATH = configPath;

let pngBytes: Buffer;
let fetchMock: jest.Mock;
let collectionId: string;

function credit(name: string, extra: Partial<CreditInfo> = {}): CreditInfo {
  return { name, type: 'actor', ...extra };
}

beforeAll(async () => {
  pngBytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } })
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

describe('mapCreditType', () => {
  it('maps each scraper credit type onto the database enum', () => {
    expect(mapCreditType('director')).toBe('Director');
    expect(mapCreditType('cinematographer')).toBe('Cinematographer');
  });

  it('treats an unknown type as an acting credit', () => {
    expect(mapCreditType('gaffer')).toBe('Actor');
  });
});

describe('applyCredits', () => {
  let created: CreditRow[];
  let deleteExisting: () => Promise<unknown>;
  let createCredit: (row: CreditRow) => Promise<unknown>;

  beforeEach(() => {
    created = [];
    deleteExisting = jest.fn(async () => undefined);
    createCredit = jest.fn(async (row: CreditRow) => {
      created.push(row);
      return undefined;
    });
  });

  it('writes one row per credit, in the order given', async () => {
    await applyCredits({
      credits: [credit('Al Pacino', { role: 'Hanna', order: 0 }), credit('Michael Mann', { type: 'director' })],
      deleteExisting,
      createCredit,
      downloadPhotos: false,
    });

    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ name: 'Al Pacino', role: 'Hanna', creditType: 'Actor', order: 0 });
    expect(created[1]).toMatchObject({ name: 'Michael Mann', creditType: 'Director' });
  });

  it('clears the previous credits before writing the new ones', async () => {
    await applyCredits({ credits: [credit('Al Pacino')], deleteExisting, createCredit, downloadPhotos: false });

    expect(deleteExisting).toHaveBeenCalledTimes(1);
  });

  it('leaves the existing credits alone when the scraper returned none', async () => {
    await applyCredits({ credits: [], deleteExisting, createCredit });

    expect(deleteExisting).not.toHaveBeenCalled();
    expect(createCredit).not.toHaveBeenCalled();
  });

  it('links each credit to a person record', async () => {
    await applyCredits({ credits: [credit('Al Pacino')], deleteExisting, createCredit, downloadPhotos: false });

    expect(created[0].personId).toBeDefined();
    const person = await prisma.person.findUniqueOrThrow({ where: { id: created[0].personId! } });
    expect(person.name).toBe('Al Pacino');
  });

  it('reuses the same person across two credits', async () => {
    await applyCredits({
      credits: [credit('Al Pacino', { imdbId: 'nm0000199' })],
      deleteExisting,
      createCredit,
      downloadPhotos: false,
    });
    await applyCredits({
      credits: [credit('Al Pacino', { imdbId: 'nm0000199' })],
      deleteExisting,
      createCredit,
      downloadPhotos: false,
    });

    expect(created[0].personId).toBe(created[1].personId);
    expect(await prisma.person.count()).toBe(1);
  });

  it('fetches a cast photo only for a person who has none', async () => {
    const credits = [credit('Al Pacino', { photoUrl: 'https://images.example/pacino.png' })];

    await applyCredits({ credits, deleteExisting, createCredit });
    await applyCredits({ credits, deleteExisting, createCredit });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await prisma.image.count({ where: { imageType: 'Photo' } })).toBe(1);
  });

  it('does not fetch cast photos on a metadata-only refresh', async () => {
    await applyCredits({
      credits: [credit('Al Pacino', { photoUrl: 'https://images.example/pacino.png' })],
      deleteExisting,
      createCredit,
      downloadPhotos: false,
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('downloadArtwork', () => {
  it('fetches every artwork the scraper returned', async () => {
    await downloadArtwork(
      { collectionId },
      {
        posterUrl: 'https://images.example/poster.png',
        backdropUrl: 'https://images.example/backdrop.png',
        logoUrl: 'https://images.example/logo.png',
      },
      'tmdb'
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const types = await prisma.image.findMany({ where: { collectionId }, select: { imageType: true } });
    expect(types.map((t) => t.imageType).sort()).toEqual(['Backdrop', 'Logo', 'Poster']);
  });

  it('does nothing when the scraper returned no artwork', async () => {
    await downloadArtwork({ collectionId }, {}, 'tmdb');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('saves the rest when one download fails', async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      fetchMock = jest.fn(async (url: unknown) =>
        String(url).includes('backdrop')
          ? new Response('nope', { status: 404 })
          : new Response(pngBytes, { headers: { 'content-type': 'image/png' } })
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await downloadArtwork(
        { collectionId },
        { posterUrl: 'https://images.example/poster.png', backdropUrl: 'https://images.example/backdrop.png' },
        'tmdb'
      );

      const rows = await prisma.image.findMany({ where: { collectionId } });
      expect(rows.map((r) => r.imageType)).toEqual(['Poster']);
    } finally {
      console.warn = warn;
    }
  });
});

describe('shouldDownloadArtwork', () => {
  it('says yes on a normal scrape', async () => {
    await expect(shouldDownloadArtwork({ collectionId }, false)).resolves.toBe(true);
  });

  it('says no on a metadata refresh of something that already has artwork', async () => {
    await downloadArtwork({ collectionId }, { posterUrl: 'https://images.example/poster.png' }, 'tmdb');

    await expect(shouldDownloadArtwork({ collectionId }, true)).resolves.toBe(false);
  });

  it('still says yes on a metadata refresh when there is no artwork yet', async () => {
    await expect(shouldDownloadArtwork({ collectionId }, true)).resolves.toBe(true);
  });
});
