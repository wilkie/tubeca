# Configuration, Settings & Server Runtime

> Tubeca is configured through three overlapping layers: process environment variables (loaded
> from `backend/.env` by dotenv), a JSON application config file (`tubeca.config.json`, located via
> `TUBECA_CONFIG_PATH` or the repo root), and two singleton Prisma tables (`Settings`,
> `TranscodingSettings`) edited from the frontend Settings page. This part also covers the server
> bootstrap in `backend/src/index.ts`: a single Node process that hosts the Express API, Swagger UI,
> all four BullMQ workers, the file watcher and the HLS cache janitor, and tears them down on
> SIGINT/SIGTERM.

## Responsibilities

- Read connection/secret settings from the environment (`PORT`, `DATABASE_URL`, `REDIS_*`,
  `JWT_SECRET`, `NODE_ENV`, `FILE_WATCHER_ENABLED`, `TUBECA_CONFIG_PATH`) with hard-coded fallbacks.
- Locate, parse and expose `tubeca.config.json` (scraper API keys, file-watcher mode, image and HLS
  cache paths, HLS cache tuning), creating the image and HLS cache directories on first use.
- Persist admin-editable runtime settings in SQLite: the instance name and FFmpeg transcoding
  parameters, with lazy creation of the singleton rows and a 30 s in-memory cache.
- Expose `/api/settings` (general) and `/api/settings/transcoding` (Admin only) and render them in
  the frontend `SettingsPage`.
- Bootstrap the process: dotenv, Express middleware, Swagger UI at `/api-docs`, route mounting,
  `/api/health`, scraper plugin initialisation, file watcher, HLS cleanup timer, in-process workers.
- Generate `openapi.json` and static Redoc HTML from the JSDoc annotations (`docs:generate`).
- Shut down cleanly: close the HTTP server, the four workers, the watcher, the cleanup timer, Redis
  and Prisma, then `process.exit(0)`.

## Goals

- **Zero-config local dev.** Every env var has a fallback (`localhost` Redis, `file:./dev.db`,
  a literal `dev-secret-change-in-production` JWT secret) so `pnpm dev` works with an empty `.env`.
- **Keep secrets out of git.** `.env` and `tubeca.config.json` are git-ignored; only `.example`
  files are committed. The Arch package installs both under `/etc/tubeca` with `640 root:tubeca`
  (4500646, 7aa555d).
- **Deployment flexibility without code changes.** `TUBECA_CONFIG_PATH`, `PORT` (propagated to the
  Vite proxy via `turbo.json passThroughEnv`, c95eedf), absolute or repo-relative `imagePath` and
  `hlsCache.path`.
- **Admin tunability at runtime.** Transcoding bitrates, presets, hardware acceleration and
  concurrency are DB rows editable in the UI and picked up within 30 s without a restart (b6003ef,
  0fc5947).
- **Single-process simplicity.** One `node`/`tsx` process runs API and workers; there is no
  separate worker deployment, no process manager beyond systemd.
- **Self-documenting API.** Every route carries an `@openapi` JSDoc block; the spec is served live
  and exportable.

## Components

| File | Role |
|------|------|
| `backend/.env.example` | Documented env vars; template copied to `/etc/tubeca/tubeca.env` by `PKGBUILD` |
| `backend/src/config/database.ts` | Prisma client singleton over `@prisma/adapter-libsql`; `DATABASE_URL` fallback; per-file SIGINT/SIGTERM handlers |
| `backend/src/config/redis.ts` | Single shared `ioredis` connection (`maxRetriesPerRequest: null`) used by all queues and workers; per-file signal handlers |
| `backend/src/config/appConfig.ts` | `loadAppConfig()`, `resolveConfigPath()`, `getScraperConfigs()`, `getImageStoragePath()`, `getHlsCachePath()`, `getHlsCacheConfig()` |
| `tubeca.config.example.json` | Example app config (file watcher + scraper keys only; omits `imagePath`/`hlsCache`) |
| `backend/prisma.config.ts` | Prisma 7 config; reads `DATABASE_URL` via `env()` and `dotenv/config` |
| `backend/prisma/schema.prisma:537-570` | `Settings` and `TranscodingSettings` singleton models |
| `backend/src/services/settingsService.ts` | `SettingsService` class (get/create/update/reset instance settings) |
| `backend/src/services/transcodingSettingsService.ts` | Cached accessor + updater for `TranscodingSettings`; encoder detection info |
| `backend/src/routes/settings.ts` | `GET/PUT /api/settings`, `GET/PUT /api/settings/transcoding` |
| `backend/src/index.ts` | App bootstrap, middleware, route mounting, inline legacy routes, `startServer()`, `shutdown()` |
| `backend/src/config/swagger.ts` | `swagger-jsdoc` options: info, tags, `bearerAuth`, shared component schemas, `apis` globs |
| `backend/src/swagger.ts` | `docs:generate` entry: writes `openapi.json` (Redoc then builds `docs/api.html`) |
| `backend/package.json` | Scripts (`dev`/`start` set `UV_THREADPOOL_SIZE=24`), `db:migrate` = `prisma migrate deploy` |
| `frontend/ui/vite.config.ts` | Dev proxy `/api` -> `127.0.0.1:${PORT ?? 3000}` |
| `frontend/ui/src/pages/SettingsPage.tsx` | Two-tab admin UI: General (instance name) and Transcoding |
| `frontend/ui/src/api/client.ts:369-392` | `getSettings`, `updateSettings` (PATCH), `getTranscodingSettings`, `updateTranscodingSettings` (PUT) |
| `PKGBUILD`, `systemd/tubeca-backend.service`, `systemd/install.sh` | Two divergent production layouts (see [Deployment](deployment.md)) |

## How It Works

### Layer 1: environment variables

`index.ts:1` imports `dotenv/config`, so `backend/.env` is loaded before anything else. Every read
is an ad-hoc `process.env.X || default` at module scope; there is no schema, no validation and no
startup summary. Notable defaults:

- `DATABASE_URL` -> `file:./dev.db` (`database.ts:6`), but `.env.example` and `prisma.config.ts`
  expect `file:./prisma/dev.db`. Running the API without `.env` therefore opens a different SQLite
  file than the one migrations were applied to.
- `JWT_SECRET` -> `'dev-secret-change-in-production'` (`authService.ts:6`). A production process
  with a missing variable silently signs tokens with a public constant.
- `REDIS_PASSWORD` -> `undefined`; `REDIS_PORT` -> `6379` via `Number(x) || 6379`.
- `NODE_ENV` controls Prisma query logging (`['query','error','warn']` in development) and whether
  the Prisma client is stashed on `global` for hot reload.
- `FILE_WATCHER_ENABLED` is the only env var that overrides a config-file key: `index.ts:652-654`
  uses it if defined, else `fileWatcher.enabled`, else `false`. `usePolling`/`pollInterval` come
  from the file only.
- `UV_THREADPOOL_SIZE=24` is not read by code; it is baked into the `dev` and `start` scripts
  (7052d0c) so that chokidar polling on SMB mounts does not starve DNS lookups and sharp.

### Layer 2: `tubeca.config.json`

`resolveConfigPath()` (`appConfig.ts:72-91`) checks `TUBECA_CONFIG_PATH` (warns and falls through
if the file is missing), then `<repo>/tubeca.config.json` resolved from `__dirname/../../..`
(this assumes the `backend/src/config` or `backend/dist/config` depth; a different install layout
silently loses the file). Missing or malformed JSON logs a warning/error and returns `{}`; the
server still starts with no scrapers.

The file is parsed with a bare `JSON.parse(...) as AppConfig` cast; unknown keys, wrong types and
negative intervals pass straight through. `loadAppConfig()` re-reads the file from disk on every
call and is called at least five times at startup (`index.ts:644`, `HlsService` constructor x2,
`HlsCacheCleanupService` constructor, first `getImageStoragePath()`), so the "Loaded configuration
from" line appears repeatedly. Paths are memoised in module-level variables after first resolution
(`imageStoragePath`, `hlsCachePath`); 4dc330d fixed callers that passed no `appConfig` and
previously fell back to the default `backend/data/*` paths.

Keys in use: `imagePath`, `hlsCache.{path,maxSizeGB,segmentTTLHours,segmentDuration}`,
`fileWatcher.{enabled,usePolling,pollInterval}`, `scrapers.<id>.{enabled,apiKey}`.
`hlsCache.maxSizeGB` is exposed by `getHlsCacheConfig()` but no caller reads it; only the TTL is
enforced by the cleanup service. `getScraperConfigs()` drops scrapers that are `enabled: false` or
have no `apiKey`, and passes `{ apiKey }` to `loadScrapers()`.

### Layer 3: database settings

`Settings` holds a single row with `instanceName`. Three code paths touch it with different default
names: `SettingsService.getOrCreateSettings()` (`'Tubeca Instance'`), `routes/settings.ts:104`
(`'Tubeca'`), and the inline handlers in `index.ts:406-458` which use the service. `instanceName` is
only displayed on the Settings page itself; no other frontend or backend code reads it.

`TranscodingSettings` is created lazily with schema defaults (`veryfast`, 2 concurrent transcodes,
6 s segments, 8000/5000/2500/1000 kbps). `transcodingSettingsService.ts` caches the row for 30 s and
invalidates on update; `HlsService` layers its own 30 s cache on top (`hlsService.ts:105-116`), so a
saved change can take up to 60 s to reach an in-flight stream. `maxConcurrentTranscodes` gates a
semaphore in `HlsService` (`hlsService.ts:80`) but does not affect BullMQ worker `concurrency`,
which is hard-coded per worker (video 2, all others 1).

### Precedence between layers

- **Segment duration:** DB `TranscodingSettings.segmentDuration` wins; the file's
  `hlsCache.segmentDuration` is only the fallback when the DB value is `0`/null
  (`hlsService.ts:158`). The Settings UI shows only the DB value.
- **File watcher enabled:** env > file > `false`. Polling options: file only.
- **Config file location:** env `TUBECA_CONFIG_PATH` > repo root.
- **Paths:** file only; env cannot override `imagePath`/`hlsCache.path`.
- **Scraper keys:** file only; there is no `TMDB_API_KEY` env var, so the secret lives in the JSON
  file rather than `.env` (the packaging scripts treat both files as sensitive).
- Nothing in the DB can be overridden by env or file, and nothing in the file is editable in the UI.

### What is editable where

| Setting | `.env` | `tubeca.config.json` | DB / Settings UI |
|---|---|---|---|
| Port, DB URL, Redis, JWT secret | yes | - | - |
| Scraper API keys / enabled | - | yes | - |
| Image and HLS cache paths, HLS TTL | - | yes | - |
| File watcher enabled | yes (wins) | yes | - |
| File watcher polling | - | yes | - |
| Instance name | - | - | Admin (PUT) or any authenticated user (PATCH, see below) |
| Encoder, preset, bitrates, threads, concurrency, segment duration, prefetch | - | - | Admin only |

### Server bootstrap (`index.ts`)

1. Module evaluation: importing `./workers/*` constructs four `new Worker(...)` instances
   immediately (e.g. `videoWorker.ts:7`), so workers connect to Redis and start consuming before
   `startServer()` runs and regardless of whether the HTTP server ever listens. Importing
   `routes/stream.ts` constructs an `HlsService`, whose constructor runs `ffmpeg -encoders` and a
   test encode per candidate hardware encoder synchronously via `execSync` (`hwaccel.ts:29,66`,
   10 s timeout each), blocking module evaluation.
2. Middleware: `cors()` with defaults (any origin, no credentials), `express.json()` with the 100 kb
   default limit. No request logging, no helmet, no rate limiting, no error-handling middleware and
   no 404 handler; unhandled errors fall to Express's default HTML responder.
3. `/api-docs` mounts Swagger UI from `swaggerSpec` (built at import time from JSDoc in
   `src/routes/*.ts`, `src/index.ts`). The spec's `servers` entry is hard-coded to
   `http://localhost:3000`.
4. Routers are mounted for twelve `/api/*` prefixes. After them, `index.ts` defines inline legacy
   handlers for `/api/health`, `/api/media*`, `/api/settings` (GET, PATCH) and `/api/jobs/*`. The
   mounted `mediaRoutes` and `settingsRoutes` apply `router.use(authenticate)`, so requests reach the
   inline handlers only when the router has no matching method: `PATCH /api/settings` passes
   `authenticate` but not `requireRole('Admin')`, then lands on `index.ts:450`. The frontend's
   `updateSettings` uses PATCH (`client.ts:373-378`), so in practice any logged-in Viewer can rename
   the instance. `/api/jobs/transcode|thumbnail|analyze` are mounted with no authentication at all.
5. `/api/health` runs `SELECT 1` through Prisma and returns 200/503; it does not check Redis, ffmpeg
   or worker state.
6. `startServer()`: `loadAppConfig()` -> `loadScrapers()` -> optional `fileWatcherService.start()`
   -> `hlsCacheCleanupService.start()` (first sweep after 30 s, then hourly) -> `app.listen(PORT)`.
   The returned promise is stored but never `.catch`-ed; a rejected startup only surfaces as an
   unhandled rejection.
7. Shutdown: `shutdown()` in `index.ts:679-718` awaits the server promise, closes the HTTP server
   (without awaiting in-flight requests), closes the four workers sequentially, stops the watcher and
   cleanup timer, quits Redis, disconnects Prisma, exits 0. `database.ts` and `redis.ts` register
   their own SIGINT/SIGTERM handlers that call `process.exit(0)` after a disconnect, so on SIGINT
   three handlers race and the orderly worker close in `index.ts` may be cut short. There are no
   `uncaughtException`/`unhandledRejection` handlers.

### Redis handling

`redis.ts` creates one `Redis` instance with `maxRetriesPerRequest: null` and
`enableReadyCheck: false` (BullMQ requirements), logs connect/ready/error, and is shared by all four
queues and all four workers. ioredis retries forever by default, so an absent Redis produces a
repeating error log while the API keeps serving; the health endpoint still reports `ok`.

### Logging

All logging is `console.log/warn/error` with emoji prefixes; 205 call sites across `backend/src`,
heaviest in the scrape workers and file watcher. No levels, no timestamps, no request IDs, no
structured output. Prisma query logging is enabled whenever `NODE_ENV=development`. Under systemd
the stream goes to the journal.

### Prisma 7 / ESM / Node 22

`backend/package.json` is `"type": "module"` and `tsconfig.json` uses `module: ESNext` with
extensionless relative imports (only `./config/swagger.js` carries an extension). `tsc` emits
`dist/index.js` verbatim, which plain `node` cannot resolve under ESM; production therefore runs
`tsx dist/index.js` (ae6a201) while `systemd/tubeca-backend.service` and the `start` script still
say `node dist/index.js`. Prisma 7 requires a config file for the datasource URL; the CommonJS
`prisma.config.js` workaround (fdc9e93) was reverted to `prisma.config.ts` with a Node 22
requirement (54e40a2; `.nvmrc` and `engines.node >=22` followed in c95eedf). Because
`prisma.config.ts` calls `env("DATABASE_URL")`, every `prisma` CLI invocation needs a `.env`;
`PKGBUILD` writes a throwaway `DATABASE_URL="file:./prisma/build.db"` during packaging (d7d16a2).
`db:migrate` is `prisma migrate deploy` (non-interactive) and `db:migrate:dev` is `migrate dev`
(0a81375).

### API documentation pipeline

`config/swagger.ts` declares the OpenAPI 3.0 skeleton (tags, `bearerAuth`, component schemas for
`Error`, `User`, `Settings`, `Library`, `Collection`, `Media`, ...). `docs:generate` runs
`tsx src/swagger.ts` to write `openapi.json`, then `redocly build-docs` to `docs/api.html`; both
outputs are git-ignored. Because the inline handlers and the routers each document `/api/settings`
with different verbs and response shapes, the generated spec lists both.

## Interactions

- **Depends on:** Prisma models `Settings`, `TranscodingSettings`; Redis; the filesystem for
  `tubeca.config.json`, `data/images`, `data/hls-cache`; `ffmpeg` on `PATH` for encoder detection
  at import time.
- **Used by:** [Auth & Users](auth-and-users.md) (`JWT_SECRET`, `authenticate` middleware on the
  settings routes); [Metadata Scraping](metadata-scraping.md) (`getScraperConfigs()` ->
  `loadScrapers()`); [Libraries & Scanning](libraries-and-scanning.md) (`fileWatcher.*`,
  `UV_THREADPOOL_SIZE`); [Images](images.md) (`getImageStoragePath()`);
  [Streaming & Transcoding](streaming-and-transcoding.md) (`getHlsCacheConfig()`,
  `getTranscodingSettings()`, `maxConcurrentTranscodes`); [Frontend App](frontend-app.md)
  (`SettingsPage`, Vite proxy `PORT`); [Deployment](deployment.md) (`TUBECA_CONFIG_PATH`,
  `/etc/tubeca/*`, systemd units, `tsx` vs `node`); [Overview](overview.md).
- **Shared data:** `Settings`, `TranscodingSettings` tables; config keys `imagePath`, `hlsCache`,
  `fileWatcher`, `scrapers`; env `PORT`, `DATABASE_URL`, `REDIS_HOST/PORT/PASSWORD`, `JWT_SECRET`,
  `NODE_ENV`, `FILE_WATCHER_ENABLED`, `TUBECA_CONFIG_PATH`; the single `redisConnection` shared by
  every queue and worker in [Libraries & Scanning](libraries-and-scanning.md),
  [Metadata Scraping](metadata-scraping.md) and [Streaming & Transcoding](streaming-and-transcoding.md).

## History

- `4946f1d` 2025-11-28 Initial commit: Express bootstrap, `database.ts`, `redis.ts`, inline
  `/api/settings` and `/api/jobs/*` handlers, `SettingsService`.
- `41cf2f0` 2025-11-29 Scrapers added; `tubeca.config.json` and `appConfig.ts` introduced for API keys.
- `d7d4c32` 2025-12-01 File watcher added with `FILE_WATCHER_ENABLED` env override of the config file.
- `e3c4915` 2025-12-02 OpenAPI JSDoc on all endpoints; `config/swagger.ts`, `docs:generate`.
- `938e477` 2025-12-02 Jest infrastructure (ESM preset); only `authService` covered.
- `d71d4e5` 2025-12-05 HLS streaming; `hlsCache` config block, `getHlsCachePath()`, cleanup service.
- `d7d16a2`, `af9bbfe` 2025-12-14 PKGBUILD writes a `.env` so `prisma generate` finds `DATABASE_URL`.
- `ae6a201` 2025-12-14 Production runs `tsx dist/index.js` because plain `node` cannot load the ESM build.
- `7aa555d`, `4500646`, `7ab991b` 2025-12-15 `/etc/tubeca` config permissions, `TUBECA_CONFIG_PATH` in the
  systemd unit, `imagePath`/`hlsCache.path` defaults for packaged installs.
- `4dc330d` 2025-12-15 `getImageStoragePath()`/`getHlsCachePath()` load the config themselves when called without it.
- `b6003ef` 2025-12-16 `TranscodingSettings` model, service, routes and Settings UI tab with hardware acceleration.
- `0fc5947` 2025-12-19 `maxConcurrentTranscodes` setting; prefetch fix.
- `0a81375`, `fdc9e93`, `54e40a2` 2025-12-19 `migrate deploy`; `prisma.config.js` CommonJS detour; reverted to
  `prisma.config.ts` requiring Node 22.
- `c95eedf` 2026-07-01 `PORT` passes through Turbo to the Vite proxy; `.nvmrc` 22; `engines.node >=22`.
- `7052d0c` 2026-07-01 `UV_THREADPOOL_SIZE=24` in scripts; poll interval default 30 s and `binaryInterval`.

## Known Limitations

- No validation of any layer at startup: a typo in `tubeca.config.json` keys, a missing `JWT_SECRET`
  in production, or a `DATABASE_URL` pointing at an unmigrated file all start the server normally.
- `DATABASE_URL` default differs between `database.ts` (`file:./dev.db`) and `.env.example` /
  `prisma.config.ts` (`file:./prisma/dev.db`).
- `PATCH /api/settings` bypasses the Admin check and is the verb the frontend uses; `/api/jobs/*`
  and the inline `/api/media*` handlers in `index.ts` are dead or unauthenticated duplicates of
  router endpoints.
- Config file changes require a restart; DB settings take up to 60 s to apply due to stacked caches.
- Workers run inside the API process: a heavy scan or transcode competes with request handling, and
  the API cannot be scaled or restarted independently of in-flight jobs.
- Shutdown is racy (three competing signal handlers, `server.close` not awaited) and startup
  failures are unhandled rejections.
- `/api/health` ignores Redis, ffmpeg and worker liveness; Redis outages are only visible in logs.
- `console.*` logging with no levels; Prisma query logging floods development output.
- `hlsCache.maxSizeGB` is documented in the type but never enforced.
- `swagger.servers` and the `docs:generate` output are pinned to `localhost:3000`.
- `start` script and `systemd/tubeca-backend.service` use `node dist/index.js`, which fails under
  ESM; only the PKGBUILD path (`tsx`) works.
- Transcoding tab strings use inline i18n fallbacks; `en.json` only defines the six General keys.
- Tests: no backend tests for `appConfig`, settings routes, transcoding settings or bootstrap;
  `SettingsPage.test.tsx` covers only the General tab.

## Opportunities

- Introduce a single typed config module (e.g. zod schema over env + file) that validates once at
  startup, logs the effective configuration, and refuses to start in production without
  `JWT_SECRET`. Rationale: removes the silent-default class of bugs above. (M)
- Remove the inline `/api/settings`, `/api/media*` and `/api/jobs/*` handlers from `index.ts`, and
  switch the frontend to `PUT /api/settings` (or add PATCH to the router with `requireRole`).
  Rationale: closes the Viewer-can-rename hole and the unauthenticated job endpoints. (S)
- Align `DATABASE_URL` defaults and make `SettingsService` the only writer of `Settings` (routes
  currently bypass it with a different default name). (S)
- Cache `loadAppConfig()` once per process (or inject the loaded config) and drop the second cache
  layer in `HlsService`, so settings apply within one TTL. (S)
- Consolidate signal handling into `index.ts` (remove handlers from `database.ts`/`redis.ts`),
  await `server.close`, add `unhandledRejection`/`uncaughtException` handlers, and `.catch` the
  startup promise. (S)
- Extend `/api/health` with Redis `PING`, worker `isRunning()` and ffmpeg availability; keep the
  DB-only variant as a liveness probe. (S)
- Add an opt-in worker/API split: guard worker construction behind a `RUN_WORKERS` env var or a
  separate `worker.ts` entry so packaged installs can run them as a second unit. (M)
- Adopt a structured logger (pino) with levels, and gate Prisma query logging behind its own flag.
  (M)
- Fix the ESM build so `node dist/index.js` works (emit `.js` extensions or bundle with tsup/esbuild)
  and drop the runtime `tsx` dependency; update `systemd/tubeca-backend.service` to match. (M)
- Expose file-backed settings (scraper keys, watcher, paths) read-only in the Settings UI, and
  consider moving scraper keys to `SCRAPER_<ID>_API_KEY` env vars so all secrets live in `.env`. (M)
- Either enforce `hlsCache.maxSizeGB` in `HlsCacheCleanupService` or remove it from the type. (S)
- Tests: `appConfig` path resolution and precedence, settings routes (auth matrix incl. PATCH),
  `transcodingSettingsService` cache invalidation, and the Transcoding tab of `SettingsPage`. (M)
