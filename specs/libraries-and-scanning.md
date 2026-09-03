# Libraries, Scanning & File Import

> A Library is an admin-configured root folder on disk typed as Television, Film or Music, optionally restricted to user groups. This part owns the Library CRUD API and admin UI, the BullMQ scan job that walks a library folder and turns directories into `Collection` rows and media files into `Media` rows (probing each file with ffprobe), the chokidar file watcher that does the same incrementally, and the filename/folder-name parsers that produce the hints (show name, season/episode, title, year) handed to the scrape queues. It exists so that a user's on-disk folder layout becomes the browsable content tree without any manual data entry.

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
- **Get scrapers a good query**: a large fraction of the code in this part exists to produce better search strings — using the film folder name instead of the file name (1af4a83), the Season/Show hierarchy for episodes, and most recently `parseTitleAndYear` (82f6d5c) so "Blade Runner 2049 (2017)" is searched as title+year rather than a raw string.
- **Idempotent rescans**: media are keyed by absolute `path`, collections by `(libraryId, name, parentId)`, so re-running a scan creates nothing new; a "full scan" only changes what gets re-scraped (3ce0d93).
- **Do not fight the host filesystem**: the design tolerates WSL2 and SMB/CIFS mounts (polling mode, 30 s poll interval, `UV_THREADPOOL_SIZE=24`, 4abe949), at the cost of slow change detection.
- **Never block a scan on scraping**: scans return quickly and push work to rate-limited scrape queues rather than calling scrapers inline.

## Components

| File | Role |
|------|------|
| `backend/prisma/schema.prisma` (`Library`, `LibraryType`, `CollectionType`, `Media`) | Library model; `Collection.libraryId` cascades on library delete; `Media.collectionId` is `SetNull` on collection delete. `Media.path` is not unique. |
| `backend/src/services/libraryService.ts` | CRUD plus `getAccessibleLibraries` / `canUserAccessLibrary` group-based visibility. Path validation uses `fs.existsSync`/`statSync`. |
| `backend/src/routes/libraries.ts` | `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id`, `POST/GET/DELETE /:id/scan`. Calls `fileWatcherService.sync()` after create/update. |
| `backend/src/queues/libraryScanQueue.ts` | `library-scan` queue; deterministic job id `scan-<libraryId>`, `attempts: 1`, `addLibraryScanJob` / `getLibraryScanJob` / `cancelLibraryScanJob`. |
| `backend/src/workers/libraryScanWorker.ts` | The scan itself: recursive `scanDirectory`, collection/media creation, ffprobe, hint parsing, bulk enqueue of scrape jobs. `concurrency: 1`. |
| `backend/src/services/fileWatcherService.ts` | Singleton chokidar wrapper: `start/stop/sync/watchLibrary/unwatchLibrary`, debounced add handlers, unlink handler; duplicates the worker's collection/media creation logic. |
| `backend/src/utils/mediaParser.ts` | `parseEpisodeFromFilename`, `parseMovieFromFilename`, `parseTitleAndYear`, `getShowNameFromCollectionPath`, `extractYear`. |
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

`Library` has `path`, `libraryType`, `watchForChanges` (default false) and a many-to-many `groups` relation. A library with no groups is public to every authenticated user; otherwise a non-admin must be in at least one of its groups (`libraryService.ts:45-85`). `GET /api/libraries/:id` returns 404 rather than 403 when access is denied. Validation on the routes is minimal: `libraryType` must be one of the three enum strings; `groupIds` are passed straight to Prisma `connect`/`set` (an unknown id yields a Prisma error surfaced as a 400 with the raw message). Deleting a library cascades to its collections in the DB; media are detached (`SetNull`), not deleted, and image files on disk are not touched (contrast `collectionService.deleteCollection`, which does clean up).

### Scan lifecycle

1. `POST /api/libraries/:id/scan` (Admin) checks for an existing `scan-<id>` job in `active`/`waiting` and returns 409 if found; otherwise `addLibraryScanJob` removes any completed/failed job with that id and adds a new one with `{libraryId, libraryPath, libraryName, fullScan}`. Because the job id is fixed, BullMQ itself prevents two queued scans per library.
2. The worker (`concurrency: 1`, so scans of different libraries are serialised too) re-checks the path exists, loads the library to get its type, picks `VIDEO_EXTENSIONS` or `AUDIO_EXTENSIONS`, and calls `scanDirectory(root, parent=null, depth=0)`.
3. `scanDirectory` first re-reads the job from Redis to look for a `cancelled: true` flag (`libraryScanWorker.ts:237`) — cancellation is cooperative and checked once per directory, so a directory with thousands of files cannot be interrupted mid-way. It then `readdirSync`s the directory, follows symlinks with `statSync` to classify them as file/dir (broken links are dropped), processes files, then recurses into subdirectories.
4. Progress is `min(95, filesProcessed/filesFound * 95)` updated after each directory; since `filesFound` grows as the walk proceeds, the bar is not monotonic and typically sits near 95% for most of the run. `updateProgress(100)` is set only at the end.
5. On completion the worker bulk-adds scrape jobs (see below) and returns a `ScanResult` (`filesFound`, `filesProcessed`, `collectionsCreated`, `mediaCreated`, `errors[]`, plus the full `newMediaIds`/`newCollections` arrays, which are stored as the job return value in Redis). The UI reads `result` from `GET /:id/scan` and shows it in a tooltip.

### Folder → Collection mapping

`getCollectionType(libraryType, depth)` (`libraryScanWorker.ts:212`, duplicated at `fileWatcherService.ts:638`):

| Library | depth 0 | depth 1 | deeper |
|---------|---------|---------|--------|
| Television | Show | Season | Generic |
| Film | Film | Generic | Generic |
| Music | Artist | Album | Generic |

Every non-hidden directory that does not end in `.trickplay` becomes a collection, whatever it contains (an `Extras/` or `Subs/` folder in a film becomes a Generic child collection). Collections are looked up by `(libraryId, name, parentId)`; if found and the computed type differs (e.g. the library's type was changed), the type is updated in place. Season number is parsed from the folder name with `/season\s*(\d+)/i`; film year from `parseMovieFromFilename(dir.name)`.

### File → Media mapping

For each file whose lower-cased extension is in the library's list:

- `Media.name` is the file basename, except in Film libraries where it is the immediate folder name (so "The Matrix (1999)" rather than "the.matrix.1999.1080p") — files directly in a Film library root fall back to the file basename.
- `Media.path` is the absolute joined path; existence is checked with `findFirst({ where: { path } })`. There is no unique index, so a race between the scan worker and the file watcher can insert duplicates.
- New files are probed with `probeMediaFile`; `duration` (rounded seconds, 0 on failure) is stored on `Media` and each video/audio/subtitle stream becomes a `MediaStream` row (`createMany`). Data/attachment streams are skipped. The watcher does the same on add.
- A sibling `<basename>.trickplay` directory is stored as `Media.thumbnails` (consumed by [Streaming & Transcoding](streaming-and-transcoding.md)).
- Existing files are counted in `filesProcessed` and otherwise untouched (no re-probe, no rename detection); in full-scan mode they are re-added to `newMediaIds` so they get re-scraped.

Music libraries go through exactly the same path (Artist/Album folders, Audio media, ffprobe streams), but the downstream `collectionScrapeWorker` logs "Artist/Album scraping not yet implemented" and `scrapeAudioMetadata` depends on a scraper exposing `searchAudio`, which neither bundled plugin does. So music imports produce a browsable tree with durations and no metadata.

### Scrape hints and enqueueing

For Video media the worker tries `parseEpisodeFromFilename(mediaName)` (`S01E02`, `1x02`, with separators `. _ - space`); if it matches, `showName` comes from the filename prefix or, failing that, from `getShowNameFromCollectionPath` (grandparent if the parent folder looks like "Season N"). Otherwise it is treated as a film: `parseMovieFromFilename` runs on the folder name if there is one, and only the `year` is kept — the `title` is discarded in the scan worker (the watcher, by contrast, replaces `mediaName` with the parsed title at `fileWatcherService.ts:489`).

After the walk:

- Media scrape jobs are bulk-added for all `newMediaIds` **unless the library is Film** (`libraryScanWorker.ts:104`): film metadata is attached to the Film collection, not the media. The watcher does not apply this rule and queues a media scrape for every new film file.
- Collection scrape jobs are bulk-added for Show, Season, Film, Artist and Album collections, ordered Shows → Seasons → Films → Artists → Albums so a season's parent show is likely scraped first. Seasons carry `parentShowId` and `seasonNumber`; films carry `year`. Everything else about matching lives in [Metadata Scraping](metadata-scraping.md).

Note that Film-library media names are the folder name, so a subsequent `parseTitleAndYear` in the scrape workers (82f6d5c) yields a clean title+year for both the collection and, in the watcher path, the media.

### File watcher

Enabled at boot if `FILE_WATCHER_ENABLED=true` or `fileWatcher.enabled` in `tubeca.config.json`; `usePolling` and `pollInterval` come only from the config file. One chokidar watcher per library with `watchForChanges`, `ignoreInitial: true`, `depth: 10`, `awaitWriteFinish` (2 s stability), hidden and `.trickplay` paths ignored. Events:

- `add` → filtered by extension, debounced 2 s per path, then `processNewFile`: `getOrCreateCollectionPath` walks the relative path creating any missing collections by depth, probes the file, creates `Media`/`MediaStream`, and enqueues a single metadata-scrape job.
- `addDir` → debounced, `processNewDirectory` creates the collection (and its ancestors) and enqueues a collection-scrape job for scrape-able types.
- `unlink` → after 100 ms, `prisma.media.delete` for the matching path (cascades details/images/streams in the DB; image files on disk are left behind, unlike `mediaService.deleteMedia`).
- `unlinkDir` → deliberately a no-op, to survive folder renames (which chokidar reports as unlinkDir+addDir). Collections are therefore never removed by the watcher.
- `change` is not handled, so an in-place re-encode does not re-probe.

`sync()` is called after every library create/update and reconciles the watcher map against the DB. Changing a library's `path` while it is watched is not detected — `sync` only checks whether the id is present, so the old path stays watched until restart.

### The DNS-threadpool / network-mount fix (4abe949)

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
- `fe77ae6` 2025-11-29 — Scrapers added; `mediaParser.ts` created and scan begins enqueueing scrape jobs with filename hints.
- `9600bde` 2025-11-30 — Metadata refresh; scan worker adjustments to hint plumbing.
- `aaeb5ea` 2025-11-30 — `ffprobe.ts` gains full stream probing; scan stores `MediaStream` rows (audio track switching).
- `bb82089` 2025-12-01 — File watcher service added (`watchForChanges` migration 20251130224247), semicolon lint, API docs.
- `1af4a83` 2025-12-02 — Film media named after folder rather than file; trickplay fixes.
- `e6b594e` 2025-12-02 — FilmDetails; scan skips media-scrape for Film libraries and passes film year to collection scrape.
- `d02715b` 2025-12-10 — Group-based library access control (`getAccessibleLibraries`, group picker in dialog).
- `3ce0d93` 2025-12-14 — "Full scan" option re-queues existing media/collections; cancel via job data flag; Quick/Full menu in UI.
- `4abe949` 2026-07-01 — DNS-threadpool starvation fix: 30 s poll + `binaryInterval`, `UV_THREADPOOL_SIZE=24`, c-ares DNS in TMDB scraper.
- `82f6d5c` 2026-09-02 — `parseTitleAndYear` (+ first parser tests) used by scrape workers and IdentifyDialog; frontend mirror in `utils/parseTitle.ts`.

## Known Limitations

- **No orphan cleanup on scan.** Files deleted or moved while the watcher is off (or for unwatched libraries) leave `Media` rows pointing at missing paths forever; a rename produces a duplicate row. Only the watcher's `unlink` removes media, and nothing ever removes collections for vanished folders.
- **Blocking filesystem I/O in the API process.** The scan uses `readdirSync`/`statSync`/`existsSync` and all workers run inside the Express process, so a large directory on a slow mount stalls request handling. `libraryService` validation is also sync.
- **Duplicate `Media` possible.** `Media.path` has no unique index and both the scan worker and watcher use find-then-create; a scan running while the watcher imports the same file creates two rows.
- **Watcher and worker logic are copy-pasted** (extension lists, `getCollectionType`, media creation, hint parsing) and have already diverged: the watcher queues media scrapes for Film libraries and uses the parsed title as `mediaName`; the worker does neither.
- **Case sensitivity.** Collections are matched by exact `name` and Prisma/SQLite default comparison; on case-insensitive filesystems a folder renamed only in case yields a second collection. Extensions are lower-cased, but `.MKV` files are matched while a folder named `Season 1` vs `season 1` is not deduplicated.
- **Symlink loops are not guarded.** Symlinked directories are followed with no visited-set, so a cycle recurses until stack overflow (the watcher's `depth: 10` bounds it there, the scan has no depth limit).
- **Non-media files are silently ignored**, including `.srt`/`.ass` subtitles, `.nfo` sidecars and cover art, so external subtitles are never imported.
- **Cancellation granularity is one directory**, and a cancelled scan still leaves everything created so far (no rollback); the job is marked failed with "Scan cancelled by user".
- **Progress is approximate and non-monotonic**, and `ScanResult.newMediaIds`/`newCollections` are stored in Redis as the return value for 24 h, which for a large library is a sizeable payload.
- **Library `path` edits are not applied to a running watcher**, and changing `libraryType` does not re-type existing collections until the next scan.
- **Music is import-only**: correct tree and durations, but no tag reading (ID3/Vorbis) and no scraper implementation.
- **Deleting a library orphans media rows** (`SetNull`) and leaves their image files on disk.
- **Single global scan concurrency** means one huge library blocks scans of every other library.

## Opportunities

- **Orphan reconciliation in the scan** (M): after the walk, `findMany` media/collections for the library not seen during this scan and delete or flag them; would also fix moved files if paired with size+mtime matching. Closes the biggest gap against "idempotent rescan".
- **Extract a shared `importService`** (M): one module for `getCollectionType`, extension lists, `createMediaFromFile`, `getOrCreateCollectionPath` and hint building, used by both the worker and watcher. Removes the existing divergence (Film media-scrape rule, parsed-title `mediaName`).
- **Add `@unique` on `Media.path`** (S) and switch the find-then-create to `upsert`/`create` with P2002 handling; makes worker/watcher races safe.
- **Use `fs.promises.readdir`/`stat`** in the scan and `libraryService` (S) so the API process stays responsive; consider `Promise.all` with a small concurrency limit for ffprobe (currently strictly serial, one process spawn per file).
- **Track visited real paths when following symlinks** (S) and add a depth cap to match the watcher.
- **Handle chokidar `change`** (S) to re-probe a re-encoded file and refresh `duration`/`MediaStream`.
- **Re-watch on path change** (S): in `sync()`, compare the stored path/type with the DB row and rebuild the watcher when they differ.
- **Tests for the untested parsers** (S): `parseEpisodeFromFilename` (`1x02`, `s1e2`, prefix show name, quality suffix), `parseMovieFromFilename` (the "2001 A Space Odyssey" case), `getShowNameFromCollectionPath`; and a worker test with an in-memory tree.
- **Import subtitle sidecars** (M): `.srt`/`.vtt` next to a video could become `MediaStream` rows of type Subtitle with an external path, which the subtitle route in [Streaming & Transcoding](streaming-and-transcoding.md) could serve.
- **Read audio tags with ffprobe `format.tags`** (M): the probe already runs; capturing title/artist/album/track would give the music library real names ahead of any scraper.
- **Use `parseTitleAndYear` in the scan worker** (S): the worker still discards the parsed title and only forwards `year`; passing the clean title as `mediaName` would align it with the watcher and the 82f6d5c intent.
- **Per-library worker concurrency** (S): give the queue a `libraryId`-based group or raise `concurrency` to 2 so one long scan does not block the others.
- **Directory-picker for `path`** (M): the dialog is a free-text field; a server-backed browse endpoint (admin-only) would prevent typos that are only caught by `existsSync`.
- **Bounded `ScanResult` return value** (S): keep counts and errors in the job return, and drop `newMediaIds`/`newCollections` once the scrape jobs are enqueued.
