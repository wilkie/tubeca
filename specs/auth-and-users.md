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
- **Mockable for tests.** `AuthService` is a class with no side effects beyond Prisma, which is why it was the first thing to get backend unit tests (`938e477`).

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
(`authService.ts`). The secret comes from `resolveJwtSecret()`: a missing, blank or
`.env.example`-placeholder `JWT_SECRET` is fatal when `NODE_ENV=production` and falls back to a
fixed development secret (with a console warning) otherwise. Passwords are hashed with bcrypt at
10 salt rounds; the same constant is duplicated in `routes/users.ts:7` which calls `bcrypt` directly
rather than going through `AuthService`.

`authenticate` (`middleware/auth.ts:16-30`) requires a `Bearer ` prefix, verifies the signature and
expiry, and stores the decoded payload on `req.user`. There is no database lookup on each request:
role, name and existence are trusted from the token. Consequently changing a user's role, or
deleting the user, has no effect on already-issued tokens until they expire (up to 24h).

Beyond the signature, `authenticate` checks that the token is still *current*: every `User`
carries a `tokenVersion`, tokens embed the version they were issued with, and a token whose
version is behind the user's (or whose user no longer exists) is refused with "Session is no
longer valid". `bumpTokenVersion` is called when a password or a role changes, so those take
effect immediately rather than after the 24-hour expiry; deleting a user has the same effect
because the row is gone. Tokens minted before versioning existed carry no claim and count as
version 0, so the change did not sign everyone out. To keep this off the hot path (HLS pulls a
segment every few seconds) versions are cached per process for 15 seconds and the entry is
dropped on a bump; the query-token middlewares apply the same check.

Image and stream URLs cannot set a header, so they carry a token in the query string. Since
2026-09-03 that is a **media-scoped** token: `POST /api/auth/media-token` (session required)
returns a four-hour JWT carrying the same identity and `tokenVersion` but `scope: 'media'`.
`authenticate` refuses a scoped token outright, so a leaked media URL cannot drive the API or
mint further tokens, while `streamAuth`/`imageAuth` accept it and apply the same version check.
The frontend keeps it in `localStorage`, uses it for every media URL, refreshes it in the
background once less than an hour remains, and falls back to the session token when it has none
yet, so URLs are never unusable.

`POST /api/auth/login` and `POST /api/auth/setup` are rate limited to 20 failed attempts per IP
per 15 minutes (`express-rate-limit`, successful requests are not counted).

`PATCH /api/users/me` lets any signed-in user change their own password by supplying the current
one. It bumps the token version, ending every other session, and returns a replacement token so
the calling device stays signed in.

An Admin cannot be deleted or demoted when they are the last one, so an instance can always be
administered.

`requireRole(...allowedRoles)` (`auth.ts:39-56`) maps roles to numbers (Admin 3, Editor 2, Viewer 1)
and passes if the caller's level is >= the *minimum* of the listed roles. In practice every call
site passes a single role, so `requireRole('Editor')` means "Editor or Admin".

### Route protection map

Every router except `auth.ts` starts with `router.use(authenticate)` (or the query-token variant).
Role gates as actually applied:

- Admin: all of `/api/users` (except `/me`), all of `/api/groups`, library create/update/delete/scan-start/scan-cancel, `PUT /api/settings`, `PUT/GET /api/settings/transcoding`, `GET /api/media/scrapers/queue-status`.
- Editor: collection create/update/delete/refresh-metadata/refresh-images/identify, media delete/refresh-*, image download/delete, person refresh.
- Any authenticated user: everything else, including all reads, all streaming, all `user-collections`, `GET /api/settings`, and the scraper search endpoints.

`backend/src/index.ts` registers only `/api/health` directly on `app`; every other endpoint lives
on a router that applies `authenticate`. (Until 2026-09-03 the entry file also carried
unauthenticated legacy handlers for `/api/jobs/*`, `/api/media*` and a role-less
`PATCH /api/settings` that the settings page used; they were deleted and the settings router now
accepts `PATCH` with `requireRole('Admin')`.)

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

One rule, in `LibraryService.getAccessibleLibraries` / `canUserAccessLibrary`
(`libraryService.ts`): Admin sees all; otherwise a library is visible if it has **no groups**
(public) or shares at least one group with the user.

The answer is resolved once per request. `accessibleLibraryIdsFor(req)` in
`middleware/libraryAccess.ts` memoises it in a `WeakMap` keyed on the request object, and both
`requireLibraryAccess` and the routes that filter their own rows read it from there, so a
request that does both asks the database once rather than four times.

It is applied in three places:

- `GET /api/libraries` and `GET /api/libraries/:id` (404 rather than 403 to avoid leaking
  existence).
- `GET /api/search`, which scopes both collection and media queries to
  `getAccessibleLibraries(...)` ids for non-admins (since 2026-09-03; before that it had its own
  inline rule that treated group-less libraries as invisible to users with no groups).
- `requireLibraryAccess(resolver)` in `backend/src/middleware/libraryAccess.ts`, applied to every
  entity-addressed route on the collections, media, images and stream routers (since
  2026-09-03). The resolver maps the request to a `LibraryResolution`: `library` (check groups),
  `unscoped` (person/credit artwork; allowed), `orphan` (media with no collection; hidden from
  non-admins) or `missing` (fall through so the handler returns its own 404). Resolvers exist for
  a collection, media or image id in the path, a `libraryId` in the path, and a
  `collectionId`/`mediaId`/`libraryId` in a JSON body (used by `POST /collections` and
  `POST /images/download`). Denials are 404s. Admins skip the lookup entirely.

List endpoints that embed content from many libraries use the same rule as a query scope
instead of the middleware: `resolveAccessibleLibraryIds(req.user)` (in `libraryAccess.ts`)
returns the caller's library ids (or `undefined` for admins), `PersonService.getPersonById`
applies it as a `where` on show, film and episode credits, and the user-collection detail,
favorites, watch-later and queue routes pass their result through
`filterItemsByLibraryAccess`, which drops items whose collection or media sits in another
library (and orphaned media) and corrects `_count.items`. Nested user-collection items are kept.

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

- 2026-09-03 Accessible-library ids resolved once per request (`accessibleLibraryIdsFor`), replacing a per-check `canUserAccessLibrary` query in the middleware.
- `4946f1d` 2025-11-28 Initial commit: `User` model with email, legacy `app.*` routes in `index.ts` that still exist without auth.
- `5282cf0` 2025-11-28 Adds libraries, i18n, collections, library scan: introduces `AuthService`, `authenticate`/`requireRole`, `/api/auth` routes, `AuthContext`, `ProtectedRoute`, `LoginPage`, `SetupPage`; migrations `add_user_auth_and_roles`, `add_user_groups`, `remove_user_email` all land the same day.
- `dd02263` 2025-11-28 Basic media streaming: first `?token=` stream URL helper in the client.
- `b3fb3ee` 2025-11-29 Image scraping and rendering: `imageAuth` query-token middleware and `getImageUrl`.
- `41cf2f0`/`3404584` 2025-11-29/30 Scrapers and metadata refresh: `requireRole('Editor')` applied to mutation routes.
- `d7d4c32` 2025-12-01 Lint/semicolons, API docs: OpenAPI annotations added to auth/user routes.
- `24d1114` 2025-12-01 Adds CLAUDE.md and User admin page and routes: `routes/groups.ts`, `UsersPage`, `UserDialog`, `/users/:id/role` and `/users/:id/groups`.
- `5c31c21`, `710e51f`, `d37f069` 2025-12-01 LoginPage/SetupPage/UsersPage/UserDialog tests.
- `938e477` 2025-12-02 Backend Jest infrastructure with `authService.test.ts`.
- `fc8e567` 2025-12-03 Search page; `8143c03` 2025-12-10 Library group access control: `getAccessibleLibraries`, `canUserAccessLibrary`, and the separate filter in `search.ts`.
- `d71d4e5` 2025-12-05 HLS streaming: `streamAuth` extended to whole stream router; HLS URL helpers with token.
- No auth-specific commits since 2025-12-10.
- 2026-09-03 Stop-the-bleeding batch: `resolveJwtSecret()` refuses placeholder/missing secrets in production (with tests); legacy unauthenticated handlers removed from `index.ts`; `PATCH /api/settings` added to the router behind `requireRole('Admin')`.
- 2026-09-03 Middleware tests (`middleware/__tests__/auth.test.ts`), `libraryService` group-access tests and `/api/libraries` route tests added.
- 2026-09-03 `requireLibraryAccess` middleware added and applied to collections, media, images and stream routes; search now uses `LibraryService` for its scope.
- 2026-09-03 Person filmographies and user-collection items scoped to accessible libraries (`resolveAccessibleLibraryIds`, `filterItemsByLibraryAccess`).
- 2026-09-03 Session invalidation (`User.tokenVersion`, migration `20260903180000_user_token_version`), last-admin guards, self-service `PATCH /api/users/me`, login rate limiting, and central 401 handling in the frontend client.
- 2026-09-03 Media-scoped tokens (`POST /api/auth/media-token`, four hours, `scope: 'media'`) for image and stream URLs; `authenticate` refuses them.
- 2026-09-05 `Group.canEdit` (migration `20260905140000_group_can_edit`): a group can grant sight of its libraries without the right to change them. `requireLibraryAccess(..., { edit: true })` on all sixteen Editor-gated content routes; a switch in the group editor. Defaults true, so nothing changes until an admin turns it off.

### Editing is a capability of the group, not of the role

`Role` says whether a user edits *anywhere*; `Group.canEdit` says whether it is *here*. A group
grants access to its libraries, and the flag decides whether that grant includes changing them, so
an Editor can have the run of one library and a read-only view of another — which the role ladder
alone cannot express.

`requireLibraryAccess(resolver, { edit: true })` carries it, on all sixteen routes behind
`requireRole('Editor')` that address library content. The check runs after the access check and
answers 403 rather than 404: the caller can see the thing, so hiding its existence would only
confuse. `LibraryService.getEditableLibraryIds` is the query, memoised per request in
`editableLibraryIdsFor` beside the access list.

Three deliberate edges. A user in several groups gets the union, so one group granting edit is
enough. A library with no groups is public — visible to everyone, and since nothing scopes it,
editable by any Editor. And `canEdit` defaults to true, so an existing install behaves exactly as
it did until an admin turns a group down.

## Known Limitations

- Outside production a missing `JWT_SECRET` still falls back to a public constant; a `NODE_ENV` left at `development` on a real deployment would sign forgeable tokens.
- Tokens still travel in URLs (`?token=`), so they reach server logs, browser history and any shared link; the media-scoped token limits what a leaked one can do and expires in four hours, but a cookie would keep them out of URLs entirely. A media token is not revocable on its own: it dies with its expiry or when the user's token version is bumped.

- The accessible-library list is resolved once per request but not cached beyond it, so a client polling an endpoint pays for it on every call; group membership changes therefore take effect on the next request, which is the intended trade. `GET /api/user-collections/public` still exposes public collections' item counts (not titles).
- No account lockout and no password complexity rules beyond an eight-character minimum on self-service changes; `cors()` is wide open (`index.ts:36`). The rate limiter counts per IP in memory, so it resets on restart and is per-process.
- Setup race: `createInitialAdmin` does count-then-create without a transaction or unique constraint on "first admin".

- `UserDialog` edits are three non-atomic requests; a failure midway leaves the user partly updated with no rollback or retry.
- `requireRole` accepts a list but always resolves to the minimum level, so exact-role restrictions (e.g. "Editor but not Admin") are impossible; the API shape is misleading.

- A person's artwork is outside the scheme: `POST /api/persons/:id/refresh` is Editor-gated, but a
  person belongs to no library, so there is nothing to scope the edit check by and any Editor can
  refresh any person.
- Frontend admin routes are registered for all roles; unauthorised users see empty pages with 403 errors instead of a redirect.
- Tests cover hashing, JWT, `resolveJwtSecret`, `authenticate`/`requireRole` and session invalidation (supertest), the last-admin guards, self-service password change, `getAccessibleLibraries`/`canUserAccessLibrary` and the `/api/libraries` group filter; `groups.ts` (admin-only enforcement, duplicate names, and the visibility consequence of deleting the last group on a library); `users.ts`; the search group filter; and `streamAuth`'s `?token=` path in `stream.test.ts`. `imageAuth`'s query-token path is the one left. Frontend tests exist for `AuthContext`, `ProtectedRoute`, the pages and `apiClient` URL helpers.

## Opportunities


- **Atomic user update** (S): fold role and groupIds into `PATCH /api/users/:id` so `UserDialog` makes one request; keep the two sub-routes for compatibility.
- **Route `AuthService` through `users.ts`** (S): drop the duplicated `bcrypt`/`SALT_ROUNDS` and use `authService.hashPassword`.

- **Role-aware frontend routing** (S): an `AdminRoute` wrapper (or `requiredRole` prop on `ProtectedRoute`) so Viewers are redirected rather than shown broken admin pages.
- **Remaining auth tests** (S): `imageAuth`'s query-token path specifically — `streamAuth` is covered by `stream.test.ts`, and the users and groups routers and the search group filter all have their own files now.
