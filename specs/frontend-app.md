# Frontend Application Shell & Library Browsing

> The React single-page application in `frontend/ui/` is the only user interface to Tubeca. This
> part covers the shell (entry point, routing, theme, contexts, header/sidebar), the hand-rolled
> `apiClient` singleton that every page talks through, and the browsing surfaces: library grids
> with infinite scroll, sorting, filtering, multi-select and list view; collection, media and
> person detail pages with full-bleed hero backdrops; and the admin Settings page. It exists so
> that a browser on the LAN is the whole client: no native app, no server-rendered HTML.

## Responsibilities

- Boot the app: mount React, install the MUI dark theme, i18n, `BrowserRouter`, and the provider
  stack (`AuthProvider` > `ProtectedRoute` > `ScrollRestorationProvider` > `PlayerProvider` >
  `App` > `ActiveLibraryProvider`).
- Route URLs to pages (`/library/:id`, `/collection/:id`, `/media/:id`, `/person/:id`,
  `/search`, `/settings`, `/admin/*`, user-collection routes) behind an auth gate.
- Wrap every backend endpoint in a typed method on `apiClient`, attach the JWT from
  `localStorage`, and normalise responses to `{ data } | { error }`.
- Render the persistent chrome: a 48px sticky `Header` with library tabs, and a temporary
  `Sidebar` drawer with library, collection and admin navigation.
- Track which library the user is "in" from the URL so the header tab stays highlighted on
  collection and media pages (`ActiveLibraryContext`).
- Browse a library: paginated poster grid or list, sort by five fields, filter by content
  rating and keywords, type-to-filter quick search, hover rating badges, multi-select for batch
  add-to-collection, infinite scroll, and back-button scroll/state restoration.
- Show collection detail with a type-specific view (Film hero, Show hero, or standard grid),
  breadcrumbs that stick under the header, and an options menu (images, identify, refresh,
  delete).
- Show media, person and admin settings pages with the same fetch-on-mount pattern.
- Provide a Jest/RTL test harness (`test-utils.tsx`, `jest.setup.ts`) and a Vite dev proxy so
  the SPA can be developed against the backend on another port.

## Goals

- **One screen per URL, every URL reachable by refresh.** Everything is a client route; the
  server never renders UI. Deep links to collections and media work because pages load their own
  data from the id in the URL.
- **Desktop-first "10-foot" feel.** Full-viewport fixed backdrops behind film and show detail
  (`HeroSection`), poster grids, hover overlays, keyboard type-to-filter. The commit history
  (Dec 2025) is almost entirely about making browsing feel like a media centre, not a CRUD app.
- **Never lose the user's place.** Infinite scroll (fb42fb2) was followed within two weeks by a
  scroll-restoration cache (872e263) because the back button reset the grid; filter changes keep
  the old grid visible under an overlay rather than blanking it.
- **Minimal dependencies.** No data-fetching library, no state manager, no router loaders; just
  `fetch`, `useState`/`useEffect`, and MUI. The API client is a single class so that the whole
  surface of the backend is greppable in one file.
- **Tests that fail loudly.** `jest.setup.ts` turns any `console.error` into a thrown error, so
  React `act()` warnings and prop-type problems break the build rather than scrolling by.
- **Strict lint as a design constraint.** `react-hooks` rules (including the newer
  `set-state-in-effect`) shape how pages are written; the CLAUDE.md patterns exist to satisfy them.

## Components

| File | Role |
|------|------|
| `frontend/ui/src/main.tsx` | Entry point; provider stack, public routes (`/login`, `/setup`), wraps `/*` in `ProtectedRoute` |
| `frontend/ui/src/App.tsx` | Authenticated shell: `Header`, `Sidebar`, `NavigationLoadingOverlay`, 18 routes (63 lines) |
| `frontend/ui/src/theme.ts` | MUI dark theme, primary `#646cff`, chip radius override (22 lines) |
| `frontend/ui/src/index.scss` | Root font stack, `#root` flex column, 320px min width (27 lines) |
| `frontend/ui/index.html` | Loads the "Praise" display font from Google Fonts for the wordmark |
| `frontend/ui/src/api/client.ts` | `ApiClient` class, 74 public methods, `apiClient` singleton (803 lines) |
| `frontend/ui/src/context/AuthContext.tsx` | Setup check, token validation, `login`/`setup`/`logout` (see [Auth & Users](auth-and-users.md)) |
| `frontend/ui/src/context/ActiveLibraryContext.tsx` | Derives the active library id from the URL; fetches it for collection/media routes |
| `frontend/ui/src/context/ScrollRestorationContext.tsx` | Module-level page cache keyed by route; `useCachedState` / `useScrollRestoration` hooks |
| `frontend/ui/src/context/PlayerContext.tsx` | Global player + `MiniPlayer` host, 1167 lines (see [Playback](playback.md)) |
| `frontend/ui/src/components/Header.tsx` | AppBar with menu button, wordmark, library tab buttons, search/favorites/watch-later/queue icons, account menu |
| `frontend/ui/src/components/Sidebar.tsx` | Temporary `Drawer`: libraries, collections section, admin section |
| `frontend/ui/src/components/NavigationLoadingOverlay.tsx` | Full-screen spinner shown on `popstate` until the location changes |
| `frontend/ui/src/components/ProtectedRoute.tsx` | Redirects to `/setup` or `/login` based on `AuthContext` |
| `frontend/ui/src/components/HeroSection.tsx` | Fixed full-viewport backdrop + gradient; `HeroPoster`, `HeroLogo` |
| `frontend/ui/src/components/FilmHeroView.tsx` | Film detail: logo/poster, play menu, credits, extras grid (562 lines) |
| `frontend/ui/src/components/ShowHeroView.tsx` | Show detail: seasons grid with favourite state, cast (646 lines) |
| `frontend/ui/src/components/StandardCollectionView.tsx` | Season/Album/Artist/folder detail: header card, `ChildCollectionGrid`, `MediaGrid` (540 lines) |
| `frontend/ui/src/components/ChildCollectionGrid.tsx` | Poster grid of child collections with parent-image fallback |
| `frontend/ui/src/components/MediaGrid.tsx` | Episode/track grid; sorts by episode or disc/track client-side |
| `frontend/ui/src/components/MediaListItem.tsx` | Horizontal card used by list views (`MediaListItemBadge`, `MediaListItemMeta`) |
| `frontend/ui/src/components/CollectionBreadcrumbs.tsx` | Library > parent > current, with a `hero` colour variant |
| `frontend/ui/src/components/StickyHeroBreadcrumbs.tsx` | Sticky wrapper at `top: 48`; transparent until 80px scroll |
| `frontend/ui/src/components/CollectionOptionsMenu.tsx` | Images / Identify / Refresh metadata / Refresh images / Delete, gated by `canEdit` |
| `frontend/ui/src/components/ViewModeMenu.tsx` | Poster vs list toggle menu |
| `frontend/ui/src/components/CardQuickActions.tsx` | Favourite / watch-later / add-to-collection buttons; `overlay` and `inline` variants |
| `frontend/ui/src/components/SortControls.tsx`, `FilterChips.tsx`, `KeywordFilter.tsx`, `QuickSearchOverlay.tsx` | Sort/filter UI (detail in [Search](search.md)) |
| `frontend/ui/src/components/SelectionActionBar.tsx` | Bottom bar for multi-select batch actions |
| `frontend/ui/src/hooks/useQuickSearch.ts`, `useDebouncedValue.ts` | Global keydown capture for type-to-filter; 300ms debounce |
| `frontend/ui/src/pages/LibraryPage.tsx` | Library grid/list with pagination, filters, selection, restoration (1004 lines) |
| `frontend/ui/src/pages/CollectionPage.tsx` | Loads a collection, builds breadcrumbs, dispatches to a view, owns the dialogs (489 lines) |
| `frontend/ui/src/pages/MediaPage.tsx` | Single media detail: still image, stream info, credits, actions (797 lines) |
| `frontend/ui/src/pages/PersonPage.tsx` | Person bio and filmography grouped by credit type (635 lines) |
| `frontend/ui/src/pages/LibrariesPage.tsx` | Admin list of libraries with scan start/cancel/poll (408 lines) |
| `frontend/ui/src/pages/SettingsPage.tsx` | Tabs: instance name, transcoding settings (546 lines) |
| `frontend/ui/src/i18n/index.ts`, `locales/en.json` | i18next setup with browser language detector; single `en` bundle, 197 leaf keys |
| `frontend/ui/src/test-utils.tsx`, `jest.setup.ts`, `jest.config.cjs` | Custom `render` with i18n/theme/`MemoryRouter`; console.error trap; ts-jest + jsdom |
| `frontend/ui/vite.config.ts`, `eslint.config.js`, `tsconfig.json` | Dev proxy for `/api`; flat ESLint config; strict TS |

## How It Works

### Boot and routing

`main.tsx` renders `ThemeProvider` > `CssBaseline` > `BrowserRouter` > `AuthProvider`, then a
top-level `Routes` with `/login`, `/setup`, and a catch-all `/*` that is wrapped in
`ProtectedRoute`, `ScrollRestorationProvider` and `PlayerProvider` before rendering `App`.
`ProtectedRoute` shows a full-page spinner while `AuthContext` calls `checkSetup` and
`getCurrentUser`, then redirects to `/setup` or `/login` as needed.

`App.tsx` adds `ActiveLibraryProvider`, the header/sidebar chrome, and a nested `Routes` with 18
routes. All page components are statically imported; there is no `React.lazy` or `Suspense`
anywhere in `src/`, so the production bundle is a single 1.49MB `index-*.js` (plus 547 bytes of
CSS) in `frontend/ui/dist/assets/`. Note that the `/` route renders an empty `<Box />`
(`App.tsx:57`), and `LoginPage`, `SetupPage`, `CollectionPage` (after delete) and `MediaPage`
(after delete) all `navigate('/')`, so those flows land on a page that is just the header. The
`/libraries` route is retained as an alias of `/admin/libraries` for old links.

### Theme and global styles

`theme.ts` is a 22-line dark MUI theme. `index.scss` sets the font stack and makes `#root` a
flex column. `index.html` pulls the "Praise" cursive font from Google Fonts for the wordmark in
`Header`, which is the only external network dependency of the client and will be blocked on an
offline LAN.

### API client

`client.ts` is one `ApiClient` class exported as a singleton. It re-exports ~80 types from
`@tubeca/shared-types` so pages import types from `../api/client` rather than the package, and
defines the transcoding settings types locally (not in shared-types). The core is a private
`request<T>()` (`client.ts:233-268`):

1. Read the JWT from `localStorage.token`, add `Authorization: Bearer` and
   `Content-Type: application/json`.
2. `fetch('/api' + endpoint)`. If status is 204, return `{ data: undefined }` (bc1b575 fixed
   DELETE handlers crashing on `response.json()`).
3. Otherwise parse JSON; if `!response.ok` return `{ error: data.error || 'An error occurred' }`,
   else `{ data }`. A thrown fetch returns `{ error: 'Network error' }`.

Nothing throws; every caller does `if (result.error) ... else if (result.data) ...`. The two
fallback strings are hard-coded English, not i18n keys. There is no 401 interception: an expired
token simply makes every call fail with the backend's error string until the user logs out.
Seven URL-builder methods (`getImageUrl`, `getVideoStreamUrl`, `getHlsMasterPlaylistUrl`,
`getTrickplaySpriteUrl`, etc.) embed the token as a `?token=` query parameter because `<img>`,
`<video>` and hls.js cannot send headers. `getImageUrl` is called from 34 sites.

### Contexts

**ActiveLibraryContext** parses `location.pathname` with three regexes. For `/library/:id` the
id is used synchronously; for `/collection/:id` and `/media/:id` it fires a *second*
`getCollection`/`getMedia` request purely to learn the library id (the page itself fetches the
same record). `setActiveLibrary` lets `Header`/`Sidebar` pre-set the id before navigating to
avoid a tab flash.

**ScrollRestorationContext** (872e263) keeps a module-level `Map<string, {data, scrollY,
timestamp}>` with a 10-minute TTL swept every 60s. `useCachedState(key)` returns cached data only
when `useNavigationType() === 'POP'`. `useScrollRestoration(key, getState)` installs a capturing
document click listener that snapshots state whenever the user clicks an `<a>`, a
`MuiCardActionArea` or any `<button>`, then on mount retries `window.scrollTo` via
`requestAnimationFrame` up to 50 times until the document is tall enough. Only `LibraryPage` and
`SearchPage` use it. `NavigationLoadingOverlay` complements it by showing a 70% black overlay on
`popstate` and hiding it 50ms after the location changes.

### Layout chrome

`Header` fetches `getLibraries()` on mount and renders one tab button per library; the active
one gets a white underline. Favourites, watch-later and queue icons are hidden below the `md`
breakpoint; the library tabs are not, so on narrow screens they overflow. `Sidebar` re-fetches
libraries every time it opens and shows the admin section only for `role === 'Admin'`. Both are
the only responsive touches besides `Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }}` on every grid;
there are zero `useMediaQuery` or `breakpoints.down` calls in `src/`.

### Library browsing (`LibraryPage`)

The page holds 25 `useState` hooks. The flow:

1. `useCachedState('library-<id>')` seeds state on back navigation; a `restoredFromCacheRef`
   blocks the initial fetch and pauses the `IntersectionObserver` for 500ms so restoring the
   scroll position does not trigger page 2.
2. Otherwise the `libraryId` effect synchronously clears all state (with an explicit
   `eslint-disable react-hooks/set-state-in-effect`), fetches `getLibrary`, then
   `fetchCollections(1)`.
3. `fetchCollections` calls `getCollectionsByLibrary` with `page`, `limit: 50`, `sortField`,
   `sortDirection`, `excludedRatings`, `keywordIds` and the debounced quick-search `nameFilter`.
   After each page it fires `checkFavorites` and `checkWatchLater` for the new ids and merges
   them into two `Set`s, and accumulates distinct `filmDetails.contentRating` values into the
   filter chip list ordered G, PG, PG-13, R, NC-17, NR, Unrated.
4. A second effect refetches page 1 when any sort/filter/search dependency changes; the old grid
   stays visible under a translucent `CircularProgress` overlay.
5. Infinite scroll: an `IntersectionObserver` on a sentinel `div` below the grid calls
   `fetchCollections(page + 1, true)` when 10% visible and `hasMore`.
6. Keywords are lazy-loaded on first open of the filter panel (`handleToggleFilters`).
7. `viewMode` ('poster' | 'list', 4c3a261) is plain component state and resets on every visit.
   Poster cards show a hover-only overlay with content rating and `★ 7.5` (347f98f) via a CSS
   `&:hover .rating-overlay` rule. List mode uses `MediaListItem` with an inline
   `CardQuickActions`.
8. Selection mode (a27f5f8) toggles a checkbox per card, outlines selected cards, and shows
   `SelectionActionBar` for batch add-to-collection; `selectAll` selects only loaded items.
9. The play button on a card (`handlePlay`) fetches the collection, and for shows fetches the
   name-sorted first season too, then `setPlaybackQueue` and navigates to `/play/:mediaId`.

`useQuickSearch` listens to `document` keydown, ignores inputs/dialogs/menus and modifier keys,
and builds a query from printable characters; `LibraryPage` sends it server-side (debounced)
while `CollectionPage` filters the already-loaded children in memory. See [Search](search.md)
for the filter components and the search page.

### Collection, media and person detail

`CollectionPage` fetches one collection, builds a two-level breadcrumb from
`collection.library` and `collection.parent`, and dispatches (`CollectionPage.tsx:338-410`):
Film library with media → `FilmHeroView`; `Show` → `ShowHeroView`; else `StandardCollectionView`
(with `StickyHeroBreadcrumbs variant="standard"` for seasons). The page owns all dialogs
(`DeleteCollectionDialog`, `ImagesDialog`, `AddToCollectionDialog`, `IdentifyDialog`) and the
`CollectionOptionsMenu`; the views receive ~15 callback props each.

`HeroSection` (d06b185) places the backdrop `<img>` and gradient with `position: fixed` covering
the viewport, and the content scrolls over it; a 32px gradient at the bottom fades into
`background.default`. `StickyHeroBreadcrumbs` (cb615b8) uses negative margins (`mx: -3`,
`mt: -38px`) to escape the container padding and swaps from transparent/light text to
`background.paper` once `window.scrollY > 80`.

`MediaPage`, `PersonPage`, `SettingsPage`, `LibrariesPage` all follow the CLAUDE.md pattern:
`useEffect` with a `cancelled` flag, `isLoading` → `CircularProgress`, `error` → `Alert`,
`null` → "not found" `Alert`. `LibrariesPage` additionally polls `getLibraryScanStatus` while a
scan runs. The "add to most recent user collection" behaviour (fetch `getUserCollections`, take
`[0]`, `addUserCollectionItem`) is copy-pasted into `CardQuickActions`, `FilmHeroView`,
`ShowHeroView`, `StandardCollectionView` and `MediaPage`.

### i18n

`i18n/index.ts` registers one resource bundle (`en`), `fallbackLng: 'en'`, and
`i18next-browser-languagedetector` reading `localStorage` then `navigator`. `en.json` has 197
leaf keys across 21 namespaces (largest: `libraries` 31, `users` 30, `userCollections` 25). Most
newer call sites pass an inline default (`t('view.poster', 'Poster')`), so missing keys degrade
to English silently. There is no language switcher.

### Dev proxy, build, production

`vite.config.ts` proxies `/api` to `http://127.0.0.1:${PORT ?? 3000}`; 64b1e52 switched from
`localhost` to avoid IPv6 resolution stalls under WSL2, and 8d11854 made the port follow the
backend's `PORT` (passed through by `turbo.json`). `pnpm build` runs `tsc && vite build`.
The `PKGBUILD` does `pnpm add serve` in `frontend/ui`, and `tubeca-frontend.service` runs
`serve -s dist -l 8080`; because `API_BASE` is the relative `/api`, that standalone mode only
works behind the `systemd/nginx.conf.example` reverse proxy (which serves `dist/` directly and
proxies `/api` and `/api/stream/` to `:3000`). See [Deployment](deployment.md).

### Testing

`jest.config.cjs` uses ts-jest with jsdom, maps `.scss` to `identity-obj-proxy`, and matches
`**/__tests__/**/*.test.{ts,tsx}`. `jest.setup.ts` polyfills `TextEncoder` and overrides
`console.error` to throw (d8f1906). `test-utils.tsx` exports a `render` wrapped in
`I18nextProvider`, a dark `ThemeProvider` and `MemoryRouter`, plus `createMockAuthContext`,
`mockAdminUser`, `mockViewerUser`. Tests mock `../../api/client` wholesale (29 files) and often
`react-router-dom` (16 files). There are 42 test files, 15,216 lines, 854 `it()` cases (pages
357, components 379, context 49, api 47, utils 22). A coverage run from 2025-12-05 reported
74.2% statements / 63.3% branches overall: pages 81%, components 77%, api 57%, context 48%
(`PlayerContext` and `ScrollRestorationContext` drag this down), `src/` root 27% (`App.tsx`,
`main.tsx`, `theme.ts` untested). Files without tests: `CardQuickActions`, `FavoriteButton`,
`FilterChips`, `HeroSection`, `IdentifyDialog`, `MediaListItem`, `NavigationLoadingOverlay`,
`QuickSearchOverlay`, `SelectionActionBar`, `SortControls`, `SortableMediaListItem`,
`StandardCollectionView`, `StickyHeroBreadcrumbs`, `UpNextPopup`, `ViewModeMenu`, `QueuePage`,
`ScrollRestorationContext`, both hooks. A husky pre-commit hook runs `pnpm lint && pnpm
typecheck` but not the tests.

### ESLint

`eslint.config.js` (flat config) applies `@typescript-eslint` recommended,
`eslint-plugin-react` recommended, `eslint-plugin-react-hooks` v7 recommended (which includes
`set-state-in-effect` and `exhaustive-deps`), enforces semicolons, and turns off
`react-in-jsx-scope` and `no-undef`. `frontend/ui/CLAUDE.md` documents the resulting idioms:
inline async functions with a `cancelled` flag inside `useEffect`, the `useRef` compare-and-reset
pattern for form state, and deep MUI type imports. `LibraryPage` carries three explicit
`eslint-disable` comments where the rules conflict with its clear-on-change design.

## Interactions

- **Depends on:** [Auth & Users](auth-and-users.md) for `AuthContext`, the token in
  `localStorage`, and role checks (`canEdit`, `isAdmin`); [Content Model](content-model.md) for
  the `Collection`/`Media`/`Person` shapes and the `collection.library`/`parent` fields used for
  breadcrumbs; [Images](images.md) for `/api/images/:id/file?token=`; [Search](search.md) for
  `SortControls`, `FilterChips`, `KeywordFilter`, quick search and `SearchPage`;
  [Libraries & Scanning](libraries-and-scanning.md) for `LibrariesPage` scan controls;
  [Configuration](configuration.md) for `SettingsPage`; [Streaming & Transcoding](streaming-and-transcoding.md)
  for the stream URL builders; [Deployment](deployment.md) for `serve`, nginx and `PORT`.
- **Used by:** [Playback](playback.md) (`PlayPage`, `PlayerContext`, `MiniPlayer` are mounted
  inside this shell), [User Collections](user-collections.md) (favourites/watch-later/queue
  pages and `CardQuickActions`), [Metadata Scraping](metadata-scraping.md) (`IdentifyDialog`
  and refresh actions in `CollectionOptionsMenu`).
- **Shared data:** no Prisma access; reads/writes `localStorage` keys `token`, `i18nextLng`,
  and the player's position/quality keys. Talks to every `/api/*` route group via `apiClient`;
  `@tubeca/shared-types` is the contract.

## History

- `4946f1d` 2025-11-28 Initial commit: Vite + React + MUI scaffold, `theme.ts`, `index.scss`.
- `5072d20` / `5282cf0` 2025-11-28 Header, libraries, i18n (`en.json`), collections, `apiClient`.
- `8ee3fba` / `3ef372e` 2025-12-01 Hero banner on collections; full-height show heroes; first frontend tests.
- `13ef8db` 2025-12-01 Library tabs in the header (`ActiveLibraryContext`).
- `873077f` 2025-12-01 `CLAUDE.md`, Users admin page, route restructure.
- `bb82089` 2025-12-01 Lint forces semicolons; `bdf633a` 2025-12-02 husky pre-commit lint+typecheck.
- `156d54b`…`bdf50de` 2025-12-01 Page-by-page test push (LibraryPage, MediaPage, PersonPage, UsersPage, Header, Sidebar, ImagesDialog, contexts).
- `8371767` 2025-12-02 `CollectionPage` split into `FilmHeroView`/`ShowHeroView`/`StandardCollectionView`/`ChildCollectionGrid`/`MediaGrid`/`CollectionBreadcrumbs`/`CollectionOptionsMenu` with tests.
- `5d54756` 2025-12-02 Library sorting.
- `ae3a327` / `f4f613f` 2025-12-04 Sorting, filtering, `CardQuickActions` add-to-collection across views.
- `bc1b575` 2025-12-04 API client returns `{ data: undefined }` on 204.
- `cb615b8` 2025-12-04 `StickyHeroBreadcrumbs` with scroll-based background transition.
- `d8f1906` 2025-12-04 `console.error` fails tests; tooltip-on-disabled-button fixes.
- `fb42fb2` 2025-12-05 Infinite scroll via `IntersectionObserver`; server-side sort/filter; lazy keyword load.
- `0d41baf` / `77a2f42` / `a34d24e` 2025-12-05 Coverage push: pages at 0%, components, player and `PlayerContext` tests; accessibility fixes.
- `4c3a261` 2025-12-07 `ViewModeMenu` and list view; `MediaListItem` follows (`645aa93` 2025-12-08).
- `347f98f` 2025-12-07 Hover rating / content-rating badges on library cards.
- `9117ccf` 2025-12-10 `useQuickSearch` type-to-filter on library and collection pages.
- `a27f5f8` 2025-12-13 Multi-select and `SelectionActionBar` on `LibraryPage`.
- `e6afcca` 2025-12-15 Identify dialog wired into `CollectionOptionsMenu`.
- `d06b185` 2025-12-16 Fixed hero backdrop with content scrolling over it.
- `64b1e52` 2025-12-19 Vite proxy targets `127.0.0.1`.
- `872e263` 2025-12-20 `ScrollRestorationContext` + `NavigationLoadingOverlay`.
- `8d11854` 2026-07-01 Vite proxy follows `PORT`.
- `82f6d5c` 2026-09-02 `parseTitle` util + test (working tree).

## Known Limitations

- **`/` is blank.** `App.tsx:57` maps the root to `<Box />`, yet login, setup and post-delete
  flows navigate there. The user sees only the header until they click a library tab.
- **No code splitting.** One 1.49MB JS bundle; `PlayPage`, hls.js, dnd-kit and the admin pages
  are downloaded before the login form renders.
- **Expired tokens are not handled.** `request()` returns the backend error text on 401; nothing
  clears the token or redirects, so every page shows "Invalid token"-style alerts until logout.
- **Single locale in practice.** i18next is configured with a language detector but only `en`
  exists; many call sites rely on inline English defaults, and the two client error strings are
  untranslated.
- **View mode, filters and sort are not persisted**; only the scroll-restoration cache (10 min,
  back-button only) remembers them. Navigating forward to the same library resets to poster/name.
- **Duplicate fetches.** `ActiveLibraryContext` re-fetches the collection or media that the page
  is already loading; `Header` and `Sidebar` each fetch `getLibraries()` (`Sidebar` on every open).
- **Scroll restoration heuristics.** State is saved on *any* button click (including favourite
  toggles and menu openers), restoration polls up to 50 frames, and a global `setInterval` runs
  for the app's lifetime. Only two pages participate; `CollectionPage` and `PersonPage` lose
  scroll position on back.
- **Responsiveness is grid-only.** No `useMediaQuery`; library tabs in the header do not collapse,
  `HeroSection` assumes viewport-height backdrops, `MediaListItem` fixes a 125px image column,
  `Sidebar` is 250px, and `body` has `min-width: 320px`.
- **Accessibility is partial.** 70 `aria-*` attributes across 18 files, but hover-only rating
  overlays, `CardActionArea` cards without labels, and the global keydown capture in
  `useQuickSearch` (which swallows printable keys anywhere outside inputs) are not keyboard- or
  screen-reader-friendly.
- **External font dependency.** `index.html` loads Google Fonts; on an air-gapped LAN the
  wordmark falls back to `cursive`.
- **Standalone `serve` mode cannot reach the API** without nginx, because `API_BASE` is relative
  and `serve` has no proxy.
- **`selectAll` only selects loaded pages**, not the full filtered set the backend knows about.

## Opportunities

- **Route to a real home page** (`/` → redirect to the first library or a dashboard) — fixes
  the blank landing after login and delete flows. (S)
- **Lazy-load routes** with `React.lazy` + `Suspense` per page, at minimum `PlayPage`
  (hls.js), `QueuePage`/`UserCollectionPage` (dnd-kit) and the admin pages. (S)
- **Adopt a query library** (TanStack Query or SWR): would replace the copy-pasted
  fetch/cancel/loading/error effects in ~14 pages, dedupe the `getLibraries` and
  `ActiveLibraryContext` fetches, give `LibraryPage` `useInfiniteQuery` for free, and provide a
  cache that makes `ScrollRestorationContext`'s data snapshot unnecessary. (L)
- **Split `LibraryPage`** (1004 lines, 25 state hooks) into a `useLibraryCollections` hook
  (pagination/filter/favourites), a `LibraryToolbar`, and `PosterGrid`/`ListView` components;
  the poster card with its hover overlay is inline JSX today. (M)
- **Extract `useAddToRecentCollection`** to remove the five copies of the "most recent user
  collection" logic. (S)
- **Handle 401 centrally** in `request()`: clear the token and dispatch to `/login`. (S)
- **Persist view mode / sort per library** in `localStorage` (the player already persists
  quality and mini-player position). (S)
- **Split `client.ts` by domain** (`auth`, `libraries`, `collections`, `stream`, `userCollections`)
  behind the same `request()` helper, or generate it from the backend's OpenAPI spec, which
  already exists at `/api-docs`. (M)
- **Move transcoding settings types into `@tubeca/shared-types`**; they are the only API types
  declared locally in `client.ts`. (S)
- **Mobile layout**: collapse header tabs into the drawer below `md`, shrink `HeroSection`
  height, and make `MediaListItem` stack on `xs`. (M)
- **Second locale + i18n lint**: add a `pseudo` or real locale and a test asserting every
  `t()` key exists in `en.json`, since inline defaults currently hide missing keys. (S)
- **Tests for the untested browsing pieces**: `ScrollRestorationContext`, `useQuickSearch`,
  `CardQuickActions`, `SelectionActionBar`, `StandardCollectionView`, `StickyHeroBreadcrumbs`,
  `NavigationLoadingOverlay`; and add `pnpm test` to the pre-commit hook or CI. (M)
- **Self-host the "Praise" font** in `public/` to drop the Google Fonts dependency. (S)
- **Make `serve` mode self-sufficient** by adding `VITE_API_BASE` or an `serve.json` rewrite,
  or drop the frontend service in favour of the backend serving `dist/` (see
  [Deployment](deployment.md)). (S)
- **Server-side select-all** for multi-select: pass the filter to a batch endpoint rather than
  selecting only loaded ids. (M)
