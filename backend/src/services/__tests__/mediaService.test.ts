import { MediaService } from '../mediaService';
import { NotFoundError } from '../errors';
import {
  prisma,
  resetDatabase,
  createLibrary,
  createCollection,
  createVideoMedia,
} from '../../test/db';

const mediaService = new MediaService();

let libraryId: string;
let collectionId: string;

beforeEach(async () => {
  await resetDatabase();
  libraryId = (await createLibrary({ name: 'Films', libraryType: 'Film' })).id;
  collectionId = (await createCollection({ libraryId, name: 'Heat', collectionType: 'Film' })).id;
});

describe('MediaService.getMediaById', () => {
  it('includes the collection, its library and its parent', async () => {
    const season = await createCollection({
      libraryId,
      name: 'Season 1',
      collectionType: 'Season',
      parentId: collectionId,
    });
    const media = await createVideoMedia({
      name: 'Episode 1',
      path: '/shows/s01e01.mkv',
      duration: 60,
      collectionId: season.id,
    });

    const found = await mediaService.getMediaById(media.id);

    expect(found?.collection?.name).toBe('Season 1');
    expect(found?.collection?.parent?.name).toBe('Heat');
    expect(found?.collection?.library.name).toBe('Films');
  });

  it('orders the streams by type then index', async () => {
    const media = await createVideoMedia({ path: '/films/heat.mkv', duration: 170, collectionId });
    await prisma.mediaStream.createMany({
      data: [
        { mediaId: media.id, streamType: 'Video', streamIndex: 0, codec: 'h264' },
        { mediaId: media.id, streamType: 'Audio', streamIndex: 2, codec: 'aac' },
        { mediaId: media.id, streamType: 'Audio', streamIndex: 1, codec: 'ac3' },
      ],
    });

    const found = await mediaService.getMediaById(media.id);

    expect(found?.streams.map((s) => [s.streamType, s.streamIndex])).toEqual([
      ['Audio', 1],
      ['Audio', 2],
      ['Video', 0],
    ]);
  });

  it('returns null for an id that is not there', async () => {
    expect(await mediaService.getMediaById('missing')).toBeNull();
  });
});

describe('MediaService type-checked lookups', () => {
  it('will not hand back a video when asked for audio', async () => {
    const video = await createVideoMedia({ path: '/films/heat.mkv', duration: 170 });

    expect(await mediaService.getVideoById(video.id)).not.toBeNull();
    expect(await mediaService.getAudioById(video.id)).toBeNull();
  });

  it('has nothing for an id that is not there', async () => {
    expect(await mediaService.getVideoById('missing')).toBeNull();
  });
});

describe('MediaService.deleteMedia', () => {
  it('removes the row', async () => {
    const media = await createVideoMedia({ path: '/films/heat.mkv', duration: 170 });

    await mediaService.deleteMedia(media.id);

    expect(await prisma.media.findUnique({ where: { id: media.id } })).toBeNull();
  });

  it('reports a missing id as not found', async () => {
    await expect(mediaService.deleteMedia('missing')).rejects.toThrow(NotFoundError);
  });
});
