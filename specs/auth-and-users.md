# Authentication, Users & Access Control

> Tubeca is a single-instance, self-hosted server for one household or small group, so this part
> exists to (a) stop anonymous clients from reaching the API and media files, (b) let an admin
> create a handful of named accounts, and (c) hide specific libraries from specific people via
> groups. It is a stateless JWT scheme with bcrypt passwords, a three-tier role hierarchy
> (Admin > Editor > Viewer), and a Group join table linking users to libraries. It was written
> in the first two days of the project and has barely changed since, apart from the group-based
> library filtering added in December 2025.

## Responsibilities

- First-run bootstrap: report whether any user exists and allow a single unauthenticated call to create the first Admin.
- Username/password login returning a signed JWT plus a sanitised user object.
- Verify bearer tokens on every non-auth route and attach `{ userId, name, role }` to `req.user`.
- Enforce role minimums per route via `requireRole()` (hierarchical, not exact-match).
- Accept the token as a `?token=` query parameter on image and stream endpoints so `<img>`/`<video>` elements can load protected files.
- Admin CRUD for users (name, password, role, group membership) and for groups (name only).
- Compute which libraries a non-admin can see from group membership, and filter library listing, library detail and global search accordingly.
- Frontend: persist the token in `localStorage`, bootstrap session state on load, redirect unauthenticated/unset-up visitors, and hide admin/editor UI from lower roles.

## Goals

- **Zero-config for the common case.** No email, no verification, no password policy; setup is a single form. The `User.email` column was dropped in the third migration (`20251128073005_remove_user_email`), which shows the intent to keep accounts minimal.
- **Stateless server.** Tokens are self-contained; nothing is stored per session, so there is no logout endpoint, revocation list or refresh flow.
- **Work with plain browser media elements.** The query-string token is a deliberate trade-off so HLS playlists, sprite sheets and posters can be plain URLs.
- **Coarse but predictable authorization.** Roles are a strict ladder; group access is library-granularity only and "no groups = public". The code optimises for being easy to reason about rather than fine-grained.
- **Mockable for tests.** `AuthService` is a class with no side effects beyond Prisma, which is why it was the first thing to get backend unit tests (`583e5d7`).

## Components

| File | Role |
|------|------|
| `backend/src/services/authService.ts` | bcrypt hash/verify, JWT sign/verify (24h), `needsSetup`, `createInitialAdmin`, `login` |
| `backend/src/middleware/auth.ts` | `authenticate` (Bearer header) and `requireRole(...roles)` (hierarchy check); augments `Express.Request` with `user?: TokenPayload` |
| `backend/src/routes/auth.ts` | `POST /api/auth/login`, `GET/POST /api/auth/setup` (all unauthenticated) |
| `backend/src/routes/users.ts` | `GET /me` (any user); list/create/patch/delete, `PATCH :id/role`, `PATCH :id/groups` (Admin) |
| `backend/src/routes/groups.ts` | Admin CRUD of `Group` with `_count` of users/libraries |
| `backend/src/routes/stream.ts:18-36`, `backend/src/routes/images.ts:15-31` | `streamAuth` / `imageAuth`: try `req.query.token`, fall back to `authenticate` |
| `backend/src/services/libraryService.ts:45-137` | `getAccessibleLibraries`, `canUserAccessLibrary` (group filtering) |
| `backend/src/routes/search.ts:93-118` | Independent (and inconsistent) group filter for search |
| `backend/prisma/schema.prisma:12-30,100-104` | `User`, `Group`, `enum Role`; implicit join tables `_GroupToUser`, `_GroupToLibrary` |
| `backend/src/services/__tests__/authService.test.ts` | Unit tests for hashing and JWT |
| `frontend/ui/src/api/client.ts:221-257` | Token storage (`localStorage['token']`), Bearer injection, `getImageUrl`/`get*StreamUrl` embedding `?token=` |
| `frontend/ui/src/context/AuthContext.tsx` | `AuthProvider`/`useAuth`: bootstraps setup + session, exposes `login`, `setup`, `logout` |
| `frontend/ui/src/components/ProtectedRoute.tsx` | Spinner while loading; redirects to `/setup` or `/login` |
| `frontend/ui/src/pages/LoginPage.tsx`, `SetupPage.tsx` | Near-identical single-form pages |
| `frontend/ui/src/pages/UsersPage.tsx`, `components/UserDialog.tsx` | Admin UI: Users tab and Groups tab; create/edit dialog with role select and group multi-select |
| `frontend/ui/src/main.tsx` | Public `/login` and `/setup` routes; everything else wrapped in `ProtectedRoute` |
| `packages/shared-types/src/index.ts:10-60` | `UserRole`, `User`, `UserGroup`, `Group`, `LoginResponse`, `Create/UpdateUserInput` |

## How It Works

### Token format and verification

`AuthService.generateToken` signs `{ userId, name, role }` with `JWT_SECRET` and `expiresIn: '24h'`
(`authService.ts:24-26`). The secret falls back to the literal `'dev-secret-change-in-production'`
when the env var is absent; nothing warns or refuses to start. Passwords are hashed with bcrypt at
10 salt rounds; the same constant is duplicated in `routes/users.ts:7` which calls `bcrypt` directly
rather than going through `AuthService`.

`authenticate` (`middleware/auth.ts:16-30`) requires a `Bearer ` prefix, verifies the signature and
expiry, and stores the decoded payload on `req.user`. There is no database lookup on each request:
role, name and existence are trusted from the token. Consequently changing a user's role, or
deleting the user, has no effect on already-issued tokens until they expire (up to 24h).

`requireRole(...allowedRoles)` (`auth.ts:39-56`) maps roles to numbers (Admin 3, Editor 2, Viewer 1)
and passes if the caller's level is >= the *minimum* of the listed roles. In practice every call
site passes a single role, so `requireRole('Editor')` means "Editor or Admin".

### Route protection map

Every router except `auth.ts` starts with `router.use(authenticate)` (or the query-token variant).
Role gates as actually applied:

- Admin: all of `/api/users` (except `/me`), all of `/api/groups`, library create/update/delete/scan-start/scan-cancel, `PUT /api/settings`, `PUT/GET /api/settings/transcoding`, `GET /api/media/scrapers/queue-status`.
- Editor: collection create/update/delete/refresh-metadata/refresh-images/identify, media delete/refresh-*, image download/delete, person refresh.
- Any authenticated user: everything else, including all reads, all streaming, all `user-collections`, `GET /api/settings`, and the scraper search endpoints.

Legacy handlers registered directly on `app` in `backend/src/index.ts` (from the initial commit)
are *not* covered by any middleware: `POST /api/jobs/transcode`, `/api/jobs/thumbnail`,
`/api/jobs/analyze` (`index.ts:515-640`) require no token at all and accept caller-supplied
`inputPath`/`outputPath`. `POST /api/media/video`, `POST /api/media/audio` and
`PATCH /api/settings` (`index.ts:316-460`) sit behind the mounted routers' `authenticate` (the
router runs first and 401s anonymous callers) but have no role check, so a Viewer can create media
rows or rename the instance. The frontend's `SettingsPage` actually uses the legacy
`PATCH /api/settings` (`client.ts:319`), not the Admin-gated `PUT`.

### Query-string tokens for media elements

`client.ts:415-505` builds URLs of the form `/api/images/:id/file?token=<jwt>`,
`/api/stream/video/:id?token=…`, `/api/stream/hls/:id/master.m3u8?token=…`,
`/api/stream/trickplay/:id/:w/:i?token=…`, and subtitle URLs. On the server `imageAuth` is applied
only to `GET /api/images/:id/file` (`images.ts:71`); all other image routes use the header form.
`streamAuth` is applied to the whole stream router (`stream.ts:36`). Both try the query token first
and, if it fails to verify, silently fall back to the header path (so a stale query token with a
fresh header still works). The HLS variant/segment playlists generated by `HlsService` must carry
the token through to every segment URL; see [Streaming & Transcoding](streaming-and-transcoding.md).

### First-run setup

1. `AuthProvider` mounts and calls `GET /api/auth/setup` (`AuthContext.tsx:35`).
2. If `needsSetup` (user count is 0), state is set and `ProtectedRoute` redirects to `/setup`.
3. `SetupPage` posts name/password to `POST /api/auth/setup`. `createInitialAdmin` re-checks the
   count (not transactionally) and creates an `Admin`, returning the same `{ user, token }` shape as
   login; the client stores the token and `setup()` flips `needsSetup` to false.
4. Once any user exists the endpoint returns 400 "Setup has already been completed".

### Login and session bootstrap

1. `LoginPage` calls `useAuth().login` → `apiClient.login` → `POST /api/auth/login`. On success the
   token is written to `localStorage['token']` and `user` is set in context. Errors from the server
   (a single generic "Invalid username or password" for both unknown user and bad password) are
   shown in an `Alert`.
2. On a later page load, `AuthProvider` checks setup, then if `hasToken()` calls `GET /api/users/me`.
   Any error (expired token, network) clears the token and leaves the user logged out.
3. `logout()` is purely client-side: remove the token, null the user, navigate to `/login`
   (`Header.tsx:52-56`).
4. There is no global 401 handler in `ApiClient.request`; an expiry mid-session just makes each
   request return `{ error }` until the user reloads or logs out manually. Media element URLs keep
   the token they were built with, so a `<video>` that outlives the token stops loading segments.

### Users and groups admin

`UsersPage` (Admin route `/admin/users`, listed in the sidebar only when `user.role === 'Admin'`)
loads users and groups in parallel and renders two tabs. `UserDialog` in edit mode issues up to
three sequential requests, `PATCH /users/:id` (name/password), `PATCH /users/:id/role`, and
`PATCH /users/:id/groups`, stopping at the first error, so a partial update is possible. Role and
group updates are always sent even when unchanged. The self-delete guard is server-side
(`users.ts:232`); there is no guard against demoting yourself or the last Admin.

`Group` has only a unique `name`. The Prisma implicit many-to-many tables `_GroupToUser` and
`_GroupToLibrary` cascade on delete, so deleting a group silently drops memberships and library
assignments. Group creation/rename/delete lives on `UsersPage` in an inline dialog rather than a
separate component. Library-to-group assignment is done from the library dialog, not here (see
[Libraries & Scanning](libraries-and-scanning.md)).

### Library visibility by group

Two different rules exist:

- `LibraryService.getAccessibleLibraries` / `canUserAccessLibrary` (`libraryService.ts:45-137`):
  Admin sees all; otherwise a library is visible if it has **no groups** (public) or shares at least
  one group with the user. Used by `GET /api/libraries` and `GET /api/libraries/:id` (which returns
  404 rather than 403 to avoid leaking existence).
- `GET /api/search` (`search.ts:93-118`) recomputes access inline: non-admins get only libraries
  reachable through their groups and, if they belong to no group, an empty result. Public
  (group-less) libraries are therefore searchable by group members but invisible in search to users
  with no groups, contradicting the service rule.

Nothing else consults either rule. `GET /api/collections/library/:libraryId`,
`GET /api/collections/:id`, `GET /api/media/:id`, every `/api/stream/*` route, every
`/api/images/*` route, `/api/persons/*` and the user-collections endpoints all serve content from
any library to any authenticated user. Group access therefore controls navigation, not data.

### Frontend role gating

Purely cosmetic: `CollectionPage`, `MediaPage`, `PersonPage` compute
`canEdit = role === 'Admin' || role === 'Editor'` to hide menu items; `Sidebar` hides the
Administration section from non-admins. The `/settings`, `/admin/libraries` and `/admin/users`
routes are registered for everyone (`App.tsx:34-36`); a Viewer navigating there gets a page whose
API calls return 403.

## Interactions

- **Depends on:** Prisma `User`/`Group` models ([Content Model](content-model.md) for the rest of the schema); `JWT_SECRET` from `backend/.env` ([Configuration](configuration.md)); `LibraryService` for group filtering ([Libraries & Scanning](libraries-and-scanning.md)).
- **Used by:** every other backend router imports `authenticate`/`requireRole` ([Streaming & Transcoding](streaming-and-transcoding.md) and [Images](images.md) additionally wrap it in query-token middleware; [Search](search.md) reads `req.user` for filtering; [User Collections](user-collections.md) keys all data on `req.user.userId`). The frontend shell ([Frontend App](frontend-app.md)) mounts `AuthProvider` above the router, and [Playback](playback.md) relies on `getHlsMasterPlaylistUrl`/`getTrickplaySpriteUrl` embedding the token. `apiClient` is the single choke point for the Bearer header. [Deployment](deployment.md) is where the secret must be provisioned.
- **Shared data:** reads/writes `User`, `Group`, `_GroupToUser`, `_GroupToLibrary`; reads `Library.groups`; `UserCollection.userId` references `User` (owned by [User Collections](user-collections.md)). No queues. Config keys: `JWT_SECRET` (env only; not in `tubeca.config.json`).

## History

- `4946f1d` 2025-11-28 Initial commit: `User` model with email, legacy `app.*` routes in `index.ts` that still exist without auth.
- `5282cf0` 2025-11-28 Adds libraries, i18n, collections, library scan: introduces `AuthService`, `authenticate`/`requireRole`, `/api/auth` routes, `AuthContext`, `ProtectedRoute`, `LoginPage`, `SetupPage`; migrations `add_user_auth_and_roles`, `add_user_groups`, `remove_user_email` all land the same day.
- `dd02263` 2025-11-28 Basic media streaming: first `?token=` stream URL helper in the client.
- `bf45a3c` 2025-11-29 Image scraping and rendering: `imageAuth` query-token middleware and `getImageUrl`.
- `fe77ae6`/`9600bde` 2025-11-29/30 Scrapers and metadata refresh: `requireRole('Editor')` applied to mutation routes.
- `bb82089` 2025-12-01 Lint/semicolons, API docs: OpenAPI annotations added to auth/user routes.
- `873077f` 2025-12-01 Adds CLAUDE.md and User admin page and routes: `routes/groups.ts`, `UsersPage`, `UserDialog`, `/users/:id/role` and `/users/:id/groups`.
- `b891e80`, `5cccfaf`, `3ef372e` 2025-12-01 LoginPage/SetupPage/UsersPage/UserDialog tests.
- `583e5d7` 2025-12-02 Backend Jest infrastructure with `authService.test.ts`.
- `312e7c4` 2025-12-03 Search page; `d02715b` 2025-12-10 Library group access control: `getAccessibleLibraries`, `canUserAccessLibrary`, and the separate filter in `search.ts`.
- `6888f86` 2025-12-05 HLS streaming: `streamAuth` extended to whole stream router; HLS URL helpers with token.
- No auth-specific commits since 2025-12-10.

## Known Limitations

- `JWT_SECRET` defaults to a hard-coded string when unset (`authService.ts:6`); a deployment that forgets the env var mints tokens anyone can forge.
- Tokens are bearer secrets placed in URLs (`?token=`), so they end up in server logs, browser history, referrer headers and any shared link. The same 24h token is used for both API and media URLs; there is no short-lived, scoped media token.
- No revocation: role changes, password changes and user deletion do not invalidate existing tokens (`authenticate` never hits the DB). No refresh, so users are logged out every 24h regardless of activity.
- `POST /api/jobs/transcode|thumbnail|analyze` are entirely unauthenticated and take arbitrary filesystem paths (`index.ts:515-640`). `POST /api/media/video|audio` and `PATCH /api/settings` have no role check.
- Group access is only enforced on `/api/libraries` and `/api/search`; collections, media, images, streams and persons are reachable by ID regardless of library membership. Search additionally disagrees with `LibraryService` about whether group-less libraries are public.
- No rate limiting, lockout, or password requirements on `/api/auth/login` or `/api/auth/setup`; `cors()` is wide open (`index.ts:36`).
- Setup race: `createInitialAdmin` does count-then-create without a transaction or unique constraint on "first admin".
- Admin can demote or delete the last Admin (only self-delete is blocked), and can lock themselves out by demoting themselves.
- `UserDialog` edits are three non-atomic requests; a failure midway leaves the user partly updated with no rollback or retry.
- `requireRole` accepts a list but always resolves to the minimum level, so exact-role restrictions (e.g. "Editor but not Admin") are impossible; the API shape is misleading.
- No password-change or profile endpoint for non-admins; a Viewer cannot change their own password.
- Frontend admin routes are registered for all roles; unauthorised users see empty pages with 403 errors instead of a redirect.
- `authService.test.ts` covers hashing and JWT only; there are no tests for `authenticate`, `requireRole`, the query-token middlewares, `users.ts`, `groups.ts`, `getAccessibleLibraries`, or the search filter. Frontend tests exist for `AuthContext`, `ProtectedRoute`, the pages and `apiClient` URL helpers.

## Opportunities

- **Refuse to start without `JWT_SECRET` in production** (S): one check in `authService.ts`/`index.ts`; removes the single worst default.
- **Authenticate and Admin-gate the legacy `app.*` handlers in `index.ts`, or delete them** (S): the routers already cover `/api/media` and `/api/settings`; the `/api/jobs/*` endpoints are unused by the frontend.
- **Move the search access rule onto `LibraryService`** (S): call `getAccessibleLibraries` from `search.ts` so "public library" means the same thing everywhere.
- **Enforce library access on collection/media/image/stream reads** (M): resolve `libraryId` for the requested entity (collections carry it directly; media via collection) and call `canUserAccessLibrary`; cache the user's group IDs per request to avoid the extra queries.
- **Short-lived, media-scoped tokens for query-string URLs** (M): sign a separate `{ userId, scope: 'media' }` token with a short TTL from a dedicated endpoint, so leaked URLs cannot drive the admin API; would also let the 24h API token move to an `httpOnly` cookie.
- **Token freshness / revocation** (M): add `tokenVersion` (or `updatedAt` check) on `User` and verify it in `authenticate`; bumps on password/role change and deletion. Requires one DB read per request, or a small in-memory cache.
- **Global 401 handling in `ApiClient`** (S): on 401, clear the token and route to `/login` instead of surfacing per-call errors; also refresh media URLs after re-login.
- **Self-service password change** (S): `PATCH /api/users/me` with current-password verification; the dialog already knows how to send `password`.
- **Last-admin guard** (S): reject role change/delete that would leave zero Admins.
- **Atomic user update** (S): fold role and groupIds into `PATCH /api/users/:id` so `UserDialog` makes one request; keep the two sub-routes for compatibility.
- **Route `AuthService` through `users.ts`** (S): drop the duplicated `bcrypt`/`SALT_ROUNDS` and use `authService.hashPassword`.
- **Login rate limiting** (S): `express-rate-limit` on `/api/auth/*`; a self-hosted box exposed via reverse proxy is the target deployment.
- **Role-aware frontend routing** (S): an `AdminRoute` wrapper (or `requiredRole` prop on `ProtectedRoute`) so Viewers are redirected rather than shown broken admin pages.
- **Middleware and route tests** (M): supertest coverage for `authenticate`, `requireRole`, `streamAuth`/`imageAuth`, and the group filter in both `LibraryService` and search; these are the behaviours most likely to regress silently.
- **Per-library permissions on groups** (L): `Group` currently carries no capabilities; a natural extension is a per-group edit flag so Editors can be restricted to specific libraries, which the current role ladder cannot express.
