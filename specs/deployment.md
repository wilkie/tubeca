# Build, Packaging & Deployment

> This part covers how Tubeca is built from source (pnpm workspaces + Turborepo), how the
> resulting tree is packaged for Arch Linux (`PKGBUILD` + `tubeca.install`), and how it is
> run in production as two systemd services (a `tsx`-run backend and a `serve`-run static
> frontend) alongside Redis. It exists so the author can install and upgrade Tubeca on a
> single Arch box with `pacman -U`; it is not a general-purpose distribution story.

## Responsibilities

- Define the workspace graph (`pnpm-workspace.yaml`) and the build order (`turbo.json`) so that
  `packages/*` and `scrapers/*` are compiled to `dist/` before `backend` and `frontend/ui`.
- Gate commits with a husky pre-commit hook that runs `pnpm lint && pnpm typecheck` across the
  whole monorepo.
- Build a pacman package from the local git checkout (`build-package.sh` -> `makepkg -sf`) that
  installs the whole workspace, including `node_modules`, under `/opt/tubeca`.
- Create the `tubeca` system user, `/var/lib/tubeca/{images,hls-cache}`, and `/etc/tubeca/`
  config files (`tubeca.env`, `tubeca.config.json`) via sysusers.d / tmpfiles.d and install hooks.
- Run `prisma migrate deploy` and generate a `JWT_SECRET` on install and upgrade.
- Ship two systemd units: `tubeca-backend` (API, port 3000) and `tubeca-frontend` (static SPA,
  port 8080), both hardened and depending on `redis.service`.
- Document a manual/other-distro path (`systemd/install.sh`) and an nginx reverse-proxy example.

## Goals

- **Single-command install on the author's own Arch machine.** Everything in the packaging
  history (all on 2025-12-14/15) is a fix discovered by actually running `makepkg` on one box.
- **Zero-config first boot.** `tubeca.install` auto-generates the JWT secret, rewrites the
  example `.env` for production, and runs migrations so the service can be enabled immediately.
- **Config survives upgrades.** `/etc/tubeca/*` are declared in `backup=()` so pacman preserves
  edits; `post_remove` deliberately leaves config, database and data in place.
- **Fast, unstripped packaging.** `options=('!strip' '!debug')` because `node_modules` holds
  thousands of JS files and stripping was the dominant packaging cost (3d6b9a1, f68198a).
- **Least-privilege runtime.** Units use `NoNewPrivileges`, `ProtectSystem=strict`,
  `ProtectHome`, `PrivateTmp` and enumerate `ReadWritePaths` explicitly.
- **Minimal runtime toolchain.** Rather than fix the ESM output of `tsc`, the package runs the
  compiled backend through `tsx` and the frontend through `serve` (see Known Limitations).

## Components

| File | Role |
|------|------|
| `package.json` | Root scripts (`dev/build/lint/typecheck/test/clean` all delegate to `turbo`), `prepare: husky`, `engines.node >= 22`, `packageManager: pnpm@8.15.0`. |
| `pnpm-workspace.yaml` | Workspace globs: `frontend/*`, `backend`, `packages/*`, `scrapers/*`. |
| `turbo.json` | Pipeline: `build` depends on `^build` with `dist/**` outputs; `typecheck`/`test` depend on `^build`; `dev` is persistent, uncached and passes `PORT` through. |
| `.husky/pre-commit` | `pnpm lint && pnpm typecheck` (bdf633a). |
| `.nvmrc` | `22` (added with the Node 22 engine bump in 8d11854). |
| `packages/shared-types`, `packages/scraper-types` | `tsc` to `dist/`; consumed via `exports` -> `./dist/index.js` + `.d.ts`, so dependents cannot typecheck until they are built. |
| `scrapers/tmdb`, `scrapers/tvdb` | Same pattern; `backend` depends on them with `workspace:*`. |
| `backend/package.json` | `build: prisma generate && tsc`; `start: node dist/index.js` (not what production uses); `db:migrate: prisma migrate deploy` (fe6629b). |
| `backend/prisma.config.ts` | Prisma 7 config; reads `DATABASE_URL` via `dotenv/config` at load time, which is why the PKGBUILD must write a `.env` before building (6b0643b, 9a0e494). |
| `frontend/ui/package.json`, `vite.config.ts` | `build: tsc && vite build`; dev proxy `/api` -> `127.0.0.1:${PORT ?? 3000}` (8d11854, 64b1e52). |
| `PKGBUILD` | Arch package: `pkgver()`, `build()`, `package()`; embeds the production systemd units, sysusers.d and tmpfiles.d as heredocs. |
| `tubeca.install` | pacman hooks `post_install`, `post_upgrade`, `pre_remove`, `post_remove`. |
| `build-package.sh` | Wrapper: checks for `makepkg`/`pnpm`, cleans `src/ pkg/ *.pkg.tar.*`, runs `makepkg -sf`. |
| `systemd/tubeca-backend.service`, `tubeca-frontend.service` | The *non-Arch* units (`/usr/bin/node dist/index.js`, `npx serve`); these diverge from the units embedded in `PKGBUILD`. |
| `systemd/install.sh`, `uninstall.sh` | Root-run scripts for other distros: copy tree to `/opt/tubeca`, `pnpm install && pnpm build`, write `.env` with a random JWT secret, `prisma migrate deploy`, install units into `/etc/systemd/system`. |
| `systemd/nginx.conf.example` | Reverse-proxy example: serves `frontend/ui/dist`, proxies `/api` and `/api-docs`, disables buffering for `/api/stream/`. |
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
3. Backend build is `prisma generate && tsc` (`backend/package.json`). `tsc` emits ESM
   (`"type": "module"`, `module: ESNext`, `moduleResolution: node`) but the sources use
   extensionless relative imports (`import { prisma } from './config/database'` in
   `backend/src/index.ts:5`). Node's ESM loader rejects those, so `node dist/index.js` (the
   `start` script and the original systemd unit) does not actually run; see "tsx in production".
4. Frontend build is `tsc && vite build` -> `frontend/ui/dist/` (single hashed JS + CSS bundle
   and `index.html`). The API base is hard-coded as the relative path `/api`
   (`frontend/ui/src/api/client.ts:168`); there is no `VITE_*` override.
5. The pre-commit hook (bdf633a) runs `pnpm lint && pnpm typecheck` through Turbo, so a commit
   triggers library builds if `dist/` is stale. There is no CI; the hook is the only gate.
6. `dev` passes `PORT` through (`turbo.json`), and Vite's proxy target reads the same `PORT`
   (8d11854) so `PORT=4000 pnpm dev` moves both the backend listener
   (`backend/src/index.ts:32`) and the frontend proxy together.

### Arch package build (`PKGBUILD`)

- `source=("tubeca::git+file://${startdir}")` — makepkg clones the *local repository* at HEAD.
  Uncommitted changes are not packaged. `pkgver()` tries `git describe --tags`; since the repo
  has no tags it falls back to `1.0.0.r<commit-count>.<short-hash>` (39e0386).
- `build()`: writes `backend/.env` with `DATABASE_URL="file:./prisma/build.db"` because
  `prisma.config.ts` calls `env("DATABASE_URL")` at import time and `prisma generate` fails
  without it (6b0643b, 9a0e494); `pnpm install --frozen-lockfile || pnpm install`; then
  `pnpm add serve` in `frontend/ui` (b0fb910) and `pnpm add tsx` in `backend` (1dc6505) so both
  runtime tools live in the package's own `node_modules/.bin`; then `pnpm build`.
- `package()`: copies `backend/`, `frontend/`, `packages/`, `scrapers/` and the *entire root*
  `node_modules/` (dev dependencies included: jest, redocly, eslint, etc.) to `/opt/tubeca`;
  installs `backend/.env.example` as `/etc/tubeca/tubeca.env` and either the builder's
  `tubeca.config.json` or a default one with `imagePath`/`hlsCache.path` under `/var/lib/tubeca`
  (1d11983, 75b5666); symlinks `/opt/tubeca/backend/.env` and `/opt/tubeca/tubeca.config.json`
  to `/etc/tubeca/`; writes the two units, `sysusers.d/tubeca.conf` and `tmpfiles.d/tubeca.conf`;
  installs README, `systemd/README.md` and `nginx.conf.example` to `/usr/share/doc/tubeca/`.
- `depends=('nodejs>=18' 'npm' 'redis' 'ffmpeg')`, `makedepends=('pnpm' 'git')`,
  `optdepends=('nginx')`. Note the `nodejs>=18` floor contradicts `engines.node >= 22` and
  the Prisma 7 requirement recorded in 698db3b.

### Install hooks (`tubeca.install`)

`post_install`: `systemd-sysusers`, `systemd-tmpfiles --create`, `chown -R tubeca:tubeca
/opt/tubeca /var/lib/tubeca`, config files to `root:tubeca 0640` (fb3eb0c), then
`sudo -u tubeca npx prisma generate`, `npx prisma migrate deploy || npx prisma db push`,
then generate `JWT_SECRET` with `openssl rand -hex 32` if the placeholder is present, then
`sed` `NODE_ENV=development -> production` and `DATABASE_URL` `dev.db -> tubeca.db`. All Prisma
commands are `2>/dev/null || true`, so failures are silent. `post_upgrade` repeats the chown/
chmod, runs `prisma generate` + `migrate deploy`, and restarts whichever services are active.
`pre_remove` stops/disables the units; `post_remove` prints what was preserved.

### Runtime layout (Arch)

| Path | Purpose |
|------|---------|
| `/opt/tubeca` | Full workspace incl. `node_modules`, owned by `tubeca` |
| `/etc/tubeca/tubeca.env` | `EnvironmentFile` for the backend (`PORT`, `DATABASE_URL`, `REDIS_*`, `JWT_SECRET`, `FILE_WATCHER_ENABLED`) |
| `/etc/tubeca/tubeca.config.json` | App config, pointed to by `Environment=TUBECA_CONFIG_PATH=...` in the unit (fb3eb0c); resolved first by `backend/src/config/appConfig.ts:74` |
| `/opt/tubeca/backend/prisma/tubeca.db` | SQLite database (inside `/opt`, allowed via `ReadWritePaths=/opt/tubeca/backend/prisma`) |
| `/var/lib/tubeca/images`, `/var/lib/tubeca/hls-cache` | Image store and HLS segment cache (0750, tmpfiles.d) |

### The two services

- `tubeca-backend.service`: `User=tubeca`, `WorkingDirectory=/opt/tubeca/backend`,
  `ExecStart=/opt/tubeca/backend/node_modules/.bin/tsx dist/index.js`,
  `After=network.target redis.service`, `Wants=redis.service`, `Restart=on-failure`,
  `NODE_ENV=production`. The backend handles `SIGTERM`/`SIGINT` for graceful shutdown
  (`backend/src/index.ts:720`). The unit does not set `UV_THREADPOOL_SIZE=24`, which the
  `dev`/`start` scripts set (4abe949) to avoid DNS/threadpool starvation with network mounts.
- `tubeca-frontend.service`: `ExecStart=/opt/tubeca/frontend/ui/node_modules/.bin/serve -s dist
  -l 8080`, `After=tubeca-backend.service`. `serve -s` is an SPA fallback server with no proxy
  configuration (there is no `serve.json`). The backend does not serve the SPA either (no
  `express.static` anywhere in `backend/src`). Because the SPA calls the relative `/api`, the
  browser sends API requests to port 8080, where `serve` answers with `index.html`; the packaged
  two-process layout only works behind a reverse proxy that routes `/api` to port 3000, which
  is exactly what `nginx.conf.example` does. The docs nevertheless say "Frontend: http://localhost:8080".

### tsx in production

`tsx` (an esbuild-based TS/ESM loader) is used to run the already-compiled `dist/index.js`
purely because it tolerates extensionless ESM imports (1dc6505). Implications: the production
process depends on a dev tool and on esbuild native binaries; each start pays the transform
cost; stack traces go through tsx's loader; `pnpm add tsx` in `build()` mutates
`backend/package.json` in the build tree, so the packaged manifest differs from git; and the
`backend/package.json` `start` script and `systemd/tubeca-backend.service` (plain `node`) are
both non-functional as written.

### Other-distro path

`systemd/install.sh` copies the source tree to `/opt/tubeca`, runs `pnpm install` and `pnpm build`
as root, writes `backend/.env` (`DATABASE_URL=file:./prisma/prod.db`, random `JWT_SECRET`,
`DATA_DIR=/opt/tubeca/data`), runs `prisma migrate deploy || prisma db push`, chowns to `tubeca`,
and installs the `systemd/*.service` files, which use `/usr/bin/node dist/index.js` and
`/usr/bin/npx serve` (network fetch on first start). `DATA_DIR` is not read anywhere in
`backend/src`. This path has no `TUBECA_CONFIG_PATH`; config is found by walking up from
`__dirname` to the repo root (`appConfig.ts:83`), which still works from `dist/config/`.

### What is not provided

No Dockerfile or compose file; no CI workflow (`.github/` absent); no release tags or changelog
(`pkgver` fallback always applies; every package is `1.0.0.rN.hash`); no packaging for Debian,
Fedora, Homebrew, etc. beyond the generic shell script; no TLS/reverse-proxy automation beyond
the nginx example; no backup or restore tooling for `tubeca.db`, `/var/lib/tubeca` or Redis;
no data migration beyond `prisma migrate deploy`; no health-check endpoint wired into systemd;
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

- `4946f1d` 2025-11-28 — Initial commit: pnpm workspace + Turborepo skeleton, `.gitignore` with `dist/`.
- `bdf633a` 2025-12-02 — Husky pre-commit hook (`pnpm lint && pnpm typecheck`), `typecheck` task added to Turbo.
- `81b08bf` 2025-12-02 — README rewritten with getting-started, config and script tables.
- `7366e13` 2025-12-03 — `tubeca.config.json` removed from git and ignored; `tubeca.config.example.json` kept.
- `a48672a` 2025-12-14 — systemd units, install/uninstall scripts, nginx example, `INSTALL.md`, first `PKGBUILD` + `tubeca.install`.
- `39e0386` 2025-12-14 — `pkgver()` falls back to commit count + hash when there are no tags.
- `9a0e494`, `6b0643b` 2025-12-14 — Set `DATABASE_URL` / write `backend/.env` in `build()` so `prisma generate` works.
- `3d6b9a1` 2025-12-14, `f68198a` 2025-12-15 — `!strip` then `!debug` to stop makepkg crawling `node_modules`.
- `b0fb910` 2025-12-14 — `serve` installed into the package instead of `npx serve` at runtime.
- `1dc6505` 2025-12-14 — Backend `ExecStart` switched to `tsx dist/index.js` for ESM support.
- `1d11983`, `fb3eb0c`, `75b5666` 2025-12-15 — Config files `root:tubeca 0640`, HLS cache and image paths under `/var/lib/tubeca`, `TUBECA_CONFIG_PATH` in the unit.
- `fe6629b` 2025-12-19 — `db:migrate` becomes `prisma migrate deploy`; `db:migrate:dev` added.
- `0263276`, `698db3b` 2025-12-19 — `prisma.config.ts` -> `.js` -> back to `.ts`, concluding Node 22 is required.
- `64b1e52` 2025-12-19 — Vite proxy uses `127.0.0.1` instead of `localhost`.
- `8d11854` 2026-07-01 — `PORT` passed through Turbo to the Vite proxy; `engines.node >= 22`; `.nvmrc`.
- `4abe949` 2026-07-01 — `UV_THREADPOOL_SIZE=24` added to `dev`/`start` scripts (not to the systemd unit).

## Known Limitations

- **First-boot database bug.** `post_install` runs `prisma migrate deploy` *before* the `sed`
  that changes `DATABASE_URL` from `dev.db` to `tubeca.db`, so migrations land in
  `prisma/dev.db` and the service starts against an empty `tubeca.db`. Errors are hidden by
  `2>/dev/null || true`. It self-heals on the first `post_upgrade`.
- **`serve` on 8080 cannot reach the API.** Relative `/api` calls hit `serve`, which returns
  `index.html`. Without nginx the documented `http://localhost:8080` entry point is broken.
- **Two divergent unit definitions.** `systemd/*.service` (plain `node`, `npx serve`,
  `/opt/tubeca/data`, `.env` in `/opt`) vs. the heredocs in `PKGBUILD` (`tsx`, local `serve`,
  `/var/lib/tubeca`, `/etc/tubeca`). Only the PKGBUILD versions received the Dec-2025 fixes;
  the `systemd/` copies and `install.sh` will fail to start the backend.
- **`pnpm start` / `node dist/index.js` do not work** because of extensionless ESM imports.
- **Node version floor is inconsistent**: `nodejs>=18` in `PKGBUILD` and `systemd/README.md`,
  `>=22` in `package.json`, `.nvmrc` and the Prisma 7 notes.
- **Package bloat**: the full root `node_modules` including all devDependencies is shipped;
  `pnpm add serve/tsx` mutates manifests and the lockfile inside the build.
- **Arch-only, local-source packaging**: `source=git+file://${startdir}` only packages committed
  HEAD; there are no tags, so versions are non-monotonic across branches.
- **Backend `UV_THREADPOOL_SIZE` fix is not applied in production** (unit lacks the env var).
- **No CI, no Docker, no backups, no upgrade notes**: `INSTALL.md` says "the package automatically
  runs database migrations on upgrade" but nothing snapshots `tubeca.db` first.
- **Database lives under `/opt/tubeca/backend/prisma`**, mixed with code, and `post_remove`
  leaves it there while `pacman -R` deletes the surrounding tree's ownership context.
- `DATA_DIR` written by `systemd/install.sh` is unused by the backend; `LICENSE` referenced by
  the PKGBUILD does not exist.

## Opportunities

- **Fix `post_install` ordering** — move the `sed` on `DATABASE_URL`/`NODE_ENV` above the
  migration step and stop swallowing Prisma errors. (S)
- **Serve the SPA from the backend** (`express.static(frontend/ui/dist)` + SPA fallback) and drop
  `tubeca-frontend.service` and `serve`; one process, one port, works without nginx. (M)
- **Emit runnable ESM from `tsc`** (add `.js` extensions or switch to `moduleResolution:
  node16`/`bundler` with a bundler like `tsup`) so `node dist/index.js` works and `tsx` leaves the
  runtime dependency list. (M)
- **Single source of truth for units**: generate `systemd/*.service` from the same text the
  PKGBUILD installs (or `install -Dm644 systemd/...` in `package()` with `sed` for paths) so the
  non-Arch path stops drifting. (S)
- **Prune the package**: `pnpm install --prod` after build, or `pnpm deploy --prod` into a
  staging dir, instead of copying the dev `node_modules`. (M)
- **Add `UV_THREADPOOL_SIZE=24` (or the `start` script) to the backend unit** so the 4abe949 fix
  reaches deployments. (S)
- **Align the Node floor** to 22 in `PKGBUILD depends`, `systemd/install.sh` and docs. (S)
- **Tag releases** (`v1.0.0`) so `pkgver()` and `pkgrel` are meaningful, and enable the commented
  GitHub tarball `source=` line. (S)
- **Add a CI workflow** running `pnpm lint`, `typecheck`, `test` and a dry `pnpm build`; the
  pre-commit hook is currently the only gate and is bypassable. (S)
- **Provide a Dockerfile / compose** (backend + redis + optional nginx) as the cross-distro path
  instead of the root-run `install.sh`. (M)
- **Move the SQLite file to `/var/lib/tubeca`** and add a pre-upgrade `sqlite3 .backup` in
  `post_upgrade`, plus a documented restore procedure. (S)
- **Remove the stray root `dist/`** and consider a `pnpm clean` that also removes it. (S)
- **Add a `/health` endpoint** and use it in the unit (`ExecStartPost` or a watchdog) so systemd
  restarts on Redis/Prisma failure rather than only on process exit. (M)
