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
| `backend/src/config/appConfig.ts` | `getScraperConfigs()` reads `scrapers.<id>` from `tubeca.config.json` and hands the whole block (minus our own `enabled` flag) to the plugin, so `language`, `region`, `imageSize` and `baseUrl` reach `initialize()`. |
| `backend/src/workers/__tests__/{metadataScrapeWorker,collectionScrapeWorker}.test.ts` | 52 cases driving the processors BullMQ would call: search vs. by-id paths, the episode and season cascades, images-only and skip-images, keywords, credits, and what is retried versus recorded as a miss. |
| `scrapers/{tmdb,tvdb}/src/__tests__/*.test.ts` | 78 cases against a stubbed `fetch`: search mapping and id prefixes, image and logo selection, credit and certification mapping, TVDB's token exchange, season resolution and translation fallback, and both plugins' retry and give-up rules. |
| `backend/src/plugins/__tests__/scraperLoader.test.ts` | 11 cases: which plugins a configuration loads, config passed through, a failed `initialize` not taking the others down, and the registry's lookups. |
| `scrapers/tmdb/src/index.ts` | TMDB plugin: movies, TV series, seasons, episodes, people, keywords, image selection; DNS cache, pooled agent, retry with backoff. |
| `scrapers/tvdb/src/index.ts` | TVDB v4 plugin: series and film search, show, season, film, episode and person metadata; 10 s timeout and three attempts per request. |
| `packages/scraper-http/src/index.ts` | The pooled undici agent and c-ares DNS cache both plugins dispatch through, shared since 2026-09-04 rather than copied. |
| `backend/src/queues/collectionScrapePlan.ts` | Job shapes (`CollectionScrapeJobData`, `CascadeDepth`) and `planCollectionScrapeJobs()`, the pure rule for what a bulk request queues. Separate from the queue so it can be tested without Redis. |
| `backend/src/queues/collectionScrapeQueue.ts` | `collection-scrape` queue, single/bulk add helpers, queue status. Re-exports the plan module. |
| `backend/src/workers/collectionScrapeWorker.ts` | Worker for Show/Season/Film (Artist/Album stubbed). Writes `ShowDetails`/`SeasonDetails`/`FilmDetails`, `ShowCredit`/`FilmCredit`, `Keyword`, `Image`. |
| `backend/src/queues/metadataScrapeQueue.ts` | `metadata-scrape` queue, `MetadataScrapeJobData`, bulk add, queue status. |
| `backend/src/workers/metadataScrapeWorker.ts` | Worker for `Media` rows (Video and Audio). Writes `VideoDetails`/`AudioDetails`, `Credit`, `Image`; has `isRetryableError` gating BullMQ retries. |
| `backend/src/services/scrapeApply.ts` | The parts every entity type shares: `downloadArtwork` (one loop for poster/backdrop/thumbnail/logo/album art), `shouldDownloadArtwork`, `applyCredits` (person linking, cast photos) and the single `mapCreditType`. |
| `backend/src/services/scrapeCascade.ts` | `queueSeasonScrapes` and `queueEpisodeScrapes`: carry a show's identity down to its seasons and episodes once it has been matched. |
| `backend/src/services/scrapeCache.ts` | `cachedCall`/`scrapeCacheKey`: a 10-minute in-process cache over provider calls that also shares in-flight requests. |
| `backend/src/utils/mediaParser.ts` | Filename heuristics: `parseEpisodeFromFilename`, `parseTitleAndYear` (27c0663), `getShowNameFromCollectionPath`. |
| `backend/src/routes/collections.ts` | `POST /api/collections/search` (`:223`), `POST /:id/refresh-metadata` (`:532`), `POST /:id/refresh-images` (`:623`), `POST /:id/identify` (`:730`). |
| `backend/src/routes/media.ts` | `POST /api/media/:id/refresh-metadata` (`:136`), `POST /:id/refresh-images` (`:208`), `GET /scrapers/list` (`:274`), `GET /scrapers/queue-status` (Admin). |
| `backend/src/workers/libraryScanWorker.ts` | Enqueues scrapes after a scan (`:103-190`); full-scan re-queue of existing items (`:381`, `:489`). |
| `backend/src/services/fileWatcherService.ts` | Enqueues scrapes for files/directories added while running (`:467-495`, `:555-581`). |
| `backend/src/services/personService.ts` | `findOrCreatePerson` (`:87`): IMDB > TMDB > TVDB > exact-name match. |
| `backend/src/services/imageService.ts` | `downloadAndSaveImage` (`:95`): fetches, writes `<type>.<ext>` under the entity folder, upserts the `Image` row. |
| `frontend/ui/src/components/IdentifyDialog.tsx` | Search-and-pick dialog for Show/Film collections; pre-fills from `parseTitleAndYear`. |
| `frontend/ui/src/utils/parseTitle.ts` | Frontend mirror of `parseTitleAndYear` (duplicated because `shared-types` is types-only). |
| `frontend/ui/src/components/CollectionOptionsMenu.tsx`, `pages/CollectionPage.tsx`, `pages/MediaPage.tsx` | Menu items and handlers for Identify / Refresh metadata / Refresh images. |

### Finding what did not match (`scrapeOverview.ts`)

Per-item status has been on the collection and media pages since 2026-09-03, which answers the
question one item at a time. On a library of thirty thousand files that is not an answer at all —
nobody opens thirty thousand pages to find the eleven that failed. Two queries turn it into a list:

- `getScrapeOverview(libraryId)` groups `Collection` and `Media` by `scrapeStatus` and returns
  counts, with a null status reported as the synthetic `Unscraped`.
- `listUnmatched(libraryId, { statuses, kind, skip, take })` pages the items themselves, most
  recent attempt first so whatever just failed is at the top; items never attempted have no
  timestamp to rank by and follow, by name. Neither half can be paged independently of the other,
  so both are fetched to the end of the requested window and merged.

They are served by `GET /api/libraries/:id/scrape-status` and `GET /api/libraries/:id/unmatched`,
both checking `canUserAccessLibrary` inline the way the rest of that router does.
`LibraryScrapeStatusPage` (`/library/:libraryId/metadata`) shows the counts as filter chips over
the list; `LibraryToolbar` carries a badge of the `NoMatch` plus `Failed` count that opens it.

## How It Works

### Plugin contract and loading

`ScraperPlugin` declares `id`, `name`, `version`, `supportedTypes: ('video'|'audio')[]`, `initialize(config)`, `isConfigured()`, and a set of optional methods: `searchVideo`, `getVideoMetadata`, `searchSeries`, `getSeriesMetadata`, `getSeasonMetadata`, `getEpisodeMetadata`, `getPersonMetadata`, plus audio/artist/album equivalents that no plugin implements. Because every capability is optional, callers feature-test (`if (scraper.searchSeries && scraper.getSeriesMetadata)`) before use, and a plugin that lacks a method is silently skipped for that job type.

At boot `backend/src/index.ts:647` calls `getScraperConfigs(appConfig)` then `loadScrapers()`. The loader is not a discovery mechanism: it `await import()`s the two known packages if a config block exists for them, registers the factory's plugin, and calls `initialize()` on each. Both plugin `package.json` files carry a `"pluginType": "scraper"` marker that nothing reads. `getScraperConfigs` passes the scraper's whole config block through, minus the `enabled` flag that belongs to us rather than the plugin, so `language`, `region`, `imageSize`, `baseUrl` and any option a plugin invents reach `initialize()`. The language code is the provider's own (TMDB wants `en-US`, TVDB wants `eng`), which is why it is set per scraper rather than once for the app. Defaults are unchanged when nothing is set.

Configuration lives in `tubeca.config.json` under `scrapers.tmdb` / `scrapers.tvdb` with `enabled`, `apiKey` and the optional locale keys (see [Configuration](configuration.md)). A scraper with `enabled: false` or no key is skipped with a console warning. The file is git-ignored (only `tubeca.config.example.json` is committed); the developer's local copy has TVDB disabled.

### TMDB plugin

- **Transport** (`scrapers/tmdb/src/index.ts:20-95`): a module-level undici `Agent` with 10 s connect, 15 s header/body timeouts, keep-alive, and a custom `lookup` that uses `dns.resolve4` (c-ares, off the threadpool) with a 5-minute cache and a `dns.lookup` fallback. IPv4 only.
- **`request()`** (`:270-330`): appends `api_key`, `language` and, when configured, `region`; up to 3 attempts with exponential backoff (1 s base, doubling, plus up to 1 s jitter) and a 10 s `AbortController` timeout per attempt. 4xx other than 429 are not retried. `isRetryableError` matches on error name/message substrings and undici `cause.code` prefixes.
- **Search** (`searchVideo`, `:430`): picks `/search/movie`, `/search/tv`, or `/search/multi` from `videoType`; passes `year` if provided; excludes `person` results. External IDs are prefixed `movie-` / `tv-`. `confidence` is set to `vote_average / 10`, i.e. it is a popularity proxy, not a match score. `searchSeries` is `searchVideo` with `videoType: 'tv_series'` and no year.
- **Details**: `getMovieMetadata` requests `/movie/{id}?append_to_response=credits,release_dates,keywords`; `getSeriesMetadata` requests `/tv/{id}` with `credits,content_ratings,keywords`; `getSeasonMetadata` requests `/tv/{id}/season/{n}`; `getEpisodeMetadata` makes two calls (`/tv/{id}` for the show name, then the episode with `credits`, merging `guest_stars` into cast). Content rating is the **US** certification only. Runtime for a series is `episode_run_time[0]`.
- **Images** (`getImageUrls`, `:372`): a second call to `/{type}/{id}/images?include_image_language=en,null`; backdrops are sorted by `vote_average`; `backdropUrl` is the top overall, `thumbnailUrl` the top English-language one, `logoUrl` the top English logo (else top overall). All at `original` size; posters at `w500`; person profiles at `w185`.
- **Credits** (`mapCredits`, `:660`): top 20 cast plus crew whose `job` is in a fixed map (Director, Writer, Screenplay, Producer, Executive Producer, Original Music Composer, Director of Photography, Editor). Each carries `tmdbId` and `photoUrl`; IMDB IDs are **not** included (only `getPersonMetadata` returns one, and nothing calls it).
- **Keywords**: movie keywords come from `keywords.keywords`, TV from `keywords.results`; returned as plain strings.

### TVDB plugin

- Authenticates with `POST /login` at `initialize()` and caches a bearer token for 29 days; `isConfigured()` is only true if that login succeeded, so a transient failure at boot silently disables TVDB until restart.
- `request()` is a bare `fetch` with `Accept-Language: eng`; no timeout, no retries, no pooled agent, none of the DNS mitigations applied to TMDB.
- `searchVideo` queries `type: 'movie'` for a film and `type: 'series'` for everything else (2026-09-04); TVDB searches one kind at a time and its ids carry the kind, so the request and the result agree. `getVideoMetadata` routes a `movie-` id to `/movies/{id}/extended` (artwork ids 14/15/25, US certificate, `first_release` for the date) and otherwise returns series data shaped as `VideoMetadata` (artwork type 2/3/23 for poster/background/clearlogo, US content rating via `country === 'usa'`). `getEpisodeMetadata` lists a season's episodes and finds the one with the matching number, then tries `/episodes/{id}/extended` for characters.
- `getSeriesMetadata` (2026-09-04) reads the same `/series/{id}/extended` record as the video form but keeps what a Show collection wants: first and last air dates, `status.name`, genres, tags as keywords, and a season count taken from the aired ordering only — a show also carries DVD, absolute and regional orderings, and counting those would double the seasons.
- `getSeasonMetadata` (2026-09-04) resolves a season number to a season id through the series record, then reads `/seasons/{id}/extended`. In practice that record carries neither a name nor an overview — v4 keeps both in translations — so it also reads `/seasons/{id}/translations/{language}`, but only when the record's `overviewTranslations`/`nameTranslations` list that language; a season with none costs no request instead of a 404. Those lists sometimes arrive as one comma-joined string rather than one code per entry, so they are split before being read. The air date is the earliest episode's, since the season record carries none.
- No rating: v4's `score` is a popularity count (3,776,757 for Breaking Bad), not the 0-10 average `SeriesMetadata.rating` means and `Collection.sortRating` sorts by, and the record carries nothing else that is one.
- Every request has a 10-second deadline and up to three attempts with exponential backoff for a timeout, a dropped connection, a 5xx or a 429; a 4xx is taken as an answer (2026-09-04). Before that a hung request could stall the one job a scrape worker runs at a time, indefinitely.
- Credits map TVDB character `type` codes 1/2/3/4 to director/writer/actor/producer, defaulting to actor, and carry `tvdbId`. Capped at twenty as TMDB's are (2026-09-04): a film lists nearly sixty characters, and each one is a person row, a lookup and a photo.

### Queues and workers

Both queues share identical defaults (`collectionScrapeQueue.ts:29-43`, `metadataScrapeQueue.ts:26-40`): `attempts: 3`, exponential backoff starting at 5 s (5 s, 10 s, 20 s), completed jobs kept 24 h / 1000 jobs, failed jobs kept 7 days. Job IDs are `collection-scrape-<id>-<timestamp>` / `scrape-<id>-<timestamp>`; the timestamp (40a84a0) prevents BullMQ's ID de-duplication from dropping re-scrapes of already-seen items.

Both workers are constructed with `concurrency: 1` and `limiter: { max: 10, duration: 10000 }`, so each queue processes at most 10 jobs per 10 s. A single job may issue 2-4 TMDB calls plus N image downloads plus up to ~28 person photo downloads, so the effective request rate is well above 1/s but still far below TMDB's published limits.

`addBulkCollectionScrapeJobs` delegates to `planCollectionScrapeJobs`, which makes ordering a dependency rather than a race. A season can only be looked up through its show's external id, so a season whose show is in the same batch is **not** queued: the show job queues it from its own success path, with the identity it just found (`queueSeasonScrapes`). Seasons whose show is not in the batch, such as a re-scrape of one season, are queued directly and read the identity from `ShowDetails` as before. Shows are ordered ahead of films and albums so they reach the provider first. Nothing is delayed any more.

Before 2026-09-03 season jobs carried a `delay` of `max(5000, shows.length * 2000)` ms and hoped the show jobs had finished; a show job that took longer left the season with `Missing parent show info` and no retry.

### Collection scrape flow (`collectionScrapeWorker.ts`)

1. Verify the collection still exists; dispatch on `collectionType`.
2. **Show**: the worker first marks the collection `Pending`. If the job carries `scraperId` + `externalId` (refresh/identify), `resolveByIdentity` fetches by id and **never** falls back to a search. Otherwise `resolveBySearch` asks each configured video scraper with `searchSeries` + `getSeriesMetadata` for candidates using `parseTitleAndYear(collectionName)`, scores them with `pickBestMatch` (see Matching below) and fetches details for the best one; scrapers that throw are skipped. On a match, a job carrying `cascade` queues the show's seasons (see Cascading below).
3. **Season**: needs `parentExternalId`/`parentScraperId`; if absent it reads them from the parent's `ShowDetails`. Calls `getSeasonMetadata` on the parent's scraper. No search fallback. With `cascade: 'all'` it queues the season's episodes on success.
4. **Film**: same shape as Show with `year ?? parsed.year` in the query (both as a TMDB filter and in the score) and `videoType: 'movie'`.
5. **Artist / Album** (`:215-226`): return `{ success: false, error: '... not yet implemented' }` with a `TODO`.
6. **Apply** (`applyShowMetadata :262`, `applySeasonMetadata`, `applyFilmMetadata :530`): upsert the details row (genres stored as a comma-joined string; `scraperId`/`externalId` recorded); download artwork through the shared `downloadArtwork` unless `skipImages` is set *and* the entity already has at least one image; replace the `ShowCredit`/`FilmCredit` rows through the shared `applyCredits`, which links each credit with `personService.findOrCreatePerson` and downloads a `Photo` for a person who has none (skipped on a `skipImages` refresh); upsert each keyword (lower-cased, trimmed) and connect it to the collection (`saveKeywords :232`, never disconnects stale keywords).
7. `imagesOnly` short-circuits step 6 to just the image downloads (used by "Refresh images").

Image types written for Show/Film collections: `Poster`, `Backdrop`, `Thumbnail`, `Logo`; for Seasons: `Poster` only. Every scrape passes `reuseExisting`, so `ImageService` keeps the file already on disk when the provider still points at the same URL, and a full scan re-downloads only artwork that actually changed. `ImageService.saveImage` overwrites an existing row of the same type for the same entity and unsets other primaries, so refreshes replace rather than accumulate (see [Images](images.md)).

### Media scrape flow (`metadataScrapeWorker.ts`)

1. Verify the media exists; branch on `mediaType`.
2. **Video** (`scrapeVideoMetadata`): marks the media `Pending`; with `scraperId` + `externalId` it uses `resolveByIdentity` (no search fallback). If the job carries `showExternalId` (an episode under a show that has been identified), it fetches `getEpisodeMetadata(showExternalId, season, episode)` by identity, with no search. Otherwise `isEpisode = season !== undefined && episode !== undefined`. For episodes: `resolveBySearch` over `searchSeries(showName || extractShowName(mediaName))`, scored against the show name, then `getEpisodeMetadata(seriesId, season, episode)`. For movies: `parseTitleAndYear(mediaName)`, `searchVideo(title, { year })` with no `videoType` (so TMDB uses `/search/multi`), scored, then `getVideoMetadata`.
3. `resolveBySearch` collects per-scraper errors; if **every** scraper threw and the last error is retryable (`isRetryableError` in `scrapeResolution.ts`), the attempt is `failed`/retryable and the worker re-throws so BullMQ retries. A confident miss is `nomatch` and completes the job with `success: false`. Either way the outcome is written to the media row (see below).
4. **Apply** (`applyVideoMetadata`): upsert `VideoDetails` (`showName`, `season`, `episode`, `description`, `releaseDate`, `rating`); if `episodeTitle` is present, **overwrite `Media.name`** with it; download artwork through the same `downloadArtwork` (episodes only ever get a `Poster` from the TMDB still) and rewrite `Credit` rows through the same `applyCredits`.
5. **Audio** (`scrapeAudioMetadata :168`): identical structure calling `searchAudio`/`getAudioMetadata`; since no plugin declares `'audio'` in `supportedTypes` it always returns `No audio scrapers configured`.

`VideoDetails` has no `scraperId`/`externalId` columns, so a media-level refresh started from the media page still re-searches by name; `routes/media.ts:216-222` contains an empty `if` acknowledging this. An episode reached through a show cascade does not need them, because the job carries the show's identity.

### Cascading (`scrapeCascade.ts`)

A show is the only level that can be searched for. Seasons and episodes are addressed by the show's external id plus a number, so both are queued from the show's success path with `cascade` on the job saying how far to go:

- `cascade: 'seasons'` (set on every show job in a bulk scan) queues the show's `Season` children once the show has been matched. The season number comes from `SeasonDetails` or, on a first scrape, from the folder name (`Season 3`, `Specials` → 0); a folder with no number in it is skipped with a warning.
- `cascade: 'all'` (set by Identify) additionally queues each season's episode `Media` with `showExternalId`, so the episodes are re-fetched against the show the user actually chose instead of searching for the old name again.

A scan uses `'seasons'` because `ImportService` already queues the new episodes itself; Identify uses `'all'` because the existing episodes are the ones that are wrong.

### A miss and a failure are different answers

A by-id fetch has two ways to come back empty, and until 2026-09-04 they were the same: both
plugins caught everything and returned `null`, and the worker treated `null` as a retryable
failure. So a title deleted at the provider was retried three times before settling at `Failed`,
while a timeout on a season was recorded as a miss and never retried at all — the two cases
exactly the wrong way round.

Now a plugin returns `null` only for a 404 (the provider answered and does not have it) and
throws for everything else, using `ProviderNotFoundError` from `@tubeca/scraper-http` so the two
can be told apart across a package boundary. `resolveByIdentity` records `null` as `NoMatch` with
the identification kept, so a person can still see what it pointed at, and a thrown error as
`Failed`, retryable when it looks transient. `scrapeSeasonMetadata` no longer swallows: a season
that fails to fetch is retried like a show or a film.

### Caching provider responses (`scrapeCache.ts`)

Every call a worker makes into a plugin goes through `cachedCall`, keyed by scraper id, method and arguments, with a 10-minute TTL and a 500-entry cap. A scan asks the same questions repeatedly: every episode of a show searches for that show, every season re-reads the series record, and a refresh re-runs the detail call it just made. Concurrent callers share one in-flight promise, and failures are never cached, so a transient error is retried rather than remembered. The cache lives in the worker process, so a restart or a change on the provider's side is picked up within ten minutes.

### What enqueues scrapes

- **Library scan** (`libraryScanWorker.ts:103-190`): after a scan, new media get `metadata-scrape` jobs **unless the library type is Film** (ffb9d2d: the Film collection already carries the metadata). New Show/Season/Film/Artist/Album collections get `collection-scrape` jobs via the bulk helper; Film jobs carry a `year` parsed with `parseTitleAndYear`. With `fullScan: true` (ffb9d2d), existing media and collections are pushed into the same "new" lists (`:381`, `:489`) and re-scraped. Artwork is re-fetched only where the URL changed, because the apply path asks `ImageService` to reuse a file that is still current.
- **File watcher**: new files and directories are enqueued individually through the same `ImportService.queueMediaScrapes`/`queueCollectionScrapes` the scanner uses, so (since 2026-09-03) it also skips media-level scrapes for Film libraries.
- **Refresh metadata** (`collections.ts:532`, `media.ts:136`): Editor+; re-enqueues with the stored `scraperId`/`externalId` (collections only) and `skipImages: true`. The frontend fires the request and immediately clears its spinner; there is no completion feedback.
- **Refresh images**: same with `imagesOnly: true`.
- **Identify** (`collections.ts:730`): Editor+, Show/Film only. Deletes every `Image` row for the collection, upserts `ShowDetails`/`FilmDetails` with the chosen `scraperId`/`externalId`, and enqueues a collection scrape carrying both. For a Show the job is marked `cascade: 'all'`, so its seasons and their episodes are re-scraped against the chosen show once the show job has run. `POST /api/collections/search` (`:223`) fans out to every configured scraper (`searchSeries` for Show, `searchVideo` with `year` and `videoType: 'movie'` for Film) and returns a flat list; unlike the dead `ScraperService.searchVideo`, it does not sort by confidence. `IdentifyDialog` pre-fills the query and year from `parseTitleAndYear(collectionName)` (frontend mirror), lets the user edit both, shows poster/title/year/overview per result, and on selection calls `identifyCollection` then `onIdentified()`, which reloads the page while the scrape is still queued.

### Title parsing (27c0663)

`parseTitleAndYear` prefers a bracketed year (`"Blade Runner 2049 (2017)"` keeps its digits) and falls back to a bare trailing year (`"Dune 2021"`). It is used in both workers and the dialog, replacing the earlier behaviour of sending `"Name (Year)"` verbatim to TMDB. The import path now derives the `year` hint with `parseTitleAndYear` as well, so the scanner, watcher and scrape workers agree; the release-name oriented `parseMovieFromFilename` was deleted once nothing called it (2026-09-04).

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
- 2026-09-03 — Scrape follow-through: seasons and episodes queued from the show job's success path instead of a delay (`scrapeCascade.ts`, `collectionScrapePlan.ts`), Identify cascading to both, artwork reuse when the source URL has not moved, a TTL cache over provider calls (`scrapeCache.ts`), scraper config passed through to `initialize()`, and the workers' duplicated artwork/credit code unified in `scrapeApply.ts` with the dead `scraperService.ts` deleted.
- 2026-09-03 — `scrapeMatching.ts` (scored candidate selection with a threshold) and `scrapeResolution.ts` (identity-first resolution with no search fallback, outcome recording); `scrapeStatus`/`scrapeMessage`/`scrapedAt` on `Collection` and `Media` (migration `20260903130000_scrape_status`); `ScrapeStatusAlert` in the UI.
- 2026-09-04 Both scrape workers tested against the processor BullMQ would call; the season path's swallowed provider error recorded as a known limitation rather than changed.
- 2026-09-04 Jest added to `scrapers/tmdb` and `scrapers/tvdb` (ts-jest ESM, `fetch` stubbed, no fixtures on disk) with 60 cases between them, and the scraper loader covered in the backend.
- 2026-09-04 `POST /api/collections/search`, `/:id/identify` and the two refresh endpoints tested: what each queues, the identity it writes, and the artwork thrown away when a collection turns out to be something else.
- 2026-09-04 TVDB finished for collections: `getSeriesMetadata` and `getSeasonMetadata` added with a translation fallback for season text, and every request given a timeout and retries. The collection worker now checks that a plugin can fetch what it can find, so a partial plugin is passed over rather than matched and then thrown on.
- 2026-09-04 The TVDB mapping checked against the published v4 schema, which corrected three things: a season's overview is only ever in a translation (so a record with a name no longer skips that fetch), a tag's value is `name` rather than `tagName`, and the logo artwork id was 6 — a season banner a series record never carries — rather than 23.
- 2026-09-04 Both plugins return the artwork they did not choose, so the images dialog can offer it; see [Images](images.md).
- 2026-09-05 `scrapeOverview.ts`, `GET /api/libraries/:id/scrape-status` and `/unmatched`, and `LibraryScrapeStatusPage` behind a badge on the library toolbar: which of a library's items have no metadata, and why, without opening each one.
- 2026-09-04 TVDB can match a film: `type=movie` search and the `/movies/{id}/extended` record, verified live. Its credits are capped at twenty like TMDB's, and both plugins now dispatch through `@tubeca/scraper-http` — the pooled agent and DNS cache TMDB had, shared rather than copied a second time.
- 2026-09-04 A by-id miss and a by-id failure told apart: plugins return `null` only for a 404 and throw otherwise, `resolveByIdentity` records the former as `NoMatch` rather than a retried `Failed`, and the season path stopped swallowing provider errors.
- 2026-09-04 A working v4 key arrived and the plugin was run against the live API for a show, a season and an episode. It confirmed all three schema corrections — a series record does carry season artwork (types 6 and 7), so the old logo id resolved to a season banner — and caught a fourth: `score` is a popularity count, not a rating, and was being written to the field a card shows and a library sorts by. TVDB is enabled in the developer's local config from this date.
- 2026-09-04 A show in the real library identified as a TVDB series through the API, against a copy of the database: the show matched with backdrop, logo and poster, and all five seasons matched with their own ids, air dates and posters. A mistyped external id on the first attempt showed the by-id retry limitation for real — a series that does not exist is retried three times and settles at `Failed`.

## Known Limitations

- **Scoring is title+year only**: `originalTitle` and alternative titles are not compared, so a folder named in a different language than the provider's `en-US` title scores low and is reported as no match; the threshold is a constant, not configurable.
- **Locale is only partly configurable**: `language`, `region` and `imageSize` now reach the plugins from config, but `include_image_language=en,null` and the US certification lookup are still hard-coded in the TMDB plugin, as is TVDB's `country === 'usa'`.
- **TVDB's films are a separate record**: `searchVideo` queries `type: 'movie'` only when asked for one, and a film's id (`movie-1305`) routes to `/movies/{id}/extended` rather than the series endpoint. A film keeps its overview in translations, like a season, so it costs a second request when one exists in the configured language.
- **TVDB's tags are broader than TMDB's keywords**: they are categorised (`tagName`) into Sub-Genre, Geographic Location, Time Period and more, and all of them are taken as keywords, so a show arrives tagged "America / United States", "North America", "2000s" and "2010s" alongside "Dark Comedy". They are real facets and searchable, but they widen the keyword filter chips on a library page. Filtering to a few categories would be a one-line change if it becomes noise.
- **Music is unimplemented**: the Artist/Album worker branches and `scrapeAudioMetadata` remain stubs, but since 2026-09-03 nothing enqueues them (`ImportService` skips Artist/Album collections and Audio media), so they only run if a job is added by hand.
- **Status is per item, not per library**: there is no list of unmatched items or a count on the library page; refresh buttons still return before the job runs, and the page does not poll, so a user sees `Pending` until they reload. Identify still reloads the page before new data or images exist.
- **TMDB still returns `null` for both "missing" and "error"** on by-id fetches; the worker treats both as a retryable failure for identified items, which means a genuinely deleted TMDB entry will be retried three times and then sit at `Failed`. `getVideoMetadata` is worse than that: its `try/catch` returns the movie and tv promises rather than awaiting them, so a TMDB error is thrown past the catch instead of becoming `null`. The result is the same `Failed` either way, so it is pinned by a test rather than changed; fixing it belongs with the opportunity below, which decides what a miss should mean.
- **A failed show scrape strands its seasons**: seasons are queued from the show job's success path, so a show that ends in `NoMatch` or `Failed` leaves its seasons unscraped until the next scan, even when `ShowDetails` still holds a usable identity from an earlier run.
- **Media rows cannot be refreshed by ID or identified**: `VideoDetails` lacks `scraperId`/`externalId`; media-level refresh re-searches by name, and there is no Identify for episodes.
- **`Media.name` is overwritten** with the scraped episode title with no record of the original filename-derived name; a wrong match renames the file's entry.
- **Person merging by exact name** as the last resort in `findOrCreatePerson` can conflate different people with the same name across works; TMDB credits never include an IMDB ID, so the "most reliable" key is never populated.
- **The response cache is per process and per worker**: nothing is shared with the API process or across a restart, and image downloads are not cached at all, so the plugin's own internal calls (`/images`, and the `/tv/{id}` lookup inside `getEpisodeMetadata`) are only deduplicated when they happen to go through a cached worker call.
- **Sequential, non-transactional credit rewrite**: `deleteMany` then per-credit `create` (+ person lookup + photo fetch) runs outside a transaction; a crash mid-way leaves a collection with partial credits.
- **Secrets were in history**: `tubeca.config.json` with live keys was committed early on; it was purged from history and the keys rotated on 2026-09-03, but clones from before that date still carry it.
- **A provider error on a season is a miss, not a retry**: `scrapeSeasonMetadata` catches
  everything `getSeasonMetadata` throws and returns `No season metadata found`, so the season is
  recorded `NoMatch` and never retried, while the same timeout on a show or film job is recorded
  `Failed` and retried by BullMQ. Pinned by a test on 2026-09-04.
- **Tests**: the plugins and the loader are covered as of 2026-09-04 (a stubbed `fetch`, no fixtures on disk), the workers as of the same day (job-level tests against a captured BullMQ processor, with the scrapers, the apply helpers and the cache mocked), as are the pieces pulled out of them (`scrapeApply`, `scrapeCascade`, `scrapeCache`, `collectionScrapePlan`, `imageService`, `getScraperConfigs`, `scrapeMatching`, `scrapeResolution`, `mediaParser`). The search and identify routes were covered on the same day, which leaves nothing in this area untested.

## Opportunities

- **Add an episode-level identity** (S/M): `scraperId`/`externalId` on `VideoDetails` so a media refresh fetches by id, plus an Identify for a single episode; the cascade already proves the by-id episode path works.
- **Follow the configured region for certifications** (S): TMDB's US-only certification lookup and TVDB's `country === 'usa'` should use the `region` that now reaches the plugins, and image language should follow `language`.
- **Score `originalTitle` too and expose scores in Identify** (S): `pickBestMatch` could take alternative titles, and `/collections/search` could return and sort by the score so the dialog's ordering matches the worker's.
- **Poll `scrapeStatus` after Refresh or Identify** (S) so a `Pending` row resolves without a
  reload. The library-level overview landed 2026-09-05; this is the other half of that item, and
  it belongs on the collection and media pages rather than the overview.
- **Make a season's provider error retryable** (S): `scrapeSeasonMetadata` should return a
  `failed` attempt for a transient error rather than swallowing it into `NoMatch`, the way the
  show and film paths already do.
- **Real plugin discovery** (M): scan `scrapers/*` or a configured directory for packages with `pluginType: "scraper"` instead of hard-coded imports, and expose `scraperManager.list()` in an admin UI.
- **Music scrapers** (L): implement MusicBrainz (or similar) against the already-defined `AudioMetadata`/`ArtistMetadata`/`AlbumMetadata` shapes and the stubbed worker branches.
- **Move `parseTitleAndYear` to a runtime shared package** (S): the frontend copy exists only because `shared-types` is types-only; a small `@tubeca/shared-utils` would remove the drift risk between the two parsers.
- **Keep original names and prune stale keywords** (S): store `originalName` on `Media` before overwriting with the episode title, and `set` rather than `connect` keywords so a re-identify does not accumulate the previous title's tags.
