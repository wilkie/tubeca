# Metadata Scraping & Scraper Plugins

> Metadata scraping is the subsystem that turns folder and file names discovered by the library scanner into rich metadata: descriptions, air/release dates, ratings, genres, keywords, cast and crew (linked to `Person` records), and artwork. It is built around a small plugin interface (`@tubeca/scraper-types`), two bundled plugins (TMDB and TVDB), two BullMQ queues/workers (one for collections, one for individual media files), and a manual "Identify" escape hatch for when automatic matching picks the wrong title.

## Responsibilities

- Define the `ScraperPlugin` contract that external metadata providers implement (search + fetch for series, seasons, episodes, movies, people, and stubbed audio/artist/album methods).
- Load and initialise configured plugins at server start from `tubeca.config.json` and expose them through a singleton `scraperManager`.
- Process `collection-scrape` jobs for `Show`, `Season`, and `Film` collections: search by name, take the first result, fetch details, and write `ShowDetails` / `SeasonDetails` / `FilmDetails`, credits, keywords, and images.
- Process `metadata-scrape` jobs for individual `Media` rows (TV episodes and non-Film-library movies): resolve the series, fetch the episode, write `VideoDetails`, credits, and images, and rename the media to the episode title.
- Rate-limit outbound API traffic (1 job at a time, 10 jobs / 10 s per worker) and retry transient network failures (in-plugin HTTP retries and BullMQ job retries).
- Provide user actions: "Refresh metadata", "Refresh images", and "Identify" (search + pick the right show/film) on collections, and refresh actions on media.
- Link credits to `Person` records across scrapers using IMDB/TMDB/TVDB IDs and download person photos.

## Goals

- **Zero-configuration matching**: a freshly scanned library should get posters, descriptions, and cast without user input; the code optimises for "first search result is usually right" rather than for precision.
- **Be gentle to third-party APIs**: single-concurrency workers with a limiter, HTTP keep-alive pooling, and skipping media-level scrapes in Film libraries (ffb9d2d) all exist to reduce request volume.
- **Survive a hostile network environment**: much of the recent work (ffb9d2d, 7052d0c) targets WSL2 + SMB mounts, where DNS lookups on the libuv threadpool stalled for 30-60 s; the TMDB plugin now uses c-ares DNS with a TTL cache and an undici `Agent` with explicit timeouts.
- **Re-scrapability**: job IDs are timestamped so a full scan or a refresh can re-run on an item that was already scraped (40a84a0), and details tables record `scraperId`/`externalId` so refreshes fetch by ID rather than re-searching.
- **Correctable**: the Identify feature (b088bdc) and the cleaner title/year parsing (27c0663) exist because first-result matching is visibly wrong often enough to need a manual override.
- **Extensible provider set**: the plugin interface anticipates music (audio/artist/album) scrapers and multiple video providers, though only video is implemented today.

## Components

| File | Role |
|------|------|
| `packages/scraper-types/src/index.ts` | `ScraperPlugin` interface plus `SearchResult`, `VideoMetadata`, `SeriesMetadata`, `SeasonMetadata`, `CreditInfo`, `PersonMetadata`, and audio/artist/album metadata shapes. All plugin methods are optional. |
| `backend/src/plugins/scraperLoader.ts` | `ScraperManager` singleton (`register`, `initialize`, `get`, `getByMediaType`, `getConfigured`, `list`) and `loadScrapers()`, which hard-codes dynamic imports of `@tubeca/scraper-tmdb` and `@tubeca/scraper-tvdb`. |
| `backend/src/config/appConfig.ts` | `getScraperConfigs()` reads `scrapers.<id>.{enabled,apiKey}` from `tubeca.config.json` and passes **only** `apiKey` to plugins (`:97-122`). |
| `backend/src/services/scraperService.ts` | A `ScraperService` class with search/apply helpers. **Dead code**: nothing imports it; the workers reimplement its logic with more features. |
| `scrapers/tmdb/src/index.ts` | TMDB plugin: movies, TV series, seasons, episodes, people, keywords, image selection; DNS cache, pooled agent, retry with backoff. |
| `scrapers/tvdb/src/index.ts` | TVDB v4 plugin: series search, series-as-video metadata, episode metadata, people. No season/series-collection support, no retries. |
| `backend/src/queues/collectionScrapeQueue.ts` | `collection-scrape` queue, `CollectionScrapeJobData`, single/bulk add helpers with show-before-season delay, queue status. |
| `backend/src/workers/collectionScrapeWorker.ts` | Worker for Show/Season/Film (Artist/Album stubbed). Writes `ShowDetails`/`SeasonDetails`/`FilmDetails`, `ShowCredit`/`FilmCredit`, `Keyword`, `Image`. |
| `backend/src/queues/metadataScrapeQueue.ts` | `metadata-scrape` queue, `MetadataScrapeJobData`, bulk add, queue status. |
| `backend/src/workers/metadataScrapeWorker.ts` | Worker for `Media` rows (Video and Audio). Writes `VideoDetails`/`AudioDetails`, `Credit`, `Image`; has `isRetryableError` gating BullMQ retries. |
| `backend/src/utils/mediaParser.ts` | Filename heuristics: `parseEpisodeFromFilename`, `parseMovieFromFilename`, `parseTitleAndYear` (27c0663), `getShowNameFromCollectionPath`. |
| `backend/src/routes/collections.ts` | `POST /api/collections/search` (`:223`), `POST /:id/refresh-metadata` (`:532`), `POST /:id/refresh-images` (`:623`), `POST /:id/identify` (`:730`). |
| `backend/src/routes/media.ts` | `POST /api/media/:id/refresh-metadata` (`:136`), `POST /:id/refresh-images` (`:208`), `GET /scrapers/list` (`:274`), `GET /scrapers/queue-status` (Admin). |
| `backend/src/workers/libraryScanWorker.ts` | Enqueues scrapes after a scan (`:103-190`); full-scan re-queue of existing items (`:381`, `:489`). |
| `backend/src/services/fileWatcherService.ts` | Enqueues scrapes for files/directories added while running (`:467-495`, `:555-581`). |
| `backend/src/services/personService.ts` | `findOrCreatePerson` (`:87`): IMDB > TMDB > TVDB > exact-name match. |
| `backend/src/services/imageService.ts` | `downloadAndSaveImage` (`:95`): fetches, writes `<type>.<ext>` under the entity folder, upserts the `Image` row. |
| `frontend/ui/src/components/IdentifyDialog.tsx` | Search-and-pick dialog for Show/Film collections; pre-fills from `parseTitleAndYear`. |
| `frontend/ui/src/utils/parseTitle.ts` | Frontend mirror of `parseTitleAndYear` (duplicated because `shared-types` is types-only). |
| `frontend/ui/src/components/CollectionOptionsMenu.tsx`, `pages/CollectionPage.tsx`, `pages/MediaPage.tsx` | Menu items and handlers for Identify / Refresh metadata / Refresh images. |

## How It Works

### Plugin contract and loading

`ScraperPlugin` declares `id`, `name`, `version`, `supportedTypes: ('video'|'audio')[]`, `initialize(config)`, `isConfigured()`, and a set of optional methods: `searchVideo`, `getVideoMetadata`, `searchSeries`, `getSeriesMetadata`, `getSeasonMetadata`, `getEpisodeMetadata`, `getPersonMetadata`, plus audio/artist/album equivalents that no plugin implements. Because every capability is optional, callers feature-test (`if (scraper.searchSeries && scraper.getSeriesMetadata)`) before use, and a plugin that lacks a method is silently skipped for that job type.

At boot `backend/src/index.ts:647` calls `getScraperConfigs(appConfig)` then `loadScrapers()`. The loader is not a discovery mechanism: it `await import()`s the two known packages if a config block exists for them, registers the factory's plugin, and calls `initialize()` on each. Both plugin `package.json` files carry a `"pluginType": "scraper"` marker that nothing reads. `getScraperConfigs` strips everything except `apiKey`, so the `language`, `baseUrl`, and `imageSize` options that both plugins accept in `initialize()` cannot be set from config; TMDB is always `en-US`/`w500` and TVDB always `eng`.

Configuration lives in `tubeca.config.json` under `scrapers.tmdb` / `scrapers.tvdb` with `enabled` and `apiKey` (see [Configuration](configuration.md)). A scraper with `enabled: false` or no key is skipped with a console warning. The file is git-ignored (only `tubeca.config.example.json` is committed); the developer's local copy has TVDB disabled.

### TMDB plugin

- **Transport** (`scrapers/tmdb/src/index.ts:20-95`): a module-level undici `Agent` with 10 s connect, 15 s header/body timeouts, keep-alive, and a custom `lookup` that uses `dns.resolve4` (c-ares, off the threadpool) with a 5-minute cache and a `dns.lookup` fallback. IPv4 only.
- **`request()`** (`:270-330`): appends `api_key` and `language`; up to 3 attempts with exponential backoff (1 s base, doubling, plus up to 1 s jitter) and a 10 s `AbortController` timeout per attempt. 4xx other than 429 are not retried. `isRetryableError` matches on error name/message substrings and undici `cause.code` prefixes.
- **Search** (`searchVideo`, `:430`): picks `/search/movie`, `/search/tv`, or `/search/multi` from `videoType`; passes `year` if provided; excludes `person` results. External IDs are prefixed `movie-` / `tv-`. `confidence` is set to `vote_average / 10`, i.e. it is a popularity proxy, not a match score. `searchSeries` is `searchVideo` with `videoType: 'tv_series'` and no year.
- **Details**: `getMovieMetadata` requests `/movie/{id}?append_to_response=credits,release_dates,keywords`; `getSeriesMetadata` requests `/tv/{id}` with `credits,content_ratings,keywords`; `getSeasonMetadata` requests `/tv/{id}/season/{n}`; `getEpisodeMetadata` makes two calls (`/tv/{id}` for the show name, then the episode with `credits`, merging `guest_stars` into cast). Content rating is the **US** certification only. Runtime for a series is `episode_run_time[0]`.
- **Images** (`getImageUrls`, `:372`): a second call to `/{type}/{id}/images?include_image_language=en,null`; backdrops are sorted by `vote_average`; `backdropUrl` is the top overall, `thumbnailUrl` the top English-language one, `logoUrl` the top English logo (else top overall). All at `original` size; posters at `w500`; person profiles at `w185`.
- **Credits** (`mapCredits`, `:660`): top 20 cast plus crew whose `job` is in a fixed map (Director, Writer, Screenplay, Producer, Executive Producer, Original Music Composer, Director of Photography, Editor). Each carries `tmdbId` and `photoUrl`; IMDB IDs are **not** included (only `getPersonMetadata` returns one, and nothing calls it).
- **Keywords**: movie keywords come from `keywords.keywords`, TV from `keywords.results`; returned as plain strings.

### TVDB plugin

- Authenticates with `POST /login` at `initialize()` and caches a bearer token for 29 days; `isConfigured()` is only true if that login succeeded, so a transient failure at boot silently disables TVDB until restart.
- `request()` is a bare `fetch` with `Accept-Language: eng`; no timeout, no retries, no pooled agent, none of the DNS mitigations applied to TMDB.
- `searchVideo` always queries `type: 'series'`, so TVDB can never match a film. `getVideoMetadata` returns series data shaped as `VideoMetadata` (artwork type 2/3/6 for poster/backdrop/logo, US content rating via `country === 'usa'`). `getEpisodeMetadata` lists a season's episodes and finds the one with the matching number, then tries `/episodes/{id}/extended` for characters.
- It implements **neither** `getSeriesMetadata` nor `getSeasonMetadata`, so the collection worker skips it for Show and Season jobs. In practice TVDB only participates in the media-level episode flow and in the `search`/Identify endpoint (where selecting a TVDB result for a Show will then fail at scrape time; see Limitations).
- Credits map TVDB character `type` codes 1/2/3/4 to director/writer/actor/producer, defaulting to actor, and carry `tvdbId`.

### Queues and workers

Both queues share identical defaults (`collectionScrapeQueue.ts:29-43`, `metadataScrapeQueue.ts:26-40`): `attempts: 3`, exponential backoff starting at 5 s (5 s, 10 s, 20 s), completed jobs kept 24 h / 1000 jobs, failed jobs kept 7 days. Job IDs are `collection-scrape-<id>-<timestamp>` / `scrape-<id>-<timestamp>`; the timestamp (40a84a0) prevents BullMQ's ID de-duplication from dropping re-scrapes of already-seen items.

Both workers are constructed with `concurrency: 1` and `limiter: { max: 10, duration: 10000 }`, so each queue processes at most 10 jobs per 10 s. A single job may issue 2-4 TMDB calls plus N image downloads plus up to ~28 person photo downloads, so the effective request rate is well above 1/s but still far below TMDB's published limits.

`addBulkCollectionScrapeJobs` (`collectionScrapeQueue.ts:66-115`) orders work so parents exist before children: Show jobs are added immediately, Season jobs with a `delay` of `max(5000, shows.length * 2000)` ms, and Film/Artist/Album jobs immediately. The delay is a guess, not a dependency; if a show job takes longer than 2 s (typical once image and photo downloads are counted) a season job can still run first and return `Missing parent show info` (`collectionScrapeWorker.ts:139`) as a **non-retried** "completed with success: false" result.

### Collection scrape flow (`collectionScrapeWorker.ts`)

1. Verify the collection still exists; dispatch on `collectionType`.
2. **Show**: the worker first marks the collection `Pending`. If the job carries `scraperId` + `externalId` (refresh/identify), `resolveByIdentity` fetches by id and **never** falls back to a search. Otherwise `resolveBySearch` asks each configured video scraper with `searchSeries` + `getSeriesMetadata` for candidates using `parseTitleAndYear(collectionName)`, scores them with `pickBestMatch` (see Matching below) and fetches details for the best one; scrapers that throw are skipped.
3. **Season** (`:118`): needs `parentExternalId`/`parentScraperId`; if absent it reads them from the parent's `ShowDetails`. Calls `getSeasonMetadata` on the parent's scraper. No search fallback.
4. **Film**: same shape as Show with `year ?? parsed.year` in the query (both as a TMDB filter and in the score) and `videoType: 'movie'`.
5. **Artist / Album** (`:215-226`): return `{ success: false, error: '... not yet implemented' }` with a `TODO`.
6. **Apply** (`applyShowMetadata :262`, `applySeasonMetadata`, `applyFilmMetadata :530`): upsert the details row (genres stored as a comma-joined string; `scraperId`/`externalId` recorded); download images unless `skipImages` is set *and* the entity already has at least one image; delete all existing `ShowCredit`/`FilmCredit` rows and recreate them one by one, calling `personService.findOrCreatePerson` and downloading a `Photo` for the person if none exists; upsert each keyword (lower-cased, trimmed) and connect it to the collection (`saveKeywords :232`, never disconnects stale keywords).
7. `imagesOnly` short-circuits step 6 to just the image downloads (used by "Refresh images").

Image types written for Show/Film collections: `Poster`, `Backdrop`, `Thumbnail`, `Logo`; for Seasons: `Poster` only. `ImageService.saveImage` overwrites an existing row of the same type for the same entity and unsets other primaries, so refreshes replace rather than accumulate (see [Images](images.md)).

### Media scrape flow (`metadataScrapeWorker.ts`)

1. Verify the media exists; branch on `mediaType`.
2. **Video** (`scrapeVideoMetadata`): marks the media `Pending`; with `scraperId` + `externalId` it uses `resolveByIdentity` (no search fallback). Otherwise `isEpisode = season !== undefined && episode !== undefined`. For episodes: `resolveBySearch` over `searchSeries(showName || extractShowName(mediaName))`, scored against the show name, then `getEpisodeMetadata(seriesId, season, episode)`. For movies: `parseTitleAndYear(mediaName)`, `searchVideo(title, { year })` with no `videoType` (so TMDB uses `/search/multi`), scored, then `getVideoMetadata`.
3. `resolveBySearch` collects per-scraper errors; if **every** scraper threw and the last error is retryable (`isRetryableError` in `scrapeResolution.ts`), the attempt is `failed`/retryable and the worker re-throws so BullMQ retries. A confident miss is `nomatch` and completes the job with `success: false`. Either way the outcome is written to the media row (see below).
4. **Apply** (`applyVideoMetadata :232`): upsert `VideoDetails` (`showName`, `season`, `episode`, `description`, `releaseDate`, `rating`); if `episodeTitle` is present, **overwrite `Media.name`** with it; download `Poster`/`Backdrop`/`Thumbnail` (episodes only ever get a `Poster` from the TMDB still); delete and recreate `Credit` rows with person linking and photo download as above.
5. **Audio** (`scrapeAudioMetadata :168`): identical structure calling `searchAudio`/`getAudioMetadata`; since no plugin declares `'audio'` in `supportedTypes` it always returns `No audio scrapers configured`.

`VideoDetails` has no `scraperId`/`externalId` columns, so media-level refresh cannot fetch by ID and must re-search; `routes/media.ts:216-222` contains an empty `if` acknowledging this.

### What enqueues scrapes

- **Library scan** (`libraryScanWorker.ts:103-190`): after a scan, new media get `metadata-scrape` jobs **unless the library type is Film** (ffb9d2d: the Film collection already carries the metadata). New Show/Season/Film/Artist/Album collections get `collection-scrape` jobs via the bulk helper; Film jobs carry a `year` parsed with `parseMovieFromFilename`. With `fullScan: true` (ffb9d2d), existing media and collections are pushed into the same "new" lists (`:381`, `:489`) and therefore re-scraped **with images re-downloaded** (no `skipImages`).
- **File watcher**: new files and directories are enqueued individually through the same `ImportService.queueMediaScrapes`/`queueCollectionScrapes` the scanner uses, so (since 2026-09-03) it also skips media-level scrapes for Film libraries.
- **Refresh metadata** (`collections.ts:532`, `media.ts:136`): Editor+; re-enqueues with the stored `scraperId`/`externalId` (collections only) and `skipImages: true`. The frontend fires the request and immediately clears its spinner; there is no completion feedback.
- **Refresh images**: same with `imagesOnly: true`.
- **Identify** (`collections.ts:730`): Editor+, Show/Film only. Deletes every `Image` row for the collection, upserts `ShowDetails`/`FilmDetails` with the chosen `scraperId`/`externalId`, and enqueues a collection scrape carrying both. `POST /api/collections/search` (`:223`) fans out to every configured scraper (`searchSeries` for Show, `searchVideo` with `year` and `videoType: 'movie'` for Film) and returns a flat list; unlike the dead `ScraperService.searchVideo`, it does not sort by confidence. `IdentifyDialog` pre-fills the query and year from `parseTitleAndYear(collectionName)` (frontend mirror), lets the user edit both, shows poster/title/year/overview per result, and on selection calls `identifyCollection` then `onIdentified()`, which reloads the page while the scrape is still queued.

### Title parsing (27c0663)

`parseTitleAndYear` prefers a bracketed year (`"Blade Runner 2049 (2017)"` keeps its digits) and falls back to a bare trailing year (`"Dune 2021"`). It is used in both workers and the dialog, replacing the earlier behaviour of sending `"Name (Year)"` verbatim to TMDB. The import path now derives the `year` hint with `parseTitleAndYear` as well, so the scanner, watcher and scrape workers agree; `parseMovieFromFilename` (release-name oriented, strips quality tags) remains only as a utility.

### Matching (`scrapeMatching.ts`)

`pickBestMatch(query, results)` scores every candidate instead of trusting the provider's order. `titleSimilarity` normalises both titles (lower-case, diacritics and punctuation stripped, `&` → `and`, leading article dropped) and returns 1 for equality, 0.6-0.9 when one contains the other, else a token-overlap fraction scaled to 0.7. A known query year adds 0.25 for an exact match, 0.1 for ±1 and subtracts 0.3 otherwise; the scraper's `confidence` (TMDB popularity) contributes at most 0.05 and list position breaks remaining ties. Anything under `DEFAULT_MIN_SCORE` (0.55) is rejected, so "Blade Runner (1982)" no longer becomes *Blade Runner 2049* because the sequel is more popular, and an unrelated first hit becomes a visible "no match" rather than wrong metadata.

### Outcomes and status (`scrapeResolution.ts`)

Every scrape ends in a `ScrapeAttempt`: `matched`, `nomatch` (with a human message such as `No confident match for "Heat (1995)"`) or `failed` (with `retryable`). The worker records it on the entity (`Collection`/`Media.scrapeStatus`, `scrapeMessage`, `scrapedAt`; `Pending` is written when a job is queued by `ImportService` and again when it starts) and maps it to the job result: `matched` → `success: true`; `nomatch` → `success: false` (BullMQ counts it as completed); `failed` + retryable → re-throw so BullMQ retries, with the row already marked `Failed`.

- **Identified items never fall back**: when a job carries `externalId` + `scraperId`, an empty or failed by-id fetch is reported as a retryable failure with "identification kept"; the user's Identify choice and the previous metadata survive a network blip. (Before 2026-09-03 the worker fell through to a name search on the same scraper and could overwrite it with the first hit.)
- **The UI shows the outcome**: `ScrapeStatusAlert` on `CollectionPage` and `MediaPage` renders an info/warning/error alert for `Pending`/`NoMatch`/`Failed` with the message, plus Identify (Shows and Films) and Retry buttons for editors; matched items show nothing extra. Failed jobs also remain in Redis for 7 days; `GET /api/media/scrapers/queue-status` exposes counts for the metadata queue to Admins, and no frontend page calls it.

## Interactions

- **Depends on:** [Libraries & Scanning](libraries-and-scanning.md) (scan worker and file watcher enqueue all automatic scrapes and supply name/year/season/episode hints); [Content Model](content-model.md) (`Collection`, `Media`, the `*Details` and `*Credit` tables, `Keyword`, `Person`); [Images](images.md) (`ImageService.downloadAndSaveImage` stores every artwork and photo); [Configuration](configuration.md) (`tubeca.config.json` scraper keys, `UV_THREADPOOL_SIZE=24` in backend scripts); [Auth & Users](auth-and-users.md) (`requireRole('Editor')` on refresh/identify, `Admin` on queue status); Redis/BullMQ from [Deployment](deployment.md).
- **Used by:** [Frontend App](frontend-app.md) (CollectionPage/MediaPage menus, `IdentifyDialog`, hero views that display genres, ratings, keywords, cast); [Search](search.md) (keywords and descriptions are indexed); [Content Model](content-model.md) pages for people/filmography rely on `Person` links created here.
- **Shared data:** writes `ShowDetails`, `SeasonDetails`, `FilmDetails`, `VideoDetails`, `AudioDetails`, `ShowCredit`, `FilmCredit`, `Credit`, `Person`, `Keyword` (+ `Collection.keywords`), `Image`, and `Media.name`; reads `Collection`, `Media`, `ShowDetails` (parent lookup). Queues: `collection-scrape`, `metadata-scrape`. Config keys: `scrapers.tmdb`, `scrapers.tvdb`.

## History

- `41cf2f0` 2025-11-29 — Adds scrapers and metadata for collections and media: plugin types, loader, TMDB/TVDB plugins, both queues/workers, `ScraperService`.
- `b3fb3ee` 2025-11-29 — Adds image scraping and rendering: `ImageService`, poster/backdrop downloads from workers.
- `3404584` 2025-11-30 — Adds image dialog and metadata refresh; `refresh-metadata`/`refresh-images` endpoints, `skipImages`/`imagesOnly` job flags.
- `a3f2f55` 2025-11-30 — Adds people listing and linking: `Person` model, `findOrCreatePerson`, credit-to-person linking and photo download in both workers.
- `d7d4c32` 2025-12-01 — Lint (semicolons), API docs, file watcher that enqueues scrapes for new files/dirs.
- `a52dbe1` 2025-12-02 — Adds `FilmDetails`, `Keyword`; TMDB fetches keywords; collection worker stores film metadata and keywords.
- `f7f96fd` 2025-12-02 — Library sorting and film user-rating fixes touching film metadata.
- `ffb9d2d` 2025-12-14 — Full scan option; skip media scrapes in Film libraries; TMDB retry/backoff and undici agent; `isRetryableError` gating in the media worker.
- `40a84a0` 2025-12-15 — Fix full scan not re-scraping: timestamped job IDs; delayed season jobs so parent shows finish first.
- `b088bdc` 2025-12-15 — Identify feature: `POST /collections/search`, `POST /collections/:id/identify`, `IdentifyDialog`, menu item.
- `7052d0c` 2026-07-01 — DNS threadpool starvation fix: c-ares lookup with TTL cache in the TMDB agent; `UV_THREADPOOL_SIZE=24`.
- `27c0663` 2026-09-02 — `parseTitleAndYear` for clean title/year in both workers and the Identify dialog pre-fill, with tests; frontend mirror in `utils/parseTitle.ts`.
- 2026-09-03 — `scrapeMatching.ts` (scored candidate selection with a threshold) and `scrapeResolution.ts` (identity-first resolution with no search fallback, outcome recording); `scrapeStatus`/`scrapeMessage`/`scrapedAt` on `Collection` and `Media` (migration `20260903130000_scrape_status`); `ScrapeStatusAlert` in the UI.

## Known Limitations

- **Scoring is title+year only**: `originalTitle` and alternative titles are not compared, so a folder named in a different language than the provider's `en-US` title scores low and is reported as no match; the threshold is a constant, not configurable.
- **English/US hard-coded**: TMDB `en-US`, `include_image_language=en,null`, US certification; TVDB `eng`, `usa`. `ScraperConfig.language` exists but `getScraperConfigs` drops it.
- **TVDB is effectively unusable for collections**: no `getSeriesMetadata`/`getSeasonMetadata`, series-only search, no timeouts or retries. It appears in Identify results for Shows, but picking one produces a job that returns `success: false`.
- **Music is a stub**: Artist/Album jobs and Audio media jobs are enqueued on every scan of a Music library and always complete with `not yet implemented` / `No audio scrapers configured`.
- **Status is per item, not per library**: there is no list of unmatched items or a count on the library page; refresh buttons still return before the job runs, and the page does not poll, so a user sees `Pending` until they reload. Identify still reloads the page before new data or images exist.
- **TMDB still returns `null` for both "missing" and "error"** on by-id fetches; the worker treats both as a retryable failure for identified items, which means a genuinely deleted TMDB entry will be retried three times and then sit at `Failed`.
- **Season ordering by timer**: the `max(5 s, 2 s x shows)` delay is a heuristic; late season jobs fail without retry and the season keeps only its folder name.
- **Identify does not cascade**: re-identifying a Show does not re-scrape its Seasons or episode `Media` rows, which retain the old show's data and images.
- **Media rows cannot be refreshed by ID or identified**: `VideoDetails` lacks `scraperId`/`externalId`; media-level refresh re-searches by name, and there is no Identify for episodes.
- **`Media.name` is overwritten** with the scraped episode title with no record of the original filename-derived name; a wrong match renames the file's entry.
- **Full scan re-downloads all artwork** for every existing item because re-queued jobs omit `skipImages`.
- **Person merging by exact name** as the last resort in `findOrCreatePerson` can conflate different people with the same name across works; TMDB credits never include an IMDB ID, so the "most reliable" key is never populated.
- **No caching of provider responses**: every episode job re-fetches `/tv/{id}` for the show name, every show/film job re-fetches `/images`; refreshes redo full detail calls; a season's episodes each trigger a fresh series search.
- **Sequential, non-transactional credit rewrite**: `deleteMany` then per-credit `create` (+ person lookup + photo fetch) runs outside a transaction; a crash mid-way leaves a collection with partial credits.
- **Secrets were in history**: `tubeca.config.json` with live keys was committed early on; it was purged from history and the keys rotated on 2026-09-03, but clones from before that date still carry it.
- **Tests**: only `mediaParser.test.ts` and `parseTitle.test.ts` (both from 27c0663) and a menu-visibility test in `CollectionOptionsMenu.test.tsx`. No tests for the plugins, loader, workers, queue helpers, `personService`, or the search/identify routes.

## Opportunities

- **Unify the two workers' apply/download/credit code** (M): `downloadCollectionImages`, `downloadFilmImages`, `downloadMediaImages`, three near-identical credit loops, and three copies of `mapCreditType` (plus a fourth in the dead `ScraperService`) could become one `metadataApplyService`; delete `scraperService.ts` or make it the shared implementation.
- **Score `originalTitle` too and expose scores in Identify** (S): `pickBestMatch` could take alternative titles, and `/collections/search` could return and sort by the score so the dialog's ordering matches the worker's.
- **Library-level scrape overview** (M): an "unmatched items" filter or count per library (a `where: { scrapeStatus: 'NoMatch' }` query) and polling of `scrapeStatus` on the page after Refresh/Identify so `Pending` resolves without a reload.
- **Make Identify cascade** (S/M): after a Show identify, re-enqueue its Season children and episode `Media` with the new external ID; add `scraperId`/`externalId` to `VideoDetails` and an episode-level Identify.
- **Distinguish "null because error" from "null because missing"** (S): have plugins throw on transport errors and return `null` only on 404, so an identified item whose provider entry vanished becomes `NoMatch` instead of a retried `Failed`.
- **Replace the season delay with a dependency** (S): enqueue Season jobs from the Show job's success path (or use BullMQ flows) so ordering is guaranteed.
- **Pass language/region through config** (S): forward `language`, `region`, `imageSize` from `tubeca.config.json` to `initialize()`; make certification country follow region.
- **Cache provider responses** (S/M): an in-memory or Redis TTL cache keyed by endpoint+params would remove the repeated `/tv/{id}` and `/images` calls and make refreshes/full scans cheap.
- **Skip image re-download on full scan** (S): set `skipImages: true` for re-queued existing items, or compare `Image.sourceUrl` before fetching.
- **Harden TVDB or drop it** (M): add `getSeriesMetadata`/`getSeasonMetadata`, timeouts, retries, and the pooled agent; or remove it from `/collections/search` results for Shows until it can complete the job.
- **Real plugin discovery** (M): scan `scrapers/*` or a configured directory for packages with `pluginType: "scraper"` instead of hard-coded imports, and expose `scraperManager.list()` in an admin UI.
- **Music scrapers** (L): implement MusicBrainz (or similar) against the already-defined `AudioMetadata`/`ArtistMetadata`/`AlbumMetadata` shapes and the stubbed worker branches.
- **Tests** (M): unit tests for both plugins against recorded JSON fixtures (search mapping, image selection, credit mapping, retry logic); worker tests with a fake plugin covering match/no-match/error paths and the `skipImages`/`imagesOnly` flags; route tests for search/identify; `findOrCreatePerson` precedence.
- **Move `parseTitleAndYear` to a runtime shared package** (S): the frontend copy exists only because `shared-types` is types-only; a small `@tubeca/shared-utils` would remove the drift risk between the two parsers.
- **Keep original names and prune stale keywords** (S): store `originalName` on `Media` before overwriting with the episode title, and `set` rather than `connect` keywords so a re-identify does not accumulate the previous title's tags.
