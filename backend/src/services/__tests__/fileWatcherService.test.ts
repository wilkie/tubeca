import { jest } from '@jest/globals';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { prisma, resetDatabase, createLibrary, createVideoMedia } from '../../test/db';

/** A stand-in for the chokidar watcher: an emitter we can drive by hand. */
class FakeWatcher extends EventEmitter {
  closed = false;
  constructor(readonly watchedPath: string, readonly options: Record<string, unknown>) {
    super();
  }
  close = async () => {
    this.closed = true;
  };
  getWatched = () => ({});
}

const watchers: FakeWatcher[] = [];

jest.unstable_mockModule('chokidar', () => ({
  watch: jest.fn((watchedPath: string, options: Record<string, unknown>) => {
    const watcher = new FakeWatcher(watchedPath, options);
    watchers.push(watcher);
    return watcher;
  }),
}));

/** A mocked async dependency; the arguments are asserted, not typed. */
const asyncMock = <T>() => jest.fn<(...args: unknown[]) => Promise<T>>();
type EnsuredPath = {
  leafId: string
  collections: Array<{ created: boolean; collectionType?: string; hints: { name: string } }>
};
type ImportOutcome = {
  created: boolean
  moved: boolean
  scrapeStatus: string
  hints: { name: string }
};

const importService = {
  ensureCollectionPath: asyncMock<EnsuredPath>(),
  importMediaFile: asyncMock<ImportOutcome>(),
  queueMediaScrapes: asyncMock<number>(),
  queueCollectionScrapes: asyncMock<number>(),
  queueTrickplay: asyncMock<number>(),
  reprobeMediaFile: asyncMock<{ updated: boolean; streams: number }>(),
};

/** Every test starts from a library that imports one new, unscraped file. */
function giveImportServiceItsDefaults() {
  importService.ensureCollectionPath.mockResolvedValue({ leafId: 'leaf-id', collections: [] });
  importService.importMediaFile.mockResolvedValue({
    created: true,
    moved: false,
    scrapeStatus: 'Pending',
    hints: { name: 'Heat' },
  });
  importService.queueMediaScrapes.mockResolvedValue(1);
  importService.queueTrickplay.mockResolvedValue(0);
  importService.queueCollectionScrapes.mockResolvedValue(1);
  importService.reprobeMediaFile.mockResolvedValue({ updated: true, streams: 3 });
}
jest.unstable_mockModule('../importService', () => ({ importService }));

const contentDeletionService = { deleteMedia: asyncMock<boolean>() };
jest.unstable_mockModule('../contentDeletionService', () => ({ contentDeletionService }));

const { fileWatcherService } = await import('../fileWatcherService');

let root: string;

/** The watcher created for a library, in creation order. */
const lastWatcher = () => watchers[watchers.length - 1];

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

beforeEach(async () => {
  await resetDatabase();
  watchers.length = 0;
  jest.clearAllMocks();
  giveImportServiceItsDefaults();
  contentDeletionService.deleteMedia.mockResolvedValue(true);
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-watch-'));
});

afterEach(async () => {
  await fileWatcherService.stop();
  jest.useRealTimers();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('FileWatcherService.start', () => {
  it('watches only the libraries that asked to be watched', async () => {
    const watched = await createLibrary({ path: root, libraryType: 'Film' });
    await prisma.library.update({ where: { id: watched.id }, data: { watchForChanges: true } });
    await createLibrary({ path: root, libraryType: 'Film' });

    await fileWatcherService.start();

    expect(fileWatcherService.getStatus()).toEqual({
      enabled: true,
      watchedLibraries: [{ id: watched.id, path: root, libraryType: 'Film' }],
    });
  });

  it('does nothing the second time it is started', async () => {
    await watchedLibrary();

    await fileWatcherService.start();
    await fileWatcherService.start();

    expect(watchers).toHaveLength(1);
  });

  it('skips a library whose path is not there', async () => {
    const missing = path.join(root, 'gone');
    const library = await createLibrary({ path: missing });
    await prisma.library.update({ where: { id: library.id }, data: { watchForChanges: true } });

    await fileWatcherService.start();

    expect(watchers).toHaveLength(0);
    expect(fileWatcherService.getStatus().watchedLibraries).toEqual([]);
  });

  it('polls gently on both clocks when asked to poll', async () => {
    await watchedLibrary();

    await fileWatcherService.start({ usePolling: true, pollInterval: 45000 });

    expect(lastWatcher().options).toMatchObject({
      usePolling: true,
      interval: 45000,
      binaryInterval: 45000,
    });
  });
});

describe('FileWatcherService.stop', () => {
  it('closes every watcher', async () => {
    await watchedLibrary();
    await fileWatcherService.start();
    const watcher = lastWatcher();

    await fileWatcherService.stop();

    expect(watcher.closed).toBe(true);
    expect(fileWatcherService.getStatus()).toEqual({ enabled: false, watchedLibraries: [] });
  });

  it('drops work that was still waiting out its debounce', async () => {
    const library = await watchedLibrary();
    await fileWatcherService.start();
    jest.useFakeTimers();
    lastWatcher().emit('add', path.join(library.path, 'Heat (1995).mkv'));

    await fileWatcherService.stop();
    await jest.advanceTimersByTimeAsync(5000);

    expect(importService.importMediaFile).not.toHaveBeenCalled();
  });
});

describe('FileWatcherService.sync', () => {
  it('picks up a library that has just turned watching on', async () => {
    const library = await createLibrary({ path: root });
    await fileWatcherService.start();
    await prisma.library.update({ where: { id: library.id }, data: { watchForChanges: true } });

    await fileWatcherService.sync();

    expect(fileWatcherService.getStatus().watchedLibraries.map((l) => l.id)).toEqual([library.id]);
  });

  it('lets go of a library that has turned watching off', async () => {
    const library = await watchedLibrary();
    await fileWatcherService.start();
    await prisma.library.update({ where: { id: library.id }, data: { watchForChanges: false } });

    await fileWatcherService.sync();

    expect(fileWatcherService.getStatus().watchedLibraries).toEqual([]);
  });

  it('rebuilds the watcher when the library moves', async () => {
    const library = await watchedLibrary();
    await fileWatcherService.start();
    const moved = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-moved-'));
    await prisma.library.update({ where: { id: library.id }, data: { path: moved } });

    await fileWatcherService.sync();

    expect(fileWatcherService.getStatus().watchedLibraries[0].path).toBe(moved);
    expect(watchers[0].closed).toBe(true);
    fs.rmSync(moved, { recursive: true, force: true });
  });

  it('rebuilds the watcher when the library changes type', async () => {
    const library = await watchedLibrary('Film');
    await fileWatcherService.start();
    await prisma.library.update({ where: { id: library.id }, data: { libraryType: 'Television' } });

    await fileWatcherService.sync();

    expect(fileWatcherService.getStatus().watchedLibraries[0].libraryType).toBe('Television');
  });

  it('forgets a library that has been deleted', async () => {
    const library = await watchedLibrary();
    await fileWatcherService.start();
    await prisma.library.delete({ where: { id: library.id } });

    await fileWatcherService.sync();

    expect(fileWatcherService.getStatus().watchedLibraries).toEqual([]);
  });
});

describe('a file appearing', () => {
  it('imports it once the writing has settled', async () => {
    const library = await watchedLibrary();
    await fileWatcherService.start();
    jest.useFakeTimers();

    lastWatcher().emit('add', path.join(library.path, 'Films', 'Heat (1995)', 'Heat.mkv'));
    await jest.advanceTimersByTimeAsync(1999);
    expect(importService.importMediaFile).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(importService.ensureCollectionPath).toHaveBeenCalledWith(library.id, 'Film', [
      'Films',
      'Heat (1995)',
    ]);
    expect(importService.importMediaFile).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryId: library.id,
        filePath: path.join(library.path, 'Films', 'Heat (1995)', 'Heat.mkv'),
        parentCollectionId: 'leaf-id',
      })
    );
    expect(importService.queueMediaScrapes).toHaveBeenCalled();
  });

  it('imports a burst of events for one file only once', async () => {
    const library = await watchedLibrary();
    await fileWatcherService.start();
    jest.useFakeTimers();
    const file = path.join(library.path, 'Heat.mkv');

    for (let i = 0; i < 5; i++) {
      lastWatcher().emit('add', file);
      await jest.advanceTimersByTimeAsync(500);
    }
    await jest.advanceTimersByTimeAsync(2000);

    expect(importService.importMediaFile).toHaveBeenCalledTimes(1);
  });

  it('ignores a file that is not media for this library', async () => {
    const library = await watchedLibrary();
    await fileWatcherService.start();
    jest.useFakeTimers();

    lastWatcher().emit('add', path.join(library.path, 'Heat.nfo'));
    lastWatcher().emit('add', path.join(library.path, 'cover.jpg'));
    await jest.advanceTimersByTimeAsync(3000);

    expect(importService.importMediaFile).not.toHaveBeenCalled();
  });

  it('leaves a file already known where it is', async () => {
    const library = await watchedLibrary();
    importService.importMediaFile.mockResolvedValue({
      created: false,
      moved: false,
      scrapeStatus: 'Matched',
      hints: { name: 'Heat' },
    });
    await fileWatcherService.start();
    jest.useFakeTimers();

    lastWatcher().emit('add', path.join(library.path, 'Heat.mkv'));
    await jest.advanceTimersByTimeAsync(3000);

    expect(importService.queueMediaScrapes).not.toHaveBeenCalled();
  });

  it('leaves a moved file that already matched alone', async () => {
    const library = await watchedLibrary();
    importService.importMediaFile.mockResolvedValue({
      created: false,
      moved: true,
      scrapeStatus: 'Matched',
      hints: { name: 'Heat' },
    });
    await fileWatcherService.start();
    jest.useFakeTimers();

    lastWatcher().emit('add', path.join(library.path, 'Heat.mkv'));
    await jest.advanceTimersByTimeAsync(3000);

    expect(importService.queueMediaScrapes).not.toHaveBeenCalled();
  });

  it('re-scrapes a moved file that never matched, since its new name may say more', async () => {
    const library = await watchedLibrary();
    importService.importMediaFile.mockResolvedValue({
      created: false,
      moved: true,
      scrapeStatus: 'Pending',
      hints: { name: 'Heat' },
    });
    await fileWatcherService.start();
    jest.useFakeTimers();

    lastWatcher().emit('add', path.join(library.path, 'Heat.mkv'));
    await jest.advanceTimersByTimeAsync(3000);

    expect(importService.queueMediaScrapes).toHaveBeenCalledWith('Film', [{ name: 'Heat' }]);
  });

  it('carries on after an import throws', async () => {
    const library = await watchedLibrary();
    importService.importMediaFile.mockRejectedValueOnce(new Error('disk went away'));
    await fileWatcherService.start();
    jest.useFakeTimers();

    lastWatcher().emit('add', path.join(library.path, 'Heat.mkv'));
    await jest.advanceTimersByTimeAsync(3000);
    lastWatcher().emit('add', path.join(library.path, 'Casino.mkv'));
    await jest.advanceTimersByTimeAsync(3000);

    expect(importService.importMediaFile).toHaveBeenCalledTimes(2);
  });
});

describe('a file being rewritten', () => {
  it('probes it again', async () => {
    const library = await watchedLibrary();
    await fileWatcherService.start();
    jest.useFakeTimers();
    const file = path.join(library.path, 'Heat.mkv');

    lastWatcher().emit('change', file);
    await jest.advanceTimersByTimeAsync(3000);

    expect(importService.reprobeMediaFile).toHaveBeenCalledWith(file);
  });

  it('ignores something that is not media', async () => {
    const library = await watchedLibrary();
    await fileWatcherService.start();
    jest.useFakeTimers();

    lastWatcher().emit('change', path.join(library.path, 'Heat.srt'));
    await jest.advanceTimersByTimeAsync(3000);

    expect(importService.reprobeMediaFile).not.toHaveBeenCalled();
  });
});

describe('a file disappearing', () => {
  it('deletes the row once the grace period passes', async () => {
    const library = await watchedLibrary();
    const file = path.join(library.path, 'Heat.mkv');
    const media = await createVideoMedia({ path: file, duration: 170 });
    await fileWatcherService.start();
    jest.useFakeTimers();

    lastWatcher().emit('unlink', file);
    await jest.advanceTimersByTimeAsync(9999);
    expect(contentDeletionService.deleteMedia).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(contentDeletionService.deleteMedia).toHaveBeenCalledWith(media.id);
  });

  it('keeps the row when the file is back by then', async () => {
    const library = await watchedLibrary();
    const file = path.join(library.path, 'Heat.mkv');
    await createVideoMedia({ path: file, duration: 170 });
    fs.writeFileSync(file, 'back again');
    await fileWatcherService.start();
    jest.useFakeTimers();

    lastWatcher().emit('unlink', file);
    await jest.advanceTimersByTimeAsync(11000);

    expect(contentDeletionService.deleteMedia).not.toHaveBeenCalled();
  });

  it('has nothing to do when no row points at the file', async () => {
    const library = await watchedLibrary();
    await fileWatcherService.start();
    jest.useFakeTimers();

    lastWatcher().emit('unlink', path.join(library.path, 'Unknown.mkv'));
    await jest.advanceTimersByTimeAsync(11000);

    expect(contentDeletionService.deleteMedia).not.toHaveBeenCalled();
  });
});

describe('directories', () => {
  it('creates the collection a new folder stands for', async () => {
    const library = await watchedLibrary('Television');
    importService.ensureCollectionPath.mockResolvedValue({
      leafId: 'leaf-id',
      collections: [{ created: true, collectionType: 'Show', hints: { name: 'Breaking Bad' } }],
    });
    await fileWatcherService.start();
    jest.useFakeTimers();

    lastWatcher().emit('addDir', path.join(library.path, 'Breaking Bad'));
    await jest.advanceTimersByTimeAsync(3000);

    expect(importService.ensureCollectionPath).toHaveBeenCalledWith(library.id, 'Television', [
      'Breaking Bad',
    ]);
    expect(importService.queueCollectionScrapes).toHaveBeenCalledWith([{ name: 'Breaking Bad' }]);
  });

  it('says nothing about a folder it already knows', async () => {
    const library = await watchedLibrary();
    await fileWatcherService.start();
    jest.useFakeTimers();

    lastWatcher().emit('addDir', path.join(library.path, 'Heat (1995)'));
    await jest.advanceTimersByTimeAsync(3000);

    expect(importService.queueCollectionScrapes).not.toHaveBeenCalled();
  });

  it('ignores the library root and its hidden or trickplay folders', async () => {
    const library = await watchedLibrary();
    await fileWatcherService.start();
    jest.useFakeTimers();

    lastWatcher().emit('addDir', library.path);
    lastWatcher().emit('addDir', path.join(library.path, '.hidden'));
    lastWatcher().emit('addDir', path.join(library.path, 'Heat.trickplay'));
    await jest.advanceTimersByTimeAsync(3000);

    expect(importService.ensureCollectionPath).not.toHaveBeenCalled();
  });

  it('keeps the collection when a folder is removed', async () => {
    const library = await watchedLibrary();
    await fileWatcherService.start();
    jest.useFakeTimers();

    lastWatcher().emit('unlinkDir', path.join(library.path, 'Heat (1995)'));
    await jest.advanceTimersByTimeAsync(30000);

    expect(contentDeletionService.deleteMedia).not.toHaveBeenCalled();
  });
});

async function watchedLibrary(libraryType: 'Film' | 'Television' = 'Film') {
  const library = await createLibrary({ path: root, libraryType });
  return prisma.library.update({
    where: { id: library.id },
    data: { watchForChanges: true },
  });
}
