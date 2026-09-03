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
│  Browser                     │  HTTP  │  Backend (Express, single Node process)  │
│  React 19 + MUI 7 + HLS.js   │◄──────►│  /api/* routers  ─►  services  ─►  Prisma │
│  frontend/ui                 │        │       │                          (SQLite) │
└──────────────────────────────┘        │       ▼                                   │
                                        │  BullMQ queues ──► in-process workers     │
                                        │  (Redis)     scan / collection-scrape /   │
                                        │              metadata-scrape / video      │
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

In production there are two long-running processes plus Redis:

- The **backend** runs the API *and* all four BullMQ workers, the file watcher and the
  HLS cache cleaner inside one Node process (`backend/src/index.ts`).
- The **frontend** is a static Vite build served by the `serve` package.
- **Redis** backs BullMQ. Without it the backend cannot start.

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

### Access control stops at navigation

Group membership is enforced only when listing libraries and (with a different rule) in
search. Collections, media, images, HLS streams, persons and public user collections are all
served by id to any authenticated user. The same 24-hour login JWT is embedded in every image
and stream URL as a query parameter, and `JWT_SECRET` silently falls back to a hard-coded
string. Seen in [Auth](auth-and-users.md), [Content Model](content-model.md),
[Images](images.md), [Streaming](streaming-and-transcoding.md), [Search](search.md).

### Legacy routes in the entry file

`backend/src/index.ts` is 721 lines, most of it inline handlers from the initial commit that
predate the routers. `POST /api/jobs/transcode|thumbnail|analyze` require no token and accept
caller-supplied paths; the `analyze` stub overwrites a real `Media.duration` with a constant.
`PATCH /api/settings`, which the settings page actually calls, falls through the router to an
inline handler with no role check, so a Viewer can rename the instance. See
[Configuration](configuration.md) and [Auth](auth-and-users.md).

### Secrets in history

`tubeca.config.json` with live TMDB and TVDB API keys was committed in `fe77ae6` and
`bb82089` before being removed in `7366e13`. The keys still in the working copy are the same
ones, and they remain recoverable from git history. They should be rotated regardless of
whether the history is rewritten. See [Metadata Scraping](metadata-scraping.md).

### Backend is untested

Two backend test files (auth service, title parser) cover a 14.8k-line backend. The scan
worker, both scrape workers, HLS service, every service and every route are untested, and the
pre-commit hook runs lint and typecheck but not tests. Several bugs the specs found are the
kind a route test catches immediately: `GET /api/persons/search` is unreachable because
`/:id` is registered first; sorting by release date, rating or runtime is applied per page in
memory so infinite scroll is globally unordered; the search endpoint applies the same offset to
two parallel queries. Frontend coverage is far better (42 files, 854 cases) but thin on
contexts and hooks.

### One process, blocking work, leaky lifecycles

API, four BullMQ workers, the file watcher, encoder detection and FFmpeg supervision share one
Node process. The scan uses synchronous `fs` calls, encoder detection runs synchronous test
encodes at import time, and per-segment FFmpeg children have no timeout and are not killed on
disconnect or shutdown. Three modules register competing SIGINT/SIGTERM handlers. Commit
`4abe949` (DNS thread-pool starvation) was a symptom of this coupling, and its
`UV_THREADPOOL_SIZE=24` fix never reaches the systemd unit. See
[Configuration](configuration.md), [Libraries](libraries-and-scanning.md),
[Streaming](streaming-and-transcoding.md).

### Copy-paste that has already diverged

The scan worker and file watcher duplicate collection and media creation and disagree about
film scrape jobs and media naming. The image download loop exists three times and
`mapCreditType` four times across the scrape workers and an unused `scraperService`.
Favorites and Watch Later pages differ by about 40 of 380 lines, and "add to most recent
collection" is pasted into five components. Title/year parsing is mirrored in the frontend
because `shared-types` is types-only. See [Libraries](libraries-and-scanning.md),
[Metadata Scraping](metadata-scraping.md), [User Collections](user-collections.md),
[Frontend App](frontend-app.md).

### Orphans on disk and in the database

Rescans never remove media or collections for files that vanished, and `Media.path` has no
unique index so scans racing the watcher create duplicates. Deleting a show orphans its
seasons' media rows. Identify and library deletion delete `Image` rows but not files. HLS cache
size limits are parsed but never enforced, and media deletion never evicts its segments. See
[Libraries](libraries-and-scanning.md), [Content Model](content-model.md), [Images](images.md),
[Streaming](streaming-and-transcoding.md).

### No watch state

Nothing records that a user has watched, or how far into, a media item. The player hard-codes
a zero start position. "Continue watching", resume, watched badges and unwatched counts all
depend on a progress table that does not exist. See [Playback](playback.md) and
[Content Model](content-model.md).

### Music is declared but unimplemented

`LibraryType.Music`, Artist/Album collections and the audio detail tables exist and are
scanned, but no scraper populates them, no tags are read from files, and the audio playback
path double-plays through two elements. See [Libraries](libraries-and-scanning.md),
[Playback](playback.md).

### Deployment does not work as documented

The Arch install script runs migrations before rewriting `DATABASE_URL`, so first boot starts
against an empty database. The packaged layout (backend plus `serve -s dist`) has no proxy, the
SPA hard-codes a relative `/api` base and the backend serves no static files, so the documented
entry point cannot reach the API without nginx. `pnpm start` and the committed systemd unit run
plain `node` against extensionless ESM output that only works under `tsx`. There are no release
tags, no CI and no container image. The root route of the SPA renders an empty box, which is
where login sends users. See [Deployment](deployment.md), [Frontend App](frontend-app.md).

## Suggested Direction

Ordered by leverage. Each item's details are in the linked spec.

1. **Stop the bleeding** (all S): rotate the TMDB/TVDB keys; refuse to start without
   `JWT_SECRET`; delete the legacy inline handlers in `index.ts` and add `PATCH` (or switch the
   client to `PUT`) on the settings router; fix the install script ordering; register
   `/persons/search` before `/:id`; give `/` a real landing page. Each is under an hour and
   several are security fixes. ([Auth](auth-and-users.md), [Configuration](configuration.md),
   [Deployment](deployment.md), [Frontend App](frontend-app.md))
2. **Backend test scaffolding** (M): a Prisma test database helper and supertest, then tests
   for the group filter, pagination and sorting, the scan worker's path mapping, scrape
   matching, and playlist synthesis. Everything below gets safer once this exists.
3. **Enforce library access on content** (M): one middleware that resolves an entity's
   library and checks the user's groups, applied to collections, media, images and streams;
   unify the search rule with `LibraryService`. ([Auth](auth-and-users.md))
4. **Watch state** (M): a progress table, a progress endpoint, resume on play, and a Continue
   Watching row. This is the most visible missing feature for a media server. ([Playback](playback.md))
5. **Import integrity** (M): shared import service used by scanner and watcher, unique index
   on `Media.path`, orphan reconciliation on rescan, recursive delete that cleans files.
   ([Libraries](libraries-and-scanning.md), [Content Model](content-model.md))
6. **Scrape quality and visibility** (M): score candidates on title and year instead of
   taking the first result, stop the fall-through that can undo an Identify, and surface
   scrape status and failures in the UI. ([Metadata Scraping](metadata-scraping.md))
7. **Streaming robustness** (M): codec-aware direct play, FFmpeg process lifecycle and
   timeouts, cache size enforcement, and eviction on media delete.
   ([Streaming](streaming-and-transcoding.md))
8. **Runtime and deployment shape** (M to L): split workers into their own process, compile
   the backend properly so `node` runs it, serve the SPA from the backend, and ship a
   container image with CI. ([Configuration](configuration.md), [Deployment](deployment.md))
9. **Decide on Music** (S to hide, L to implement). ([Libraries](libraries-and-scanning.md))

## Conventions for Maintaining These Specs

- When a change alters behaviour described in a spec, update the spec in the same commit.
- Append to History with the commit hash once the change lands.
- Move an Opportunity into How It Works when it ships; do not leave stale backlog items.
- Keep file references as paths (and `path:line` only where a precise pointer matters).
- New parts of the system get a new spec from `_template.md` and a row in the index above.
