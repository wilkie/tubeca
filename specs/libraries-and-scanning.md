# Libraries, Scanning & File Import

> A Library is an admin-configured root folder on disk typed as Television or Film (a Music type exists in the schema but is hidden, see below), optionally restricted to user groups. This part owns the Library CRUD API and admin UI, the BullMQ scan job that walks a library folder and turns directories into `Collection` rows and media files into `Media` rows (probing each file with ffprobe), the chokidar file watcher that does the same incrementally, and the filename/folder-name parsers that produce the hints (show name, season/episode, title, year) handed to the scrape queues. It exists so that a user's on-disk folder layout becomes the browsable content tree without any manual data entry.

## Responsibilities

- Store libraries (`name`, `path`, `libraryType`, `watchForChanges`, `groups`) and validate that `path` exists and is a directory at create/update time.
- Expose `/api/libraries` CRUD (Admin-only for writes) and filter the list per user via group membership.
- Run at most one scan per library at a time (`scan-<libraryId>` job id), with progress, result and cancellation exposed over `GET/DELETE /api/libraries/:id/scan`.
- Walk the library tree recursively; map folders to `Collection` rows by depth (Show/Season, Film, Artist/Album) and media files by extension to `Media` + `MediaStream` rows.
- Probe every newly imported file with `ffprobe` for duration and audio/video/subtitle stream details.
- Detect `<basename>.trickplay` sibling folders and store them as `Media.thumbnails`.
- Derive scrape hints from filenames and folder names and enqueue metadata-scrape (media) and collection-scrape (collection) jobs after a scan; in "full scan" mode, re-enqueue existing items too.
- Optionally watch library roots with chokidar and import added files/folders, and delete `Media` rows when files are removed.
- Sync watchers with the DB whenever a library is created, updated or deleted.

## Goals

- **Zero-configuration import**: the only inputs are a path and a type; folder depth alone decides collection types (`libraryScanWorker.ts:212`). The commit history shows the scan being the first feature built (5282cf0) and everything else layering on it.
- **Get scrapers a good query**: a large fraction of the code in this part exists to produce better search strings — using the film folder name instead of the file name (ac951c2), the Season/Show hierarchy for episodes, and most recently `parseTitleAndYear` (27c0663) so "Blade Runner 2049 (2017)" is searched as title+year rather than a raw string.
- **Idempotent rescans**: media are keyed by absolute `path`, collections by `(libraryId, name, parentId)`, so re-running a scan creates nothing new; a "full scan" only changes what gets re-scraped (ffb9d2d).
- **Do not fight the host filesystem**: the design tolerates WSL2 and SMB/CIFS mounts (polling mode, 30 s poll interval, `UV_THREADPOOL_SIZE=24`, 7052d0c), at the cost of slow change detection.
- **Never block a scan on scraping**: scans return quickly and push work to rate-limited scrape queues rather than calling scrapers inline.

## Components

| File | Role |
|------|------|
| `backend/prisma/schema.prisma` (`Library`, `LibraryType`, `CollectionType`, `Media`) | Library model; `Collection.libraryId` cascades on library delete; `Media.collectionId` is `SetNull` on collection delete. `Media.path` is unique (migration `20260903120000_unique_media_path` deduplicated existing rows). |
| `backend/src/services/libraryService.ts` | CRUD plus `getAccessibleLibraries` / `canUserAccessLibrary` group-based visibility. Path validation uses `fs.existsSync`/`statSync`. |
| `backend/src/routes/libraries.ts` | `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id`, `POST/GET/DELETE /:id/scan`. Calls `fileWatcherService.sync()` after create/update. |
| `backend/src/queues/libraryScanQueue.ts` | `library-scan` queue; deterministic job id `scan-<libraryId>`, `attempts: 1`, `addLibraryScanJob` / `getLibraryScanJob` / `cancelLibraryScanJob`. |
| `backend/src/workers/libraryScanWorker.ts` | Thin BullMQ handler: loads the library, runs `LibraryScanService.scan` with cancel/progress callbacks, queues scrapes from the summary, returns a `ScanResult`. `concurrency: 1`. |
| `backend/src/services/libraryScanService.ts` | The walk: `readdirSync` per directory, symlink classification, hidden/`.trickplay` skipping, `ImportService` calls, seen-id tracking, and post-walk orphan reconciliation. Testable against a temp tree. |
| `backend/src/services/importService.ts` | Shared by scanner and watcher: `ensureCollection`/`ensureCollectionPath`, `importMediaFile` (probe, streams, trickplay, unique-path race handling), pure `buildMediaHints`/`buildCollectionHints`, `queueMediaScrapes`/`queueCollectionScrapes`, `removeMissing`. |
| `backend/src/services/contentDeletionService.ts` | `deleteMedia`, `deleteCollectionTree`, `deleteLibraryContents`: remove rows and every artwork file they own (including credit photos). Used by the collection/media/library services, the watcher and reconciliation. |
| `backend/src/services/fileWatcherService.ts` | Singleton chokidar wrapper: `start/stop/sync/watchLibrary/unwatchLibrary`, debounced add handlers, unlink handler; delegates all creation to `ImportService`. |
| `backend/src/utils/mediaParser.ts` | `parseEpisodeFromFilename`, `parseMovieFromFilename`, `parseTitleAndYear`, `getShowNameFromCollectionPath`, `extractYear`. |
| `backend/src/services/__tests__/{importService,libraryScanService,contentDeletionService}.test.ts` | Hint building, collection chains, idempotent import, scrape queueing order, reconciliation, temp-tree scans, tree deletes with file cleanup. |
| `backend/src/utils/__tests__/mediaParser.test.ts` | 7 Jest cases, all for `parseTitleAndYear` only. |
| `backend/src/utils/ffprobe.ts` | `probeMediaFile` (duration + normalised `StreamInfo[]`) via `execFile('ffprobe', ...)`; swallows errors and returns `{duration: 0, streams: []}`. |
| `backend/src/config/appConfig.ts` (`FileWatcherConfig`) | `fileWatcher.enabled / usePolling / pollInterval` from `tubeca.config.json`. |
| `backend/src/index.ts:650-660, 702` | Starts the watcher at boot (env `FILE_WATCHER_ENABLED` overrides config) and stops it on shutdown; imports all workers so they run in the API process. |
| `frontend/ui/src/pages/LibrariesPage.tsx` | Admin table: watch icon, groups, scan progress bar, cancel, Quick/Full scan menu, edit/delete. Polls scan status every 2 s while any scan is active. |
| `frontend/ui/src/components/LibraryDialog.tsx` | Create/edit form: name, path (free text), type, group multi-select, watch switch. |
| `frontend/ui/src/utils/parseTitle.ts` (+ test) | Frontend mirror of `parseTitleAndYear` used by `IdentifyDialog` (shared-types is types-only, so the code is duplicated). |
| `packages/shared-types/src/index.ts:101-160` | `Library`, `LibraryType`, `Create/UpdateLibraryInput`, `ScanStartResponse`, `ScanStatusResponse`, `ScanCancelResponse`. |

## How It Works

### Library model and access

`Library` has `path`, `libraryType`, `watchForChanges` (default false) and a many-to-many `groups` relation. A library with no groups is public to every authenticated user; otherwise a non-admin must be in at least one of its groups (`libraryService.ts:45-85`). `GET /api/libraries/:id` returns 404 rather than 403 when access is denied. Validation on the routes is minimal: `libraryType` must be one of the three enum strings; `groupIds` are passed straight to Prisma `connect`/`set` (an unknown id yields a Prisma error surfaced as a 400 with the raw message). Deleting a library runs `contentDeletionService.deleteLibraryContents` first, so every collection tree, its media and their artwork files go with it (before 2026-09-03 media were detached and files left behind).

### Scan lifecycle

1. `POST /api/libraries/:id/scan` (Admin) checks for an existing `scan-<id>` job in `active`/`waiting` and returns 409 if found; otherwise `addLibraryScanJob` removes any completed/failed job with that id and adds a new one with `{libraryId, libraryPath, libraryName, fullScan}`. Because the job id is fixed, BullMQ itself prevents two queued scans per library.
2. The worker (`concurrency: 1`, so scans of different libraries are serialised too) loads the library and calls `LibraryScanService.scan`, passing a `checkCancelled` callback that re-reads the job from Redis for a `cancelled: true` flag and an `onProgress` callback bound to `job.updateProgress`.
3. The walk checks cancellation once per directory (cooperative; a directory with thousands of files cannot be interrupted mid-way), `readdirSync`s it, follows symlinks with `statSync` to classify entries (broken links are dropped), imports files through `ImportService.importMediaFile`, then recurses into subdirectories through `ImportService.ensureCollection`. Every collection and media id touched, new or existing, is recorded in a seen-set.
4. Progress is `min(95, filesProcessed/filesFound * 95)` updated after each directory; since `filesFound` grows as the walk proceeds, the bar is not monotonic and typically sits near 95% for most of the run. 100 is reported at the end.
5. After a complete walk, `ImportService.removeMissing` deletes media and collections in the library whose ids were not seen, with their artwork files (see Orphan reconciliation below). The worker then queues scrapes and returns a `ScanResult` (`filesFound`, `filesProcessed`, `collectionsCreated`, `mediaCreated`, `mediaRemoved`, `collectionsRemoved`, `errors[]`) as the job return value. The UI reads `result` from `GET /:id/scan` and shows it in a tooltip, including a second sentence when anything was removed.

### Folder → Collection mapping

`getCollectionType(libraryType, depth)` in `backend/src/utils/libraryLayout.ts` (shared by the worker and the watcher since 2026-09-03, along with the extension lists and `isMediaFile`):

| Library | depth 0 | depth 1 | deeper |
|---------|---------|---------|--------|
| Television | Show | Season | Generic |
| Film | Film | Generic | Generic |
| Music | Artist | Album | Generic |

Every non-hidden directory that does not end in `.trickplay` becomes a collection, whatever it contains (an `Extras/` or `Subs/` folder in a film becomes a Generic child collection). Collections are looked up by `(libraryId, name, parentId)`; if found and the computed type differs (e.g. the library's type was changed), the type is updated in place. Season number is parsed from the folder name with `/season\s*(\d+)/i`; film year from `parseMovieFromFilename(dir.name)`.

### File → Media mapping

For each file whose lower-cased extension is in the library's list:

- `Media.name` is the file basename, except in Film libraries where it is the immediate folder name (so "The Matrix (1999)" rather than "the.matrix.1999.1080p") — files directly in a Film library root fall back to the file basename.
- `Media.path` is the absolute joined path and is unique. `importMediaFile` looks it up with `findUnique`; if a concurrent import (the watcher, another scan) wins the insert, the resulting `P2002` is caught and the existing row is used, so the scanner and watcher can no longer produce duplicates.
- New files are probed with `probeMediaFile`; `duration` (rounded seconds, 0 on failure) is stored on `Media` and each video/audio/subtitle stream becomes a `MediaStream` row in the same create. Data/attachment streams are skipped. The watcher goes through the identical code.
- A sibling `<basename>.trickplay` directory is stored as `Media.thumbnails` (consumed by [Streaming & Transcoding](streaming-and-transcoding.md)).
- Existing files are counted in `filesProcessed` and otherwise untouched (no re-probe), except that rows imported before file identity was recorded get `fileSize`/`fileMtimeMs` backfilled; in full-scan mode their hints are re-added to `mediaToScrape` so they get re-scraped.
- An unknown path is first checked for a **rename or move**: `importMediaFile` stats the file and looks for a row in the same library with the same `fileSize` and `fileMtimeMs` whose recorded path no longer exists. If found, that row is re-pointed (`path`, `collectionId`; the name is kept when the row's scrape status is `Matched`, otherwise taken from the new location) and reported as `moved`, so details, images and watch progress survive and no probe runs. A copy (old file still present) or a re-encode (size/mtime changed) is imported as a new row. Moved rows that were never matched are re-queued for scraping.

Music libraries (the type is hidden since 2026-09-03: `LibraryDialog` does not offer it and `POST /api/libraries` rejects it, but libraries created earlier still exist) go through the same walk (Artist/Album folders, Audio media, ffprobe streams). `ImportService` no longer queues Artist/Album collection scrapes or Audio media scrapes, since no bundled plugin implements them; music imports produce a browsable tree with durations and no metadata.

### Scrape hints and enqueueing

Hints are built by the pure `buildMediaHints` and `buildCollectionHints` in `importService.ts`, so the scanner and watcher produce identical jobs. For Video media, `parseEpisodeFromFilename(fileBaseName)` (`S01E02`, `1x02`, with separators `. _ - space`) wins if it matches; `showName` then comes from the filename prefix or, failing that, from `getShowNameFromCollectionPath` (grandparent if the parent folder looks like "Season N"). Otherwise `parseTitleAndYear` runs on the folder name (or the file name at the library root) and only the `year` is kept; the name sent to the scraper is the folder name for Film libraries and the file base name otherwise, and the scrape workers apply `parseTitleAndYear` to it again (27c0663). Collections get `seasonNumber` from `/season\s*(\d+)/i` and films `year` from `parseTitleAndYear`, which unlike the old `parseMovieFromFilename` does not read "2001 A Space Odyssey" as year 2001.

Queueing goes through `ImportService.queueMediaScrapes` and `queueCollectionScrapes`:

- Media scrape jobs are skipped entirely for Film libraries (`shouldScrapeMedia`): film metadata is attached to the Film collection, not the media. The watcher now applies the same rule.
- Collection scrape jobs are added for Show, Season, Film, Artist and Album collections. Shows go first, and a season whose show is in the same batch is not queued here at all: the show job queues it once it has an external id to look the season up with. Seasons and albums carry `parentShowId`; seasons carry `seasonNumber`; films carry `year`. Everything else about matching lives in [Metadata Scraping](metadata-scraping.md).

### Orphan reconciliation

At the end of a scan, `removeMissing` deletes every media row in the library (via its collection) and every collection whose id was not seen during the walk, through `ContentDeletionService` so artwork files go too. Because moved files are re-pointed during the walk (and therefore seen), a renamed folder costs one collection delete plus one create while its media rows keep their ids; `ScanResult.mediaMoved` reports how many. Two guards prevent a bad walk from emptying a library: reconciliation is skipped if any directory could not be read (`incomplete`), and if the walk saw nothing at all (an unmounted share presents as an empty folder), in which case the result carries an explanatory error. Media at the library root have no collection and are never reconciled.

### File watcher

Enabled at boot if `FILE_WATCHER_ENABLED=true` or `fileWatcher.enabled` in `tubeca.config.json`; `usePolling` and `pollInterval` come only from the config file. One chokidar watcher per library with `watchForChanges`, `ignoreInitial: true`, `depth: 10`, `awaitWriteFinish` (2 s stability), hidden and `.trickplay` paths ignored. Events:

- `add` → filtered by extension, debounced 2 s per path, then `processNewFile`: `ImportService.ensureCollectionPath` creates any missing folders in the chain (queueing their scrapes), `importMediaFile` imports the file, and `queueMediaScrapes` enqueues a job unless the library is Film.
- `addDir` → debounced, `processNewDirectory` runs `ensureCollectionPath` and queues scrapes for whatever it created.
- `unlink` → after a 10 s grace period (`RENAME_GRACE_MS`), `contentDeletionService.deleteMedia` for the row still at that path, provided the file is still absent. chokidar reports a rename as `unlink` + `add`; the `add` re-points the row through `importMediaFile`'s size/mtime match, so by the time the timer fires the old path matches nothing and no delete happens.
- `unlinkDir` → deliberately a no-op, to survive folder renames (which chokidar reports as unlinkDir+addDir). Collections are therefore never removed by the watcher.
- `change` is not handled, so an in-place re-encode does not re-probe.

`sync()` is called after every library create/update and reconciles the watcher map against the DB. Changing a library's `path` while it is watched is not detected — `sync` only checks whether the id is present, so the old path stays watched until restart.

### The DNS-threadpool / network-mount fix (7052d0c)

On WSL2 with SMB-mounted libraries, polling-mode chokidar issued an `fs.stat` for every watched file every cycle (1 s default, and 300 ms for "binary" files because `binaryInterval` was unset). Those slow CIFS stats saturated libuv's 4-thread pool, which is also where `dns.lookup` (getaddrinfo), `fs.writeFile` and sharp run — TMDB requests were observed blocking 30-60 s on DNS while image downloads still succeeded. The fix has three parts: (1) default `pollInterval` raised to 30 s and `binaryInterval` set to the same value (`fileWatcherService.ts:164-190`); (2) `UV_THREADPOOL_SIZE=24` in the backend `dev`/`start` scripts; (3) the TMDB scraper now resolves hosts with c-ares (`dns.resolve4`, event-loop based, IPv4 only, 5-minute cache, getaddrinfo fallback) through a pooled undici agent. The trade-off is that new files on a polled mount take up to 30 s plus the 2 s stability window and 2 s debounce to appear.

### Filename parsing details

- `parseEpisodeFromFilename` requires the pattern to be delimited (`(?:^|[.\s_-])`), so "Show S01E02.mkv" and "show.s1e2.720p" match but "ShowS01E02" does not. Season/episode are capped at two digits for `SxxEyy`; `NNxNN` allows 2-3 digit episodes. It also extracts `episodeTitle` after the pattern, but the scan worker never uses it.
- `parseMovieFromFilename` finds a 19xx/20xx year followed by a quality token or end-of-string; "2001 A Space Odyssey" is mis-parsed (year 2001, empty title), which is why `parseTitleAndYear` was added for folder names and prefers a bracketed year.
- `parseTitleAndYear` has the only unit tests in this part. `parseEpisodeFromFilename`, `parseMovieFromFilename` and `getShowNameFromCollectionPath` are untested.

## Interactions

- **Depends on:** [Configuration](configuration.md) for `tubeca.config.json` (`fileWatcher.*`) and `.env` (`FILE_WATCHER_ENABLED`, Redis); [Auth & Users](auth-and-users.md) for `authenticate`/`requireRole` and the `Group` model used for library visibility; [Deployment](deployment.md) for the `ffprobe` binary on `PATH`, Redis, and `UV_THREADPOOL_SIZE`.
- **Used by:** [Content Model](content-model.md) — every `Collection`/`Media`/`MediaStream` row starts here; [Metadata Scraping](metadata-scraping.md) consumes the `metadata-scrape` and `collection-scrape` jobs and the hints this part computes; [Streaming & Transcoding](streaming-and-transcoding.md) reads `Media.path`, `duration`, `MediaStream` (audio track selection) and `thumbnails`; [Search](search.md) and [Frontend App](frontend-app.md) use the accessible-library filter to scope what a user sees; [Images](images.md) receives image work only indirectly via scrape jobs.
- **Shared data:** Prisma `Library`, `Group` (read), `Collection`, `Media`, `MediaStream` (write); BullMQ queues `library-scan` (own), `metadata-scrape` and `collection-scrape` (producer only); config keys `fileWatcher.enabled/usePolling/pollInterval`, env `FILE_WATCHER_ENABLED`, `REDIS_*`.

## History

- `5282cf0` 2025-11-28 — Libraries, collections, and the first library scan worker/queue, LibrariesPage and LibraryDialog.
- `dd02263` 2025-11-28 — Basic streaming; scan starts recording what streaming needs.
- `41cf2f0` 2025-11-29 — Scrapers added; `mediaParser.ts` created and scan begins enqueueing scrape jobs with filename hints.
- `3404584` 2025-11-30 — Metadata refresh; scan worker adjustments to hint plumbing.
- `78254a5` 2025-11-30 — `ffprobe.ts` gains full stream probing; scan stores `MediaStream` rows (audio track switching).
- `d7d4c32` 2025-12-01 — File watcher service added (`watchForChanges` migration 20251130224247), semicolon lint, API docs.
- `ac951c2` 2025-12-02 — Film media named after folder rather than file; trickplay fixes.
- `a52dbe1` 2025-12-02 — FilmDetails; scan skips media-scrape for Film libraries and passes film year to collection scrape.
- `8143c03` 2025-12-10 — Group-based library access control (`getAccessibleLibraries`, group picker in dialog).
- `ffb9d2d` 2025-12-14 — "Full scan" option re-queues existing media/collections; cancel via job data flag; Quick/Full menu in UI.
- `7052d0c` 2026-07-01 — DNS-threadpool starvation fix: 30 s poll + `binaryInterval`, `UV_THREADPOOL_SIZE=24`, c-ares DNS in TMDB scraper.
- `27c0663` 2026-09-02 — `parseTitleAndYear` (+ first parser tests) used by scrape workers and IdentifyDialog; frontend mirror in `utils/parseTitle.ts`.
- 2026-09-03 `getCollectionType` and media extension lists extracted to `utils/libraryLayout.ts` (with tests) and used by both the scan worker and file watcher.
- 2026-09-03 Import integrity: `ImportService`, `LibraryScanService` and `ContentDeletionService` extracted; scanner and watcher share one import path; `Media.path` unique with a dedupe migration; orphan reconciliation after each complete scan; library, collection and media deletes clean artwork files.
- 2026-09-03 Music hidden: removed from the library picker and the create-route allow-list; scans stop queueing Artist/Album/Audio scrapes. Schema and existing libraries untouched.
- 2026-09-03 Rename/move detection: `Media.fileSize`/`fileMtimeMs` recorded at import (migration `20260903150000_media_file_identity`), unknown paths matched against vanished rows in the same library, watcher unlink waits 10 s for the matching add; `ScanResult.mediaMoved`.

## Known Limitations

- **Rename detection needs an unchanged file.** Matching is exact on size and mtime, so a file that was re-encoded, re-muxed or touched while being moved is treated as new and the old row is reconciled away. Rows from before 2026-09-03 have no identity until a scan or watcher event backfills it.
- **Root-level media are never reconciled** because they have no collection and therefore no link to the library.
- **Blocking filesystem I/O in the API process.** The scan uses `readdirSync`/`statSync`/`existsSync` and all workers run inside the Express process, so a large directory on a slow mount stalls request handling. `libraryService` validation is also sync.
- **Case sensitivity.** Collections are matched by exact `name` and Prisma/SQLite default comparison; on case-insensitive filesystems a folder renamed only in case yields a second collection. Extensions are lower-cased, but `.MKV` files are matched while a folder named `Season 1` vs `season 1` is not deduplicated.
- **Symlink loops are not guarded.** Symlinked directories are followed with no visited-set, so a cycle recurses until stack overflow (the watcher's `depth: 10` bounds it there, the scan has no depth limit).
- **Non-media files are silently ignored**, including `.srt`/`.ass` subtitles, `.nfo` sidecars and cover art, so external subtitles are never imported.
- **Cancellation granularity is one directory**, and a cancelled scan still leaves everything created so far (no rollback); the job is marked failed with "Scan cancelled by user".
- **Progress is approximate and non-monotonic.**
- **Library `path` edits are not applied to a running watcher**, and changing `libraryType` does not re-type existing collections until the next scan.
- **Music is hidden and import-only**: existing Music libraries get a correct tree and durations, but no tag reading (ID3/Vorbis), no scraper, and no audio player beyond the progressive route. Reviving the type means: read `format.tags` at import, a MusicBrainz-style scraper implementing `searchAudio`/`getAudioMetadata` and the Artist/Album branches of `collectionScrapeWorker`, an audio player path in `PlayerContext`, and re-adding `Music` to `LibraryDialog` and the create-route allow-list.
- **Single global scan concurrency** means one huge library blocks scans of every other library.

## Opportunities

- **Content hashing for renames** (M): a partial hash (first/last MB) as a second identity key would survive touched mtimes and cross-library moves.
- **Dry-run / review for removals** (S): expose what a scan would remove and let an admin confirm, for libraries on flaky mounts.
- **Use `fs.promises.readdir`/`stat`** in the scan and `libraryService` (S) so the API process stays responsive; consider `Promise.all` with a small concurrency limit for ffprobe (currently strictly serial, one process spawn per file).
- **Track visited real paths when following symlinks** (S) and add a depth cap to match the watcher.
- **Handle chokidar `change`** (S) to re-probe a re-encoded file and refresh `duration`/`MediaStream`.
- **Re-watch on path change** (S): in `sync()`, compare the stored path/type with the DB row and rebuild the watcher when they differ.
- **Tests for the untested parsers** (S): `parseEpisodeFromFilename` (`1x02`, `s1e2`, prefix show name, quality suffix) and `getShowNameFromCollectionPath` directly; the scan is now covered against a temp tree.
- **Import subtitle sidecars** (M): `.srt`/`.vtt` next to a video could become `MediaStream` rows of type Subtitle with an external path, which the subtitle route in [Streaming & Transcoding](streaming-and-transcoding.md) could serve.
- **Read audio tags with ffprobe `format.tags`** (M): the probe already runs; capturing title/artist/album/track would give the music library real names ahead of any scraper.

- **Per-library worker concurrency** (S): give the queue a `libraryId`-based group or raise `concurrency` to 2 so one long scan does not block the others.
- **Directory-picker for `path`** (M): the dialog is a free-text field; a server-backed browse endpoint (admin-only) would prevent typos that are only caught by `existsSync`.
- **Bounded `ScanResult` return value** (S): keep counts and errors in the job return, and drop `newMediaIds`/`newCollections` once the scrape jobs are enqueued.
