# Build, Packaging & Deployment

> This part covers how Tubeca is built from source (pnpm workspaces + Turborepo), how the
> resulting tree is packaged for Arch Linux (`PKGBUILD` + `tubeca.install`), and how it is
> run in production: one esbuild-bundled backend binary (`dist/index.js`) run by plain `node`
> as two systemd services (`tubeca-backend` serving the API and the SPA on one port,
> `tubeca-worker` running scans, scrapes and the file watcher) alongside Redis, or as a
> container image (`Dockerfile`, `docker-compose.yml`) with a GitHub Actions workflow gating
> changes. It began as an Arch-only story and gained the container and CI paths on 2026-09-03.

## Responsibilities

- Define the workspace graph (`pnpm-workspace.yaml`) and the build order (`turbo.json`) so that
  `packages/*` and `scrapers/*` are compiled to `dist/` before `backend` and `frontend/ui`.
- Gate commits with a husky pre-commit hook that runs `pnpm lint && pnpm typecheck && pnpm test`
  across the whole monorepo.
- Build a pacman package from the local git checkout (`build-package.sh` -> `makepkg -sf`) that
  installs the whole workspace, including `node_modules`, under `/opt/tubeca`.
- Create the `tubeca` system user, `/var/lib/tubeca/{images,hls-cache}`, and `/etc/tubeca/`
  config files (`tubeca.env`, `tubeca.config.json`) via sysusers.d / tmpfiles.d and install hooks.
- Run `prisma migrate deploy` and generate a `JWT_SECRET` on install and upgrade.
- Ship two systemd units, `tubeca-backend` (API + SPA, port 3000) and `tubeca-worker`
  (scans, scrapes, watcher), both hardened, both running `node dist/index.js` with a different
  `TUBECA_ROLE`, and depending on `redis.service`.
- Provide a container path: multi-stage `Dockerfile`, `docker/entrypoint.sh` (migrations then
  the chosen role) and `docker-compose.yml` (api + worker + redis).
- Run lint, typecheck, tests, build and a Docker image build in CI (`.github/workflows/ci.yml`).
- Document a manual/other-distro path (`systemd/install.sh`) and an nginx reverse-proxy example.

## Goals

- **Single-command install on the author's own Arch machine.** Everything in the packaging
  history (all on 2025-12-14/15) is a fix discovered by actually running `makepkg` on one box.
- **Zero-config first boot.** `tubeca.install` auto-generates the JWT secret, rewrites the
  example `.env` for production, and runs migrations so the service can be enabled immediately.
- **Config survives upgrades.** `/etc/tubeca/*` are declared in `backup=()` so pacman preserves
  edits; `post_remove` deliberately leaves config, database and data in place.
- **Fast, unstripped packaging.** `options=('!strip' '!debug')` because `node_modules` holds
  thousands of JS files and stripping was the dominant packaging cost (096cd7c, 461d160).
- **Least-privilege runtime.** Units use `NoNewPrivileges`, `ProtectSystem=strict`,
  `ProtectHome`, `PrivateTmp` and enumerate `ReadWritePaths` explicitly.
- **One artefact, one port, one runtime.** The backend is bundled with esbuild into a single
  `dist/index.js` that plain `node` runs; it serves the built SPA itself, so the smallest install
  is Node, ffmpeg and Redis, and the same file runs the worker role.

## Components

| File | Role |
|------|------|
| `package.json` | Root scripts (`dev/build/lint/typecheck/test/clean` all delegate to `turbo`), `prepare: husky`, `engines.node >= 22`, `packageManager: pnpm@8.15.0`. |
| `pnpm-workspace.yaml` | Workspace globs: `frontend/*`, `backend`, `packages/*`, `scrapers/*`. |
| `turbo.json` | Pipeline: `build` depends on `^build` with `dist/**` outputs; `typecheck`/`test` depend on `^build`; `dev` is persistent, uncached and passes `PORT` through. |
| `.husky/pre-commit` | `pnpm lint && pnpm typecheck && pnpm test` (c3a9f25; tests added 2026-09-03). |
| `.nvmrc` | `22` (added with the Node 22 engine bump in c95eedf). |
| `packages/shared-types`, `packages/scraper-types` | `tsc` to `dist/`; consumed via `exports` -> `./dist/index.js` + `.d.ts`, so dependents cannot typecheck until they are built. |
| `scrapers/tmdb`, `scrapers/tvdb` | Same pattern; `backend` depends on them with `workspace:*`. |
| `backend/package.json` | `build: prisma generate && tsc --noEmit && node scripts/build.mjs` (esbuild bundle); `start`, `start:api`, `start:worker` run `node dist/index.js` with `UV_THREADPOOL_SIZE=24` and the role; `db:migrate: prisma migrate deploy`. |
| `backend/scripts/build.mjs` | esbuild: `src/index.ts` -> `dist/index.js` (ESM, node22 target, `packages: external`, sourcemap, `require` shim banner). |
| `backend/src/runtime/role.ts`, `runtime/frontend.ts` | `TUBECA_ROLE` parsing (`api`/`worker`/`all`), and `mountFrontend()` which serves `FRONTEND_DIST` with immutable hashed assets, uncached `index.html` and a history fallback for non-API, non-file GETs. |
| `Dockerfile`, `docker/entrypoint.sh`, `docker-compose.yml`, `.dockerignore` | Multi-stage image (build with pnpm; run on `node:22-bookworm-slim` + ffmpeg), `/data` volume for DB/config, entrypoint runs `prisma migrate deploy` then the role; compose wires api, worker and redis. |
| `.github/workflows/ci.yml` | On push/PR: pnpm install, lint, typecheck, test (with a Redis service), build; then a Docker image build with layer caching, pushed to `ghcr.io/wilkie/tubeca` as `edge` (main) or semver + `latest` (tags). |
| `CHANGELOG.md` | Keep-a-Changelog file; a version section per tag. |
| `backend/prisma.config.ts` | Prisma 7 config; reads `DATABASE_URL` via `dotenv/config` at load time, which is why the PKGBUILD must write a `.env` before building (d7d16a2, af9bbfe). |
| `frontend/ui/package.json`, `vite.config.ts` | `build: tsc && vite build`; dev proxy `/api` -> `127.0.0.1:${PORT ?? 3000}` (c95eedf, 6c12ed4). |
| `PKGBUILD` | Arch package: `pkgver()`, `build()`, `package()`; embeds the production systemd units, sysusers.d and tmpfiles.d as heredocs. |
| `tubeca.install` | pacman hooks `post_install`, `post_upgrade`, `pre_remove`, `post_remove`. |
| `build-package.sh` | Wrapper: checks for `makepkg`/`pnpm`, cleans `src/ pkg/ *.pkg.tar.*`, runs `makepkg -sf`. |
| `systemd/tubeca-backend.service`, `tubeca-worker.service` | The units, and the only copy of them: `Type=notify`, `WatchdogSec=30`, `node --enable-source-maps`, `.env` and data under `/opt/tubeca`. `package()` in the PKGBUILD rewrites the two paths for the Arch layout with `sed`. |
| `systemd/backup-database.sh` | Timestamped SQLite copy (`sqlite3 .backup`, falling back to `cp`) keeping the last five; run before any migration by `tubeca.install`, `systemd/install.sh` and the Docker entrypoint, and daily by `tubeca-backup.timer`. |
| `systemd/move-database.sh` | Moves a database (and its `-wal`/`-shm`) out of the install tree into `/var/lib/tubeca`; a no-op when there is nothing to move or the destination exists. |
| `systemd/tubeca-backup.{service,timer}` | Daily `OnCalendar=daily` backup, `Persistent=true`, keeping seven copies. |
| `backend/src/runtime/systemd.ts` | `sd_notify` over `NOTIFY_SOCKET` with no dependency: readiness, `STOPPING=1`, and a watchdog ping driven by the same health check `/api/health` uses. |
| `systemd/install.sh`, `uninstall.sh` | Root-run scripts for other distros: copy tree to `/opt/tubeca`, `pnpm install && pnpm build`, write `.env` with a random JWT secret, `prisma migrate deploy`, install units into `/etc/systemd/system`. |
| `systemd/nginx.conf.example` | Reverse-proxy example: proxies everything to port 3000 (the backend serves the SPA), disables buffering for `/api/stream/`. |
| `INSTALL.md`, `systemd/README.md`, `README.md` | Install/upgrade docs (Arch, other distros, nginx) and developer getting-started. |
| `.gitignore` | Excludes `dist/`, `build/`, `.turbo/`, `node_modules/`, `.env*`, `tubeca.config.json`, `*.db`, `coverage/`, `.claude/`. |

## How It Works

### Monorepo build

1. `pnpm install` links the six workspace packages. `@tubeca/backend` depends on
   `@tubeca/scraper-types`, `@tubeca/scraper-tmdb`, `@tubeca/scraper-tvdb`; `@tubeca/ui` depends on
   `@tubeca/shared-types`; scrapers depend on `scraper-types`.
2. `pnpm build` -> `turbo build`. Because every `build` task `dependsOn: ["^build"]`, Turbo builds
   `shared-types`/`scraper-types` first, then the scrapers, then `backend` and `ui`. Each library
   is plain `tsc` emitting ESM + declarations into `dist/`, and its `package.json` `exports`
   points at `dist/`, so there is no source-level path aliasing: a fresh clone must build the
   libraries before the backend or frontend can even typecheck. `typecheck` and `test` therefore
   also declare `dependsOn: ["^build"]`.
3. Backend build is `prisma generate && tsc --noEmit && node scripts/build.mjs`. `tsc` only
   type-checks; esbuild bundles `src/index.ts` and everything it imports (including the
   lazily-imported workers) into one ESM file, `dist/index.js`, with `node_modules` left
   external so the Prisma client, sharp and libsql load normally. Plain `node dist/index.js`
   runs it; `tsx` is now a dev-only dependency. Relative defaults (`data/images`, the config
   file at the repo root) are resolved by walking up from the bundle to the backend's
   `package.json` (`getBackendRoot()`), so they do not depend on the compiled file's depth.
4. Frontend build is `tsc && vite build` -> `frontend/ui/dist/` (single hashed JS + CSS bundle
   and `index.html`). The API base is hard-coded as the relative path `/api`
   (`frontend/ui/src/api/client.ts:168`); there is no `VITE_*` override.
5. The pre-commit hook runs `pnpm lint && pnpm typecheck && pnpm test` through Turbo, so a
   commit triggers library builds if `dist/` is stale and takes about a minute for the two test
   suites. `.github/workflows/ci.yml` repeats lint, typecheck, test and build on every push and
   pull request (Node 22, pnpm via `pnpm/action-setup`, a Redis service container, a throwaway
   `backend/.env` for Prisma), then builds the Docker image without pushing it.
6. `dev` passes `PORT` through (`turbo.json`), and Vite's proxy target reads the same `PORT`
   (c95eedf) so `PORT=4000 pnpm dev` moves both the backend listener
   (`backend/src/index.ts:32`) and the frontend proxy together.

### Arch package build (`PKGBUILD`)

- `source=("tubeca::git+file://${startdir}")` — makepkg clones the *local repository* at HEAD.
  Uncommitted changes are not packaged. `pkgver()` tries `git describe --tags`; since the repo
  has no tags it falls back to `1.0.0.r<commit-count>.<short-hash>` (0d48875).
- `build()`: writes `backend/.env` with `DATABASE_URL="file:./prisma/build.db"` because
  `prisma.config.ts` calls `env("DATABASE_URL")` at import time and `prisma generate` fails
  without it (d7d16a2, af9bbfe); `pnpm install --frozen-lockfile || pnpm install`; then
  `pnpm build`. (Until 2026-09-03 it also installed `serve` and `tsx` into the tree; neither is
  needed now.)
- `build()` ends with `pnpm --filter @tubeca/backend deploy --prod "${srcdir}/deploy"` plus
  `prisma generate` in that tree: a self-contained backend with only production dependencies
  (the workspace scrapers included) and only the files listed in `backend/package.json`
  `files` (`dist`, `prisma`, `prisma.config.ts`, `openapi.json`).
- `package()`: installs that deploy tree as `/opt/tubeca/backend` and the built SPA as
  `/opt/tubeca/frontend/ui/dist`; nothing else from the workspace ships. Installs
  `backend/.env.example` as `/etc/tubeca/tubeca.env` and either the builder's
  `tubeca.config.json` or a default one with `imagePath`/`hlsCache.path` under `/var/lib/tubeca`
  (7aa555d, 7ab991b); symlinks `/opt/tubeca/backend/.env` and `/opt/tubeca/tubeca.config.json`
  to `/etc/tubeca/`; writes the `tubeca-backend` and `tubeca-worker` units, `sysusers.d/tubeca.conf` and `tmpfiles.d/tubeca.conf`;
  installs README, `systemd/README.md` and `nginx.conf.example` to `/usr/share/doc/tubeca/`.
- `depends=('nodejs>=22' 'npm' 'redis' 'ffmpeg')`, `makedepends=('pnpm' 'git')`,
  `optdepends=('nginx')`; the Node floor matches `engines.node >= 22`.

### Install hooks (`tubeca.install`)

`post_install`: `systemd-sysusers`, `systemd-tmpfiles --create`, `chown -R tubeca:tubeca
/opt/tubeca /var/lib/tubeca`, config files to `root:tubeca 0640` (4500646), then
`sudo -u tubeca npx prisma generate`, then generate `JWT_SECRET` with `openssl rand -hex 32` if
the placeholder is present, then `sed` `NODE_ENV=development -> production` and `DATABASE_URL`
`dev.db -> tubeca.db`, and only then `npx prisma migrate deploy || npx prisma db push` (the
migration step ran before the `sed` until 2026-09-03 and therefore migrated the wrong file; its
stderr is no longer swallowed, though `|| true` still keeps the install from failing).
`post_upgrade` repeats the chown/
chmod, runs `prisma generate` + `migrate deploy`, and restarts whichever services are active.
`pre_remove` stops/disables the units; `post_remove` prints what was preserved.

### Runtime layout (Arch)

| Path | Purpose |
|------|---------|
| `/opt/tubeca` | Full workspace incl. `node_modules`, owned by `tubeca` |
| `/etc/tubeca/tubeca.env` | `EnvironmentFile` for the backend (`PORT`, `DATABASE_URL`, `REDIS_*`, `JWT_SECRET`, `FILE_WATCHER_ENABLED`) |
| `/etc/tubeca/tubeca.config.json` | App config, pointed to by `Environment=TUBECA_CONFIG_PATH=...` in the unit (4500646); resolved first by `backend/src/config/appConfig.ts:74` |
| `/var/lib/tubeca/tubeca.db` | SQLite database (2026-09-04; it was `/opt/tubeca/backend/prisma/tubeca.db`, which a package upgrade replaces) |
| `/var/lib/tubeca/backups` | Database copies, from upgrades and from the daily timer (0750, tmpfiles.d) |
| `/var/lib/tubeca/images`, `/var/lib/tubeca/hls-cache` | Image store and HLS segment cache (0750, tmpfiles.d) |

### The two services and the role switch

Both units run `/usr/bin/node dist/index.js` as `tubeca` from `/opt/tubeca/backend`, with
`NODE_ENV=production`, `UV_THREADPOOL_SIZE=24` (so the 7052d0c fix reaches production) and
`TUBECA_CONFIG_PATH=/etc/tubeca/tubeca.config.json`; they differ only in `TUBECA_ROLE`:

- `tubeca-backend.service` (`TUBECA_ROLE=api`, `FRONTEND_DIST=/opt/tubeca/frontend/ui/dist`):
  Express, Swagger UI, the HLS cache janitor and the SPA. `mountFrontend()` serves
  `FRONTEND_DIST` when its `index.html` exists (hashed `/assets/*` immutable for a year,
  `index.html` `no-cache`, history fallback for GET/HEAD requests that are not `/api*` and have
  no extension); if the build is absent it logs a hint and serves the API only, so a
  nginx-fronted install keeps working. Everything is on port 3000; `serve` and port 8080 are gone.
- `tubeca-worker.service` (`TUBECA_ROLE=worker`): the three BullMQ workers and, when enabled,
  the file watcher. Workers are imported lazily by role (`startWorkers()` in `index.ts`), so the
  API process never opens worker connections or starts chokidar.
- `TUBECA_ROLE=all` (the default, used by `pnpm dev` and `pnpm start`) does both in one process.

Scraper plugins load in every role (the API needs them for Identify search). Shutdown closes
whichever of the HTTP server, workers, watcher, HLS janitor and FFmpeg children this process
owns. The obsolete `video-processing` queue and its stub worker were deleted with this change.

### Container image

`Dockerfile` is two stages: `node:22-bookworm-slim` with corepack/pnpm to `pnpm install
--frozen-lockfile && pnpm build` (a throwaway `backend/.env` satisfies `prisma.config.ts`), then
`pnpm --filter @tubeca/backend deploy --prod /deploy` + `prisma generate`, and a runtime stage
with `ffmpeg` that copies only `/deploy` (as `/app/backend`) and `frontend/ui/dist`. The `prisma`
CLI is a runtime dependency so the entrypoint can run `migrate deploy`. Defaults baked into the image:
`TUBECA_ROLE=all`, `PORT=3000`, `DATABASE_URL=file:/data/tubeca.db`,
`TUBECA_CONFIG_PATH=/data/tubeca.config.json`, `FRONTEND_DIST=/app/frontend/ui/dist`,
`REDIS_HOST=redis`. `docker/entrypoint.sh` runs `prisma migrate deploy` (skippable with
`TUBECA_MIGRATE=0`, which the compose worker sets) and `exec`s the backend. `JWT_SECRET` must
come from the environment; the backend refuses to start without it in production.
`docker-compose.yml` runs `api` (port 3000, `./data:/data`, `./media:/media:ro`), `worker`
(same image, `TUBECA_ROLE=worker`, `FILE_WATCHER_ENABLED=true`) and `redis:7-alpine`.

### Other-distro path

`systemd/install.sh` copies the source tree to `/opt/tubeca`, runs `pnpm install` and `pnpm build`
as root, writes `backend/.env` (`DATABASE_URL=file:/var/lib/tubeca/tubeca.db`, random
`JWT_SECRET`, `DATA_DIR=/opt/tubeca/data`), moves a database left in the install tree by an
earlier version and rewrites the `DATABASE_URL` of an `.env` that still points there, backs up
the database, runs `prisma migrate deploy` and stops if it fails, chowns to `tubeca`,
and installs `systemd/tubeca-backend.service`, `tubeca-worker.service` and the backup timer. `DATA_DIR` is not read
anywhere in `backend/src`. This path has no `TUBECA_CONFIG_PATH`; config is found via
`getRepoRoot()` (the parent of the backend package), which works from the bundle.

### Health, readiness and the watchdog

Both units are `Type=notify` with `WatchdogSec=30`. `backend/src/runtime/systemd.ts` speaks
`sd_notify` directly over the `NOTIFY_SOCKET` datagram socket, so there is no dependency: the
process sends `READY=1` once it is listening, `WATCHDOG=1` every fifteen seconds while healthy,
and `STOPPING=1` on shutdown. Everything is a no-op when `NOTIFY_SOCKET` is unset, which covers
development, tests and `docker run`.

"Healthy" is the same check `/api/health` answers with: a `SELECT 1` against SQLite for every
role, plus a Redis `PING` where the process runs workers. An API-only process that cannot reach
Redis is still healthy, because it can serve and stream; only scans and scrapes are affected, and
restarting the site for that would be worse. A failing check simply stops the pings and lets
systemd apply the unit's restart policy, so a check that recovers within the deadline is never
noticed.

### Where the database lives

Until 2026-09-04 it sat in `/opt/tubeca/backend/prisma`, which is program files: a package
upgrade or a re-run of `install.sh` replaces that tree, and the two installers disagreed about
the file's name (`tubeca.db` on Arch, `prod.db` generic), so the generic installer's
back-up-before-migrating step looked for a file that was never there. Both now use
`/var/lib/tubeca/tubeca.db`, and `systemd/move-database.sh` moves an older one across —
sidecars included, since a database that was not closed cleanly keeps its most recent writes in
the `-wal` file — after taking a copy and before any migration runs.

### Upgrades and the database

Every path that migrates backs the database up first, through `systemd/backup-database.sh`:
`sqlite3 .backup` when the CLI is present, a plain copy otherwise, timestamped into
`/var/lib/tubeca/backups` (Arch and generic since 2026-09-04) or `/data/backups` (Docker),
keeping the last five. `tubeca-backup.timer` runs the same script daily, keeping seven, with
`Persistent=true` so a machine that was off catches up; the generic installer enables it, the
package ships it disabled and `post_install` says how to turn it on. SQLite has no undo, and a failed migration on a library nobody has a copy
of is the worst thing an upgrade can do.

A migration failure is no longer swallowed: `post_install` and `post_upgrade` print what failed
and what to run, and `systemd/install.sh` exits non-zero. To restore, stop both services and
copy a file from the backup directory over the database.

### What is not provided

No packaging for Debian,
Fedora, Homebrew, etc. beyond the generic shell script; no TLS/reverse-proxy automation beyond
the nginx example; no scheduled backups, and none at all for `/var/lib/tubeca` or Redis, though
every install path copies the SQLite database before migrating it;
no data migration beyond `prisma migrate deploy`;
no `LICENSE` file despite `license=('MIT')` (the PKGBUILD guards the copy with `if [ -f LICENSE ]`).

### `dist/` directories

`dist/` is gitignored globally (`.gitignore:6`) and none of the `dist/` trees are tracked. The
stray `/home/wilkie/tubeca/dist/` at the repo root (an old Vite bundle from 2025-11-27, before
the initial commit) is therefore already ignored and is simply leftover output; it can be deleted.

## Interactions

- **Depends on:** [Configuration](configuration.md) for `.env` keys and `tubeca.config.json`
  resolution (`TUBECA_CONFIG_PATH`, `imagePath`, `hlsCache.path`); [Content Model](content-model.md)
  for the Prisma schema whose migrations `tubeca.install` applies; Redis for
  [Libraries & Scanning](libraries-and-scanning.md), [Metadata Scraping](metadata-scraping.md)
  and [Streaming & Transcoding](streaming-and-transcoding.md) queues (`Wants=redis.service`);
  `ffmpeg` for transcoding.
- **Used by:** every other part implicitly — [Frontend App](frontend-app.md) is only reachable
  in production through `serve` or nginx; [Images](images.md) writes under `/var/lib/tubeca/images`;
  [Streaming & Transcoding](streaming-and-transcoding.md) writes HLS segments under
  `/var/lib/tubeca/hls-cache` (both permitted by `ReadWritePaths`); [Auth & Users](auth-and-users.md)
  relies on the generated `JWT_SECRET`; [Metadata Scraping](metadata-scraping.md) plugins are
  shipped as built workspace packages under `/opt/tubeca/scrapers`.
- **Shared data:** `backend/.env` / `/etc/tubeca/tubeca.env` (`PORT`, `NODE_ENV`, `DATABASE_URL`,
  `REDIS_HOST/PORT/PASSWORD`, `JWT_SECRET`, `FILE_WATCHER_ENABLED`, `TUBECA_CONFIG_PATH`);
  `tubeca.config.json`; the SQLite file and `prisma/migrations/`; no Prisma models are owned by
  this part. See [Overview](overview.md) for the process/port map.

## History

- 2026-09-03 — `Type=notify` units with `WatchdogSec` fed by the health check, `--enable-source-maps`, `systemd/backup-database.sh` run before every migration, migration failures surfaced instead of ignored, and the PKGBUILD's unit heredocs replaced by a `sed` over `systemd/*.service`.

- `4946f1d` 2025-11-28 — Initial commit: pnpm workspace + Turborepo skeleton, `.gitignore` with `dist/`.
- `c3a9f25` 2025-12-02 — Husky pre-commit hook (`pnpm lint && pnpm typecheck`), `typecheck` task added to Turbo.
- `e9cd41c` 2025-12-02 — README rewritten with getting-started, config and script tables.
- `363b909` 2025-12-03 — `tubeca.config.json` removed from git and ignored; `tubeca.config.example.json` kept.
- `2e1be8d` 2025-12-14 — systemd units, install/uninstall scripts, nginx example, `INSTALL.md`, first `PKGBUILD` + `tubeca.install`.
- `0d48875` 2025-12-14 — `pkgver()` falls back to commit count + hash when there are no tags.
- `af9bbfe`, `d7d16a2` 2025-12-14 — Set `DATABASE_URL` / write `backend/.env` in `build()` so `prisma generate` works.
- `096cd7c` 2025-12-14, `461d160` 2025-12-15 — `!strip` then `!debug` to stop makepkg crawling `node_modules`.
- `8dec2d8` 2025-12-14 — `serve` installed into the package instead of `npx serve` at runtime.
- `ae6a201` 2025-12-14 — Backend `ExecStart` switched to `tsx dist/index.js` for ESM support.
- `7aa555d`, `4500646`, `7ab991b` 2025-12-15 — Config files `root:tubeca 0640`, HLS cache and image paths under `/var/lib/tubeca`, `TUBECA_CONFIG_PATH` in the unit.
- `0a81375` 2025-12-19 — `db:migrate` becomes `prisma migrate deploy`; `db:migrate:dev` added.
- `fdc9e93`, `54e40a2` 2025-12-19 — `prisma.config.ts` -> `.js` -> back to `.ts`, concluding Node 22 is required.
- `6c12ed4` 2025-12-19 — Vite proxy uses `127.0.0.1` instead of `localhost`.
- `c95eedf` 2026-07-01 — `PORT` passed through Turbo to the Vite proxy; `engines.node >= 22`; `.nvmrc`.
- `7052d0c` 2026-07-01 — `UV_THREADPOOL_SIZE=24` added to `dev`/`start` scripts (not to the systemd unit).
- 2026-09-03 — `tubeca.install` runs migrations after rewriting `DATABASE_URL`; Prisma stderr no longer hidden.
- 2026-09-03 — `pnpm test` added to the pre-commit hook; backend Jest gets a migrated SQLite template per run.
- 2026-09-03 — Backend bundled with esbuild (`node dist/index.js` works, `tsx` dev-only); `TUBECA_ROLE` splits API and worker processes; API serves the SPA (`serve`/port 8080 removed); units, PKGBUILD, install scripts and docs updated; `Dockerfile`, `docker-compose.yml`, entrypoint and CI workflow added; `video-processing` queue and worker deleted.
- 2026-09-03 — Releases: `v1.0.0` tagged, `CHANGELOG.md` added, CI publishes `ghcr.io/wilkie/tubeca` (`edge` from `main`, semver + `latest` from tags); compose defaults to the published image.
- 2026-09-03 — Backend ships as a `pnpm deploy --prod` tree (dist, prisma, `openapi.json`, prod deps) in both the Docker image and the Arch package; `openapi.json` generated by `pnpm build` and served in production instead of scanning sources.
- 2026-09-04 — The database moved to `/var/lib/tubeca/tubeca.db` from inside the install tree, with `systemd/move-database.sh` carrying an existing one across on upgrade; both installers now agree on the path and the name, which also fixes the generic installer's back-up-before-migrating step looking for a file it never wrote. `tubeca-backup.timer` added for a daily copy between upgrades.

## Known Limitations

- **Migration failures do not fail the install.** `migrate deploy || db push || true` prints
  errors now but still reports success; a broken migration is only noticed when the service
  fails to start. Installs made before 2026-09-03 may have an empty `tubeca.db` and a migrated
  `dev.db` until their first `post_upgrade`.
- **Two copies of the unit text** still exist (`systemd/*.service` and the PKGBUILD heredocs),
  differing only in paths; they were re-synchronised on 2026-09-03 but nothing enforces it.
- **The Arch `package()` change is untested**: `makepkg` is not available on the development
  machine, so the deploy-based layout was verified only through the Docker image, which uses
  the same `pnpm deploy` step.
- **The bundle is one file**: a stack trace points into `dist/index.js` (source maps are emitted
  but Node needs `--enable-source-maps` to use them; the units do not pass it).
- **Arch-only, local-source packaging**: `source=git+file://${startdir}` only packages committed
  HEAD; there are no tags, so versions are non-monotonic across branches.
- **No backups, no upgrade notes**: `INSTALL.md` says "the package automatically runs database
  migrations on upgrade" but nothing snapshots `tubeca.db` first; the compose file has no backup
  sidecar either.
- **CI and publishing are unverified on GitHub**: the workflow was written without a GitHub
  run; the Docker image was built and booted locally. The first tag push will exercise the
  GHCR publish path (it needs the repository's package visibility set as desired).
- **Database lives under `/opt/tubeca/backend/prisma`**, mixed with code, and `post_remove`
  leaves it there while `pacman -R` deletes the surrounding tree's ownership context.
- `DATA_DIR` written by `systemd/install.sh` is unused by the backend; `LICENSE` referenced by
  the PKGBUILD does not exist.

## Opportunities

- **Trim further**: `sharp` and `@libsql/client` ship native binaries for the build platform
  only; a multi-arch image (arm64 for small home servers) needs `docker buildx` with
  `--platform`, and the `prisma` CLI could be swapped for a lighter migration runner. (M)


