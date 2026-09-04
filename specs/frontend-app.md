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
- **Never lose the user's place.** Infinite scroll (482f7af) was followed within two weeks by a
  scroll-restoration cache (758f70f) because the back button reset the grid; filter changes keep
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
| `frontend/ui/src/context/ScrollRestorationContext.tsx` | Module-level map of route key to scroll offset; the `useScrollRestoration` hook |
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
| `frontend/ui/src/pages/LibraryPage.tsx` | Library page: filter, selection and dialog state, composing the toolbar, the cards and `useLibraryCollections` (362 lines) |
| `frontend/ui/src/hooks/useLibraryCollections.ts` | The library, a page at a time of its collections, favourites/watch-later ids, content ratings and keywords, plus `loadMore` and the restore snapshot |
| `frontend/ui/src/components/LibraryToolbar.tsx`, `components/CollectionCard.tsx` | The library heading and controls; the poster tile and list row |
| `frontend/ui/src/hooks/useApiQuery.ts` | `useApiQuery` adapter over TanStack Query plus the `queryKeys` table |
| `frontend/ui/src/api/queryClient.ts` | The shared query cache and its defaults |
| `frontend/ui/src/hooks/useLibraries.ts`, `hooks/useAddToRecentCollection.ts`, `hooks/useLibraryViewPreferences.ts` | Shared data and preference hooks |
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
routes. Every page except `HomePage` is a `React.lazy` import behind one `Suspense` whose
fallback is a centred spinner, so a page's code arrives when it is first visited and the build
emits a chunk per page rather than one file. hls.js is a dynamic `import()` inside
`PlayerContext`, resolved the first time something plays: the context is mounted app-wide for
the mini-player, so a static import put 522 kB in front of the login form. The initial bundle is
657 kB (205 kB gzipped), down from 1,177 kB. `HomePage` stays eager because it is where a
signed-in user lands. The `/` route renders `HomePage`, a card grid of the
libraries the user can see (icon by type, click sets the active library and opens
`/library/:id`, empty state with an admin shortcut to `/admin/libraries`); `LoginPage`,
`SetupPage`, `CollectionPage` (after delete) and `MediaPage` (after delete) all `navigate('/')`
and land there. The
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
2. `fetch('/api' + endpoint)`. If status is 204, return `{ data: undefined }` (1cff894 fixed
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

**ScrollRestorationContext** (758f70f) keeps a module-level `Map<string, {scrollY, timestamp}>`
with a 10-minute TTL swept every 60s. `useScrollRestoration(key)` installs a capturing document
click listener that saves the offset whenever the user clicks an `<a>`, a `MuiCardActionArea` or
any `<button>`, since there is no "about to navigate" event, then on a `POP` retries
`window.scrollTo` via `requestAnimationFrame` up to 50 times until the document is tall enough.
It used to store the page's rows too; the query cache holds those now, so what comes back is the
offset alone. Only `LibraryPage` and `SearchPage` use it. `NavigationLoadingOverlay` complements it by showing a 70% black overlay on
`popstate` and hiding it 50ms after the location changes.

### Layout chrome

`Header` renders one tab button per library from `useLibraries()`; the active one gets a white
underline. Favourites, watch-later and queue icons are hidden below the `md` breakpoint; the
library tabs are not, so on narrow screens they overflow. `Sidebar` reads the same hook, so
opening the drawer no longer re-fetches what the header already has, and shows the admin section
only for `role === 'Admin'`. Both are
the only responsive touches besides `Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }}` on every grid;
there are zero `useMediaQuery` or `breakpoints.down` calls in `src/`.

### Data fetching

Reads go through TanStack Query. `useApiQuery(key, call)` wraps a client method: the client
reports failures as `{ error }` rather than by throwing, so the adapter throws an `ApiError`
instead and lets the cache hold both the loading and the error state. A page then reads
`data`, `isPending` and `errorMessage` rather than keeping three `useState`s and a `cancelled`
flag. Keys live in one `queryKeys` table so a mutation can invalidate or overwrite what it
changed, which is how Identify and the person refresh push a fresh record into the cache.

Defaults are in `api/queryClient.ts`: 30 s `staleTime`, 5 minute `gcTime`, no refetch on window
focus, one retry. Tests get their own client per render (`test-utils.tsx`) with retries off.

The cache is also the deduplicator. The header, the sidebar and the home page share one
`getLibraries` request; `ActiveLibraryContext` reads the same collection or media record the
page it is on has already fetched, where before it issued a second identical request purely to
learn the library id.

### Library browsing (`LibraryPage`)

The page owns what the viewer is doing; `useLibraryCollections` owns the data and
`LibraryToolbar`, `CollectionPosterCard` and `CollectionListCard` own the markup. The flow:

1. Coming back re-renders the pages already in the query cache, and
   `useScrollRestoration('library-<id>')` puts the offset back once the page is tall enough.
2. Otherwise the hook runs two queries: `getLibrary`, and an infinite query over the pages.
3. Each page calls `getCollectionsByLibrary` with `page`, `limit: 50`, `sortField`,
   `sortDirection`, `excludedRatings`, `keywordIds` and the debounced quick-search `nameFilter`.
   `checkFavorites` and `checkWatchLater` are their own queries keyed on the loaded ids, and the
   rating filter is derived from the loaded pages, ordered G, PG, PG-13, R, NC-17, NR, Unrated.
4. A sort, filter or search change is a different query key, so the first page of the new query
   is fetched while the old grid stays visible under a translucent `CircularProgress` overlay.
5. Infinite scroll: an `IntersectionObserver` on a sentinel `div` below the grid calls the
   hook's `loadMore()` (`fetchNextPage`) when 10% visible and `hasMore`.
6. Keywords are a query enabled the first time the filter panel opens (`loadKeywords`).
7. `viewMode` ('poster' | 'list', 33b11fc) and the sort come from
   `useLibraryViewPreferences`, which keeps them per library id in `localStorage`; a value that
   is not one we wrote is ignored, and storage being unavailable only costs the memory of the
   choice.
   Poster cards show a hover-only overlay with content rating and `★ 7.5` (f2f8070) via a CSS
   `&:hover .rating-overlay` rule. List mode uses `MediaListItem` with an inline
   `CardQuickActions`.
8. Selection mode (5e379a5) toggles a checkbox per card, outlines selected cards, and shows
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

`HeroSection` (63d1d10) places the backdrop `<img>` and gradient with `position: fixed` covering
the viewport, and the content scrolls over it; a 32px gradient at the bottom fades into
`background.default`. `StickyHeroBreadcrumbs` (1f595f9) uses negative margins (`mx: -3`,
`mt: -38px`) to escape the container padding and swaps from transparent/light text to
`background.paper` once `window.scrollY > 80`.

`CollectionPage`, `MediaPage`, `PersonPage`, `HomePage`, `QueuePage`, `FavoritesPage`,
`WatchLaterPage`, `UsersPage`, `LibrariesPage`, `UserCollectionsPage` and `UserCollectionPage`
read through `useApiQuery`; the shape a page renders is unchanged (`isPending` →
`CircularProgress`, an error message → `Alert`, `null` → "not found" `Alert`), but the fetching,
the cancellation and the error state are the cache's. `LibrariesPage` polls through
`refetchInterval`, which returns 2 s while any scan in the response is running and false
otherwise, in place of its own `setInterval` and ref. Two pages still carry their own effects:
`SearchPage`, whose pagination wants `useInfiniteQuery` alongside `LibraryPage`'s, and
`SettingsPage`, whose fetch seeds a dozen controlled inputs and is single-use anyway. The "add to most recent user collection" behaviour is now
`useAddToRecentCollection` plus `RecentCollectionMenuItem`, used by `CardQuickActions`,
`FilmHeroView`, `ShowHeroView`, `StandardCollectionView` and `MediaPage`; the list is fetched
only while an add menu is open.

### i18n

`i18n/index.ts` registers one resource bundle (`en`), `fallbackLng: 'en'`, and
`i18next-browser-languagedetector` reading `localStorage` then `navigator`. `en.json` has 197
leaf keys across 21 namespaces (largest: `libraries` 31, `users` 30, `userCollections` 25). Most
newer call sites pass an inline default (`t('view.poster', 'Poster')`), so missing keys degrade
to English silently. There is no language switcher.

### Dev proxy, build, production

`vite.config.ts` proxies `/api` to `http://127.0.0.1:${PORT ?? 3000}`; 6c12ed4 switched from
`localhost` to avoid IPv6 resolution stalls under WSL2, and c95eedf made the port follow the
backend's `PORT` (passed through by `turbo.json`). `pnpm build` runs `tsc && vite build`.
The `PKGBUILD` does `pnpm add serve` in `frontend/ui`, and `tubeca-frontend.service` runs
`serve -s dist -l 8080`; because `API_BASE` is the relative `/api`, that standalone mode only
works behind the `systemd/nginx.conf.example` reverse proxy (which serves `dist/` directly and
proxies `/api` and `/api/stream/` to `:3000`). See [Deployment](deployment.md).

### Testing

`jest.config.cjs` uses ts-jest with jsdom, maps `.scss` to `identity-obj-proxy`, and matches
`**/__tests__/**/*.test.{ts,tsx}`. `jest.setup.ts` polyfills `TextEncoder` and overrides
`console.error` to throw (3d62f55). `test-utils.tsx` exports a `render` wrapped in
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
`ScrollRestorationContext`, both hooks. The husky pre-commit hook runs `pnpm lint && pnpm
typecheck && pnpm test` (tests added 2026-09-03; the frontend suite takes about a minute).
The shared `test-utils.tsx` wrapper mirrors `main.tsx` providers including
`ScrollRestorationProvider`; forgetting to add a new provider there is what silently broke 29
cases between December 2025 and September 2026.

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
- `322f4ef` / `d37f069` 2025-12-01 Hero banner on collections; full-height show heroes; first frontend tests.
- `0229cc8` 2025-12-01 Library tabs in the header (`ActiveLibraryContext`).
- `24d1114` 2025-12-01 `CLAUDE.md`, Users admin page, route restructure.
- `d7d4c32` 2025-12-01 Lint forces semicolons; `c3a9f25` 2025-12-02 husky pre-commit lint+typecheck.
- 2026-09-03 hls.js loaded on demand; `LibraryPage` and `SearchPage` moved to `useInfiniteQuery`, after which `ScrollRestorationContext` kept only the scroll offset.
- 2026-09-03 TanStack Query adopted: `useApiQuery` adapter and a `queryKeys` table, eleven
  pages and two contexts converted, shared library/collection/media reads, `LibraryPage` split into `useLibraryCollections`,
  `LibraryToolbar` and the collection cards, routes lazy-loaded, view mode and sort persisted
  per library, and the five copies of "add to most recent collection" replaced by one hook.
- `68cf1ce`…`30f5a7a` 2025-12-01 Page-by-page test push (LibraryPage, MediaPage, PersonPage, UsersPage, Header, Sidebar, ImagesDialog, contexts).
- `384bcd7` 2025-12-02 `CollectionPage` split into `FilmHeroView`/`ShowHeroView`/`StandardCollectionView`/`ChildCollectionGrid`/`MediaGrid`/`CollectionBreadcrumbs`/`CollectionOptionsMenu` with tests.
- `f7f96fd` 2025-12-02 Library sorting.
- `7685e01` / `ae10325` 2025-12-04 Sorting, filtering, `CardQuickActions` add-to-collection across views.
- `1cff894` 2025-12-04 API client returns `{ data: undefined }` on 204.
- `1f595f9` 2025-12-04 `StickyHeroBreadcrumbs` with scroll-based background transition.
- `3d62f55` 2025-12-04 `console.error` fails tests; tooltip-on-disabled-button fixes.
- `482f7af` 2025-12-05 Infinite scroll via `IntersectionObserver`; server-side sort/filter; lazy keyword load.
- `96d0eb6` / `7addd1d` / `6a4f5a8` 2025-12-05 Coverage push: pages at 0%, components, player and `PlayerContext` tests; accessibility fixes.
- `33b11fc` 2025-12-07 `ViewModeMenu` and list view; `MediaListItem` follows (`09e59e7` 2025-12-08).
- `f2f8070` 2025-12-07 Hover rating / content-rating badges on library cards.
- `62dc88f` 2025-12-10 `useQuickSearch` type-to-filter on library and collection pages.
- `5e379a5` 2025-12-13 Multi-select and `SelectionActionBar` on `LibraryPage`.
- `b088bdc` 2025-12-15 Identify dialog wired into `CollectionOptionsMenu`.
- `63d1d10` 2025-12-16 Fixed hero backdrop with content scrolling over it.
- `6c12ed4` 2025-12-19 Vite proxy targets `127.0.0.1`.
- `758f70f` 2025-12-20 `ScrollRestorationContext` + `NavigationLoadingOverlay`.
- `c95eedf` 2026-07-01 Vite proxy follows `PORT`.
- `27c0663` 2026-09-02 `parseTitle` util + test (working tree).
- 2026-09-03 `HomePage` added at `/` (library cards, empty state, tests); replaces the empty `<Box />`.
- 2026-09-03 Suite repaired (860 cases green): `ScrollRestorationProvider` added to `test-utils.tsx`, stale expectations for full-scan options, settings tabs and season-card fallbacks updated; `pnpm test` added to the pre-commit hook.
- 2026-09-03 `ApiClient` signs the app out centrally on a 401 (clears the token, fires `tubeca:unauthorized`, which `AuthContext` listens for).
- 2026-09-03 Coverage push: `SelectionActionBar`, `IdentifyDialog`, `LibraryToolbar`, `DirectoryPickerDialog`, `useQuickSearch` and `useDebouncedValue` tested; `aria-label`s added to the filter and identify-search buttons; the collection-name field in `SelectionActionBar` now stops its keystrokes reaching MUI's `MenuList` type-ahead, which had been eating them.

## Known Limitations

- **The initial bundle is still 657 kB** (205 kB gzipped) after hls.js moved out of it: MUI,
  react-router and i18next are all eager, and nothing is split below the route level.
- **Expired tokens are not handled.** `request()` returns the backend error text on 401; nothing
  clears the token or redirects, so every page shows "Invalid token"-style alerts until logout.
- **Single locale in practice.** i18next is configured with a language detector but only `en`
  exists; many call sites rely on inline English defaults, and the two client error strings are
  untranslated.
- **Filters are not persisted.** View mode and sort are remembered per library, but excluded
  ratings and selected keywords are not, so returning to a library clears them.
- **`SettingsPage` still hand-rolls its fetches**, deliberately: they seed twelve controlled
  inputs once and gain nothing from a cache.
- **Restoring a scrolled list depends on the query cache window.** Pages are held for five
  minutes; come back later and the list starts at page one with the saved scroll offset
  unreachable, so the page settles at the bottom of what it has.
- **Scroll restoration heuristics.** State is saved on *any* button click (including favourite
  toggles and menu openers), restoration polls up to 50 frames, and a global `setInterval` runs
  for the app's lifetime. Only two pages participate; `CollectionPage` and `PersonPage` lose
  scroll position on back.
- **Responsiveness is grid-only.** No `useMediaQuery`; library tabs in the header do not collapse,
  `HeroSection` assumes viewport-height backdrops, `MediaListItem` fixes a 125px image column,
  `Sidebar` is 250px, and `body` has `min-width: 320px`.
- **Accessibility is partial.** Hover-only rating overlays, `CardActionArea` cards without
  labels, and the global keydown capture in `useQuickSearch` (which swallows printable keys
  anywhere outside inputs) are not keyboard- or screen-reader-friendly. Icon buttons wrapped in a
  `Tooltip` need their own `aria-label`, because the tooltip names the `<span>` MUI puts around a
  possibly-disabled button rather than the button: the favourite and watch-later controls on every
  card, the library filter button (its tooltip names the `Badge` around it) and the identify
  dialog's search button had no accessible name until 2026-09-03 for exactly that reason.
- **External font dependency.** `index.html` loads Google Fonts; on an air-gapped LAN the
  wordmark falls back to `cursive`.
- **Standalone `serve` mode cannot reach the API** without nginx, because `API_BASE` is relative
  and `serve` has no proxy.
- **`selectAll` only selects loaded pages**, not the full filtered set the backend knows about.

## Opportunities

- **Persist filters per library** (S): excluded ratings and selected keywords alongside the view
  mode and sort that are already stored.

- **Split `client.ts` by domain** (`auth`, `libraries`, `collections`, `stream`, `userCollections`)
  behind the same `request()` helper, or generate it from the backend's OpenAPI spec, which
  already exists at `/api-docs`. (M)
- **Move transcoding settings types into `@tubeca/shared-types`**; they are the only API types
  declared locally in `client.ts`. (S)
- **Mobile layout**: collapse header tabs into the drawer below `md`, shrink `HeroSection`
  height, and make `MediaListItem` stack on `xs`. (M)
- **Second locale + i18n lint**: add a `pseudo` or real locale and a test asserting every
  `t()` key exists in `en.json`, since inline defaults currently hide missing keys. (S)
- **Tests for the untested browsing pieces**: `ScrollRestorationContext`, `StandardCollectionView`,
  `StickyHeroBreadcrumbs`, `NavigationLoadingOverlay`, `CollectionCard`, `FilterChips`,
  `ContinueWatchingRow`, `QuickSearchOverlay`, `MediaListItem`. (M)
- **Self-host the "Praise" font** in `public/` to drop the Google Fonts dependency. (S)
- **Make `serve` mode self-sufficient** by adding `VITE_API_BASE` or an `serve.json` rewrite,
  or drop the frontend service in favour of the backend serving `dist/` (see
  [Deployment](deployment.md)). (S)
- **Server-side select-all** for multi-select: pass the filter to a batch endpoint rather than
  selecting only loaded ids. (M)
