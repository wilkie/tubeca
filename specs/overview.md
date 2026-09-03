# Tubeca System Overview

> Tubeca is a self-hosted media server: it scans local folders of films, TV shows and
> (nominally) music, enriches them with metadata and artwork from TMDB/TVDB, and streams
> them to a React web client via on-the-fly HLS transcoding. This document is the entry
> point to the `specs/` directory, which describes each part of the system as it exists
> today, how the parts fit together, and where each could go next.

## Why These Specs Exist

The codebase grew feature-by-feature over roughly a month of intense work (November 28 to
December 20, 2025) followed by sparse maintenance commits. There was never a written design.
These specs were written after the fact, from the code and the commit log, so that:

1. A newcomer (human or agent) can understand a part of the system without reading all of it.
2. Improvement work can be prioritised across the whole system rather than whichever part
   was touched last.
3. Each future change has a place to record *why*, not just *what*.

Every spec follows `_template.md`: Responsibilities, Goals, Components, How It Works,
Interactions, History, Known Limitations, Opportunities. The Opportunities sections are the
backlog; `overview.md` (this file) rolls them up into themes.

## Spec Index

| Spec | Covers |
|------|--------|
| [Authentication, Users & Access Control](auth-and-users.md) | JWT auth, first-run setup, roles, groups, per-library access |
| [Libraries, Scanning & File Import](libraries-and-scanning.md) | Library CRUD, filesystem scan worker, file watcher, filename parsing |
| [Content Model](content-model.md) | Prisma schema for Collection/Media/Details/Person/Keyword, and their services and routes |
| [Metadata Scraping & Scraper Plugins](metadata-scraping.md) | Plugin interface, TMDB/TVDB plugins, scrape workers, Identify |
| [Images & Artwork](images.md) | Image download, storage, serving, selection and fallbacks |
| [Streaming, Transcoding & HLS](streaming-and-transcoding.md) | FFmpeg HLS pipeline, ABR ladder, hwaccel, trickplay, subtitles, cache |
| [Search & Discovery](search.md) | Global search endpoint, quick search, keyword filters, sorting |
| [User Collections, Favorites, Watch Later & Queue](user-collections.md) | Per-user playlists/sets, system collections, playback queue |
| [Playback Experience](playback.md) | HLS.js player, controls, mini player, Up Next, quality memory |
| [Frontend Application Shell & Library Browsing](frontend-app.md) | Routing, API client, contexts, layout, grid/list browsing, i18n, tests |
| [Configuration, Settings & Server Runtime](configuration.md) | Env vars, `tubeca.config.json`, DB settings, server bootstrap |
| [Build, Packaging & Deployment](deployment.md) | Turbo/pnpm build, Arch PKGBUILD, systemd units, production runtime |

## Architecture at a Glance

```
┌──────────────────────────────┐        ┌──────────────────────────────────────────┐
│  Browser                     │  HTTP  │  Backend (Express; role api|worker|all)  │
│  React 19 + MUI 7 + HLS.js   │◄──────►│  SPA + /api/* routers ─► services ─► Prisma│
│  served by the api role      │        │       │                          (SQLite) │
└──────────────────────────────┘        │       ▼                                   │
                                        │  BullMQ queues ──► workers (worker role)  │
                                        │  (Redis)     scan / collection-scrape /   │
                                        │              metadata-scrape              │
                                        │       │                  │                │
                                        │       ▼                  ▼                │
                                        │  scraper plugins    FFmpeg / ffprobe      │
                                        │  (tmdb, tvdb)       HLS cache on disk     │
                                        └──────────────────────────────────────────┘
                                                 │                    │
                                                 ▼                    ▼
                                          TMDB / TVDB APIs     media folders, image store
```

### Packages

| Package | Purpose | Size (non-test) |
|---------|---------|-----------------|
| `backend/` | Express API, Prisma schema, BullMQ workers, FFmpeg integration | ~14.8k lines, 45 files |
| `frontend/ui/` | React SPA (Vite build) | ~17.8k lines, 68 files |
| `packages/shared-types/` | TypeScript types shared by API and UI (types only, no runtime code) | ~800 lines |
| `packages/scraper-types/` | Plugin contract for metadata scrapers | ~430 lines |
| `scrapers/tmdb/`, `scrapers/tvdb/` | Scraper plugin implementations | ~740 / ~350 lines |

Tests: 42 frontend test files (pages, components, contexts, API client) and 2 backend test
files (auth service, media parser). The backend is effectively untested.

### Runtime processes

One esbuild-bundled entry point, `backend/dist/index.js`, runs in one of three roles set by
`TUBECA_ROLE`. In production there are two instances plus Redis:

- The **api** role serves the HTTP API, Swagger UI, the HLS cache cleaner and the built
  frontend on one port.
- The **worker** role runs the three BullMQ workers and the file watcher.
- `all` (the default for `pnpm dev` and `pnpm start`) does both in one process.
- **Redis** backs BullMQ. Without it the backend cannot start.

A `Dockerfile` and `docker-compose.yml` package the same layout as containers.

See [Configuration](configuration.md) and [Deployment](deployment.md).

### Data stores

| Store | Contents | Owner spec |
|-------|----------|------------|
| SQLite (Prisma, libsql adapter) | Users, groups, libraries, collections, media, details, credits, images, keywords, people, user collections, settings | [Content Model](content-model.md) |
| Image directory (`imagePath`) | Downloaded artwork files, referenced by `Image` rows | [Images](images.md) |
| HLS cache directory (`hlsCachePath`) | Transcoded segments and playlists, periodically cleaned | [Streaming](streaming-and-transcoding.md) |
| Redis | BullMQ job state only; no application data | [Configuration](configuration.md) |
| `tubeca.config.json` | Scraper API keys, paths, file-watcher settings | [Configuration](configuration.md) |

### Core domain model

`Library` (Television | Film | Music) → `Collection` tree (Show → Season, Film, Artist →
Album) → `Media` (Video | Audio) → `MediaStream` (probed audio/video/subtitle streams).
Each collection/media type has a `*Details` table and a `*Credit` join to `Person`.
`Image` rows attach to collections, media and people. `Keyword` tags collections.
`UserCollection` holds per-user ordered lists of media (playlists, sets, and the system
Favorites and Watch Later lists). See [Content Model](content-model.md).

### Primary flows

1. **Import**: admin creates a Library → `library-scan` job walks the folder → creates
   Collections/Media by parsing folder and file names → enqueues `collection-scrape` and
   `metadata-scrape` jobs → workers call scraper plugins → details, credits, keywords and
   images are written. ([Libraries](libraries-and-scanning.md), [Scraping](metadata-scraping.md))
2. **Browse**: the SPA lists libraries the user's groups may see, and pages through
   collections and media with sorting, keyword filters and search. ([Frontend](frontend-app.md), [Search](search.md))
3. **Play**: the player requests an HLS master playlist; the backend spawns FFmpeg per
   session to transcode into an ABR ladder, with seeking implemented as a fresh transcode
   from an offset. ([Playback](playback.md), [Streaming](streaming-and-transcoding.md))

## Cross-Cutting Observations

These themes recur across several specs. Detailed items live in each spec's Known
Limitations and Opportunities sections; the pointers here are the entry points.

### Access control covers content

Since 2026-09-03 one rule in `LibraryService` decides library visibility. A
`requireLibraryAccess` middleware applies it to every entity-addressed route on the collections,
media, images and stream routers; search, person filmographies and user-collection items apply
it as a query scope. Image and stream URLs carry a four-hour media-scoped token that cannot be
used for anything else. What remains: tokens still travel in query strings at all, where a
cookie would not. See [Auth](auth-and-users.md).

### Secrets were in history

`tubeca.config.json` with live TMDB and TVDB API keys was committed in the second day of the
project and removed a week later, but stayed recoverable from git history until 2026-09-03,
when the file was purged from every commit (rewriting all hashes after the first four) and the
keys were rotated. Clones made before that date still carry the old objects. The config file
remains git-ignored; see [Metadata Scraping](metadata-scraping.md) and
[Configuration](configuration.md).

### Backend test coverage is still thin

As of 2026-09-03 the backend has a real-SQLite test scaffolding (`backend/src/test/`: a migrated
template database per run, one copy per Jest worker, factories, and supertest for routes) and
nine test files covering auth, middleware, library access, collection pagination, layout rules,
parsers and HLS playlist synthesis. The scan and scrape workers, the stream routes, images,
user collections and search remain untested. Bugs the specs found are the kind a route test
catches immediately: `GET /api/persons/search` was unreachable for nine months because `/:id`
was registered first; sorting by release date, rating or runtime was applied per page in memory
so infinite scroll was globally unordered (found by a deliberately failing test, fixed
2026-09-03); the search endpoint applies
the same offset to two parallel queries. The pre-commit hook now runs both suites, so the
frontend's 860 cases cannot silently rot again the way 29 of them did between December and
September.

### Blocking work and lifecycles

Since 2026-09-03 the API and the workers can run as separate processes and FFmpeg children
are tracked, timed out and killed on shutdown. What remains: the scan uses synchronous `fs`
calls, encoder detection runs synchronous test encodes when the HLS service is first used, and
three modules still register competing SIGINT/SIGTERM handlers. See
[Configuration](configuration.md), [Libraries](libraries-and-scanning.md),
[Streaming](streaming-and-transcoding.md).

### Copy-paste that has already diverged

Favorites and Watch Later pages differ by about 40 of 380 lines. Title/year parsing is mirrored
in the frontend because `shared-types` is types-only. ("Add to most recent collection", pasted
into five components, became one hook on 2026-09-03.) See [Libraries](libraries-and-scanning.md),
[Metadata Scraping](metadata-scraping.md), [User Collections](user-collections.md),
[Frontend App](frontend-app.md).

### Orphans: mostly closed

Since 2026-09-03 rescans remove media and collections whose files vanished, `Media.path` is
unique, and deleting a show, media item or library removes the whole tree with its artwork
files. What remains: renames lose metadata (no size/mtime matching), Identify still deletes
`Image` rows without files. See [Libraries](libraries-and-scanning.md),
[Images](images.md), [Streaming](streaming-and-transcoding.md).

### Watch state

Since 2026-09-03 playback position and watched state are persisted per user, resume works, the
home page has a Continue Watching strip, and library, season and episode cards carry watched
badges, remaining counts and progress bars with a mark-watched control. Search, user
collections and the queue do not show it yet. See [Playback](playback.md).

### Music is hidden

Decided 2026-09-03: `LibraryType.Music`, Artist/Album collections and the audio detail tables
stay in the schema, but the library picker no longer offers Music, the API refuses to create
new Music libraries, and scans no longer queue the stub Artist/Album/Audio scrapes. Existing
Music libraries still render and play (with the double-play bug). Reviving it means tag
reading, a music scraper and an audio player; see [Libraries](libraries-and-scanning.md).

### Deployment is now one port, one binary

Since 2026-09-03 the backend is bundled so plain `node` runs it, the API process serves the
SPA, systemd runs an api and a worker unit, and a Dockerfile, compose file and CI workflow
exist. What remains: no release tags, no published image, dev dependencies shipped in the
package and image, and no backup step before upgrades. See [Deployment](deployment.md).

## Suggested Direction

Ordered by leverage. Each item's details are in the linked spec.

1. ~~**Stop the bleeding**~~ Done 2026-09-03: keys rotated and purged from history,
   `JWT_SECRET` enforced in production, legacy inline handlers deleted, Admin-gated
   `PATCH /api/settings`, install-script ordering fixed, `/persons/search` reachable, `/` has a
   landing page.
2. ~~**Test scaffolding**~~ Done 2026-09-03: frontend suite repaired, `pnpm test` in the
   pre-commit hook, SQLite-backed backend test helpers with supertest, and tests for the group
   filter, pagination and sorting, layout rules, middleware and playlist synthesis. Scrape
   matching stays untested until the workers' matching logic is extracted from the BullMQ
   handlers (see [Metadata Scraping](metadata-scraping.md)).
3. ~~**Enforce library access on content**~~ Done 2026-09-03: `requireLibraryAccess`
   middleware on collections, media, images and streams; search unified with `LibraryService`.
   Persons and user-collection listings are the remaining gap ([Auth](auth-and-users.md)).
4. ~~**Watch state**~~ Done 2026-09-03: `WatchProgress` table, `/api/watch` endpoints, resume
   on play, Continue Watching strip. Surfacing watched state on cards and lists is a follow-up
   ([Playback](playback.md)).
5. ~~**Import integrity**~~ Done 2026-09-03: `ImportService` shared by scanner and watcher,
   unique `Media.path`, orphan reconciliation after complete scans, file-cleaning recursive
   deletes. Rename detection is the follow-up.
   ([Libraries](libraries-and-scanning.md), [Content Model](content-model.md))
6. ~~**Scrape quality and visibility**~~ Done 2026-09-03: scored matching with a threshold,
   identity-first resolution that never falls back to a search, and per-item scrape status
   shown on the collection and media pages. A library-level unmatched list is the follow-up
   ([Metadata Scraping](metadata-scraping.md)).
7. ~~**Streaming robustness**~~ Done 2026-09-03: codec-aware Original, unified segment
   de-duplication, FFmpeg timeouts and shutdown, cache size enforcement, eviction on media
   delete. Cancel-on-seek and live-over-prefetch priority followed in the third round
   ([Streaming](streaming-and-transcoding.md)).
8. ~~**Runtime and deployment shape**~~ Done 2026-09-03: esbuild bundle run by `node`,
   `TUBECA_ROLE` api/worker split, SPA served by the API, Docker image, compose file and CI
   workflow. Release tagging and image publishing are the follow-ups
   ([Deployment](deployment.md)).
9. ~~**Decide on Music**~~ Hidden 2026-09-03; schema kept for a future implementation
   ([Libraries](libraries-and-scanning.md)).

### Second round

Drawn from the Opportunities sections after the first nine items landed.

1. ~~**Watched state on cards and lists**~~ Done 2026-09-03 ([Playback](playback.md)).
2. ~~**Rename detection in scan reconciliation**~~ Done 2026-09-03
   ([Libraries](libraries-and-scanning.md)).
3. ~~**Release tagging and image publishing**~~ Done 2026-09-03: `v1.0.0` tag, changelog,
   GHCR publish job ([Deployment](deployment.md)).
4. ~~**Remaining access gaps**~~ Done 2026-09-03: filmographies and user-collection items
   scoped to accessible libraries ([Auth](auth-and-users.md)).
5. ~~**Slim the package and image**~~ Done 2026-09-03: `pnpm deploy --prod` trees, OpenAPI
   generated at build time ([Deployment](deployment.md)).

### Third round

Ranked 2026-09-03 from the roughly 120 items still open in the specs' Opportunities sections.
Ordered by user-visible value per unit of risk; sizes are the specs' estimates.

1. ~~**Fix library sorting across pages**~~ Done 2026-09-03: sort keys denormalised onto
   `Collection` and maintained by the scrape workers; all five sorts run in SQL with nulls
   last ([Content Model](content-model.md)).
2. ~~**Playback quality of life**~~ Done 2026-09-03: keyboard shortcuts, bounded error
   recovery with retry, progress flushed on tab close, Up Next skips watched episodes, quality
   by height, audio double-play fixed, Media Session ([Playback](playback.md)).
3. ~~**Token hardening**~~ Done 2026-09-03: media-scoped tokens, session invalidation via
   `tokenVersion`, central 401 handling, login rate limiting, last-admin guard, self-service
   password change ([Auth](auth-and-users.md)).
4. ~~**Scrape follow-through**~~ Done 2026-09-03: seasons and episodes queued from the show
   job's success path, Identify cascading to both, artwork reused when the source URL has not
   moved, a TTL cache over provider calls, scraper config passed through to plugins, and the
   workers' duplicated artwork and credit code unified ([Metadata Scraping](metadata-scraping.md)).
5. ~~**Streaming responsiveness**~~ Done 2026-09-03: player requests take transcode slots ahead
   of prefetches and cancel the ones a seek left behind, encoder detection runs after listen,
   the transcoding settings body is validated, a segment-duration change purges the cache, and
   VAAPI works ([Streaming](streaming-and-transcoding.md)).
6. ~~**Frontend data layer**~~ Done 2026-09-03: TanStack Query adopted behind a `useApiQuery`
   adapter, duplicate library and route lookups shared through the cache, `LibraryPage` split
   into a hook plus a toolbar and card components, routes lazy-loaded, view mode and sort
   persisted per library, and one `useAddToRecentCollection` in place of five copies. Only
   `SearchPage` and `SettingsPage` still hand-roll their fetches
   ([Frontend App](frontend-app.md)).
7. ~~**Import polish**~~ Done 2026-09-03: async `fs` in the scan and the path validation, a
   visited real-path set and depth cap for symlinks, chokidar `change` re-probing a re-encode,
   watchers rebuilt when a library's path or type changes, scan concurrency raised to two, a
   dry-run scan that removes nothing, subtitle sidecars imported as external streams, and a
   folder picker for the library path ([Libraries](libraries-and-scanning.md)).
8. **Search depth** (M): SQLite FTS5 over titles, keywords and people, people results on the
   search page, server-served filter options, live search. ([Search](search.md))
9. **Images** (M): resize on ingest with a size parameter, download hardening (timeouts, size
   and content-type limits), candidate galleries with set-primary, user upload.
   ([Images](images.md))
10. **Operations** (S batch): health endpoint wired into the units, SQLite backup before
    upgrade migrations, `--enable-source-maps`, a single source for the unit files, install
    failing on migration errors, per-request caching of group ids. ([Deployment](deployment.md),
    [Configuration](configuration.md), [Auth](auth-and-users.md))

Deferred beyond this round: music support (product decision), multi-arch images, plugin
discovery, per-library group permissions, fMP4/CMAF segments, and the second locale.

## Conventions for Maintaining These Specs

- When a change alters behaviour described in a spec, update the spec in the same commit.
- Append to History with the commit hash once the change lands.
- Move an Opportunity into How It Works when it ships; do not leave stale backlog items.
- Keep file references as paths (and `path:line` only where a precise pointer matters).
- New parts of the system get a new spec from `_template.md` and a row in the index above.
