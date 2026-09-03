# Search & Discovery

> Search & Discovery is how a user finds a specific title in their libraries without browsing
> the hierarchy. It consists of one global `GET /api/search` endpoint plus a dedicated Search
> page, a keyboard-driven "quick search" overlay on the Library and Collection pages, and the
> shared sort / rating / keyword filter controls that those pages (and the user-collection
> pages) use to narrow a listing. All matching is SQLite `LIKE '%q%'` on a single `name`
> column; there is no ranking, fuzzy matching, or full-text index.

## Responsibilities

- Serve a global, cross-library search of root collections (shows, films, albums) and
  non-film media (episodes, tracks) by substring of `name`, paginated, restricted to the
  libraries the caller can access.
- Serve the Search page (`/search?q=`) with infinite scroll, a collapsible filter panel
  (content-rating exclusion chips + keyword autocomplete), multi-select of results, and
  scroll/state restoration on back navigation.
- Provide "type-to-filter" quick search on the Library page (server-side `nameFilter`,
  debounced) and the Collection page (client-side filtering of already-loaded children).
- Provide reusable `SortControls`, `FilterChips`, and `KeywordFilter` components used by
  LibraryPage, SearchPage, UserCollectionPage, FavoritesPage and WatchLaterPage.
- Expose per-library keyword lists (`GET /api/collections/library/:id/keywords`) and
  server-side sorting/filtering of library listings via `getPaginatedCollections`.
- (Nominally) expose `GET /api/persons/search?q=` for name lookup of people.

## Goals

- **Find-by-title fast enough for a personal library.** Every search path is a simple
  `contains` on `name`; the code never attempts relevance, tokenisation, or typo tolerance.
  This is adequate for hundreds-to-low-thousands of titles on SQLite.
- **Never leak titles from inaccessible libraries.** 8143c03 added group-based library
  access at the same time as the enhanced search; the search route filters by
  `libraryId IN (...)` for non-admins.
- **Consistent narrowing UX across list pages.** The same chip/autocomplete/sort widgets
  and the same query-string vocabulary (`excludedRatings`, `keywordIds`, `nameFilter`,
  `sortField`, `sortDirection`) are reused by the library listing and the search endpoint.
- **Keyboard-first browsing.** 62dc88f's quick search lets a user start typing anywhere on
  a list page to filter it, with a floating overlay showing the query and `n of m` match
  count, without focusing an input.
- **Search results are actionable.** 78d94c1 made result cards multi-selectable so a search
  can feed `SelectionActionBar` (add-to-user-collection) directly.

## Components

| File | Role |
|------|------|
| `backend/src/routes/search.ts` | `GET /api/search` — the only global search endpoint; builds two Prisma queries (collections, media) with access, keyword and rating filters |
| `backend/src/services/collectionService.ts` (`getPaginatedCollections`, `getKeywordsByLibrary`) | Library listing with `nameFilter`, rating/keyword filters, sorting; powers Library-page quick search and the keyword list |
| `backend/src/routes/collections.ts` (`GET /library/:libraryId`, `GET /library/:libraryId/keywords`) | Route wrappers for the above |
| `backend/src/routes/persons.ts` (`GET /search`) + `personService.searchByName` | Person name search (currently unreachable, see Limitations) |
| `frontend/ui/src/pages/SearchPage.tsx` | Search page: query form, filter panel, infinite scroll, multi-select, cached state |
| `frontend/ui/src/hooks/useQuickSearch.ts` | Global `keydown` capture that builds a query string from typed characters |
| `frontend/ui/src/hooks/useDebouncedValue.ts` | Generic 300 ms debounce used to throttle quick-search API calls |
| `frontend/ui/src/components/QuickSearchOverlay.tsx` | Fixed bottom-centre pill showing the quick-search query and `matchCount of totalCount` |
| `frontend/ui/src/components/FilterChips.tsx` | Exclusion chips (click toggles, double-click "only this"); exports `FILTER_LABEL_WIDTH` |
| `frontend/ui/src/components/KeywordFilter.tsx` | MUI `Autocomplete` multi-select over `Keyword[]`, case-insensitive client-side option filtering |
| `frontend/ui/src/components/SortControls.tsx` | Field `Select` plus asc/desc toggle button |
| `frontend/ui/src/api/client.ts` (`search`, `getCollectionsByLibrary`, `getKeywordsByLibrary`, `searchPersons`) | API wrappers |
| `packages/shared-types/src/index.ts` (`SearchResponse`, `Keyword`, `KeywordsResponse`) | Wire types |

## How It Works

### Global search endpoint (`backend/src/routes/search.ts`)

1. Parses `q`, `page` (default 1), `limit` (default 50, capped at 100), `keywordIds` and
   `excludedRatings` (both comma-separated). `q` is trimmed and lower-cased
   (`search.ts:79`); an empty `q` is allowed and means "list everything".
2. Resolves library access: admins see all; other users get the union of `libraryId`s from
   their groups (`search.ts:98-116`). A non-admin with no groups short-circuits to
   `{ collections: [], media: [] }` — note this early return omits `totalCollections`,
   `totalMedia`, `page`, `hasMore`.
3. Collections query: `parentId: null` (root only — seasons are never returned),
   `name: { contains: q }`, `AND [ keywords.some(id) ... ]` for each keyword (all must
   match), and an `OR` that keeps rows with no `filmDetails`, a null `contentRating`, or a
   rating not in the excluded list. Includes library, primary poster, show/film details,
   keywords and counts. Ordered `name asc`, `skip/take` applied.
4. Media query (skipped entirely when any keyword filter is active, because `Media` has no
   keywords): `collection.libraryId IN (...)`, `collection.library.libraryType != 'Film'`
   (films are surfaced as collections), `name contains q`. Includes collection + parent (for
   the "Show - S1E2" subtitle), primary image, video/audio details. Ordered `name asc`.
5. The **same** `skip`/`take` is applied independently to both queries, so a page holds up
   to `2 * limit` items; `hasMore = skip + collections.length + media.length < total`, which
   can stay true for one empty page once the shorter list is exhausted.
6. Prisma `contains` on the libsql adapter compiles to `LIKE '%q%'`: ASCII-only
   case-insensitive (the `toLowerCase()` is redundant), no `mode: 'insensitive'` on SQLite,
   and no index can serve a leading wildcard — `Collection.name` / `Media.name` have no
   index anyway (`schema.prisma:80-82, 142-143`).

### Search page (`frontend/ui/src/pages/SearchPage.tsx`)

- The query lives in the URL (`?q=`); the text field only submits on Enter — no live search.
  The Header's search icon navigates to `/search` with no query (no inline search box).
- `performSearch(page, append)` calls `apiClient.search`; page 1 replaces results, later
  pages append. An `IntersectionObserver` sentinel (`rootMargin: 200px`) drives pagination.
- Filter options are derived from **page 1 of the unfiltered result set** only: ratings from
  `filmDetails.contentRating` (sorted by a hard-coded MPAA order) and keywords from
  `collection.keywords` (`SearchPage.tsx:157-190`), persisted for the session so the filter
  button does not vanish. The keyword picker therefore only offers tags present in the first
  50 alphabetical results, unlike LibraryPage, which lazily fetches `/keywords` on first open.
- Any change to `q`, selected keywords or excluded ratings re-runs page 1 (a ref compares
  the serialised params to avoid duplicate fetches).
- Results render as two sections, "Shows & Movies (n)" and "Episodes & Tracks (n)".
  Selection mode (78d94c1) adds card checkboxes, separate collection/media id sets, Select
  All, and `SelectionActionBar` for add-to-collection. There are no sort controls.
- Results, page, totals, filter options and query are cached under `search-<q>` via
  `useCachedState`/`useScrollRestoration` (758f70f); infinite scroll is suppressed for
  500 ms after a restore.

### Quick search (`useQuickSearch`, `useDebouncedValue`, `QuickSearchOverlay`)

- `useQuickSearch` listens for `keydown` on `document`, ignoring inputs, contenteditable,
  `[role=dialog]`/`[role=menu]` descendants and Ctrl/Meta/Alt combos. `Escape` clears,
  `Backspace` pops, and single keys matching `/[\w\s]/` are appended
  (`useQuickSearch.ts:59-62`) — ASCII word characters only.
- **LibraryPage: server-side.** The raw query is debounced 300 ms and passed as
  `nameFilter` to `GET /api/collections/library/:id` (`LibraryPage.tsx:97-99, 163`).
  `getPaginatedCollections` applies `name: { contains }` alongside sorting, rating and
  keyword filters, so the filtered list is itself paginated and infinite-scrollable.
- **CollectionPage: client-side.** `filteredChildren` / `filteredMedia` are `useMemo`
  `toLowerCase().includes` filters over already-loaded data (`CollectionPage.tsx:288-298`);
  nothing is refetched. `QuickSearchOverlay` is purely presentational.

### Sort and filter controls

- `SortControls` is a controlled `Select` + direction toggle. LibraryPage sends
  `sortField`/`sortDirection` to the server, but in `getPaginatedCollections` only `name`
  and `dateAdded` map to a Prisma `orderBy`; `releaseDate`, `rating` and `runtime` query by
  `createdAt` and are then sorted **in memory on the already-paginated page**
  (`collectionService.ts:157-181, 254-276`), so the global order is wrong.
- UserCollection/Favorites/WatchLater pages use the same controls purely client-side over
  their unpaginated item lists.
- `FilterChips` models *exclusion*: filled chip = included, outlined/struck-through =
  excluded; double-click (6f9e6c7) excludes every other option. `KeywordFilter` models
  *inclusion* with AND semantics on the server.

### People search

`GET /api/persons/search` (`persons.ts:153`, `contains` on `Person.name`, limit 20) is
registered **after** `GET /:id` (`persons.ts:46`), so Express hands `/api/persons/search`
to the `:id` handler and it 404s. `apiClient.searchPersons` has a URL unit test but no UI
caller; PersonPage has no search. `POST /api/collections/search` (identification) queries
external scrapers and belongs to Metadata Scraping.

## Interactions

- **Depends on:** [Auth & Users](auth-and-users.md) (JWT `authenticate`, `req.user.role`,
  group membership for library access); [Content Model](content-model.md) (`Collection`,
  `Media`, `Keyword`, details tables that carry `contentRating`, `releaseDate`, `rating`,
  `runtime`); [Metadata Scraping](metadata-scraping.md) (populates keywords, ratings and
  descriptions that filters rely on); [Images](images.md) (primary poster per result card);
  [Frontend App](frontend-app.md) (routing, `ScrollRestorationContext`, i18n, Header).
- **Used by:** [User Collections](user-collections.md) (`SelectionActionBar` from search
  multi-select; Favorites/WatchLater/UserCollection pages reuse `SortControls` and
  `FilterChips`); [Libraries & Scanning](libraries-and-scanning.md) (LibraryPage uses
  `nameFilter`, sort and keyword filtering from `getPaginatedCollections`);
  [Playback](playback.md) (result click navigates to `/collection/:id` or `/media/:id`).
- **Shared data:** reads `Collection` (+`ShowDetails`, `FilmDetails`, `AlbumDetails`,
  `Keyword` via `_CollectionToKeyword`), `Media` (+`VideoDetails`, `AudioDetails`),
  `Image`, `User`/`Group`/`Library` join for access, `Person`. Writes nothing. No queues or
  config keys.

## History

- `a3f2f55` 2025-11-30 — People listing added, including `personService.searchByName` and
  `GET /api/persons/search` (already shadowed by `/:id`).
- `f7f96fd` 2025-12-02 — Library sort controls (name/dateAdded/releaseDate/rating/runtime);
  backend returns sortable metadata fields.
- `fc8e567` 2025-12-03 — Search page and `GET /api/search` added: name `contains` across
  accessible libraries, root collections + non-film media.
- `7685e01` 2025-12-04 — `SortControls` and `FilterChips` extracted as reusable components;
  applied to LibraryPage and UserCollectionPage; `contentRating` included for filtering.
- `6f9e6c7` 2025-12-04 — Double-click a filter chip to "select only".
- `68439dd` 2025-12-05 — `KeywordFilter` autocomplete, `/keywords` endpoint, keyword AND
  filtering in `getPaginatedCollections`, collapsible filter panel with badge.
- `482f7af` 2025-12-05 — Infinite scroll for library and search; filter UX tweaks.
- `96d0eb6` 2025-12-05 — `SearchPage.test.tsx` added; filter toggle given an aria-label.
- `8143c03` 2025-12-10 — Group-based library access; search made query-optional, paginated
  with totals/`hasMore`, keyword + rating filters, media excluded when keyword-filtering.
- `62dc88f` 2025-12-10 — Quick search: `useQuickSearch`, `useDebouncedValue`,
  `QuickSearchOverlay`; server-side `nameFilter` for LibraryPage, client-side for
  CollectionPage.
- `78d94c1` 2025-12-14 — Multi-select + Select All on Search page, feeding
  `SelectionActionBar`.
- `758f70f` 2025-12-20 — Scroll/state restoration for Search and Library pages.

## Known Limitations

- **Name-only matching.** Search ignores descriptions, `originalTitle`, keyword names,
  person names, season names and file paths. Typing a tag name or an actor into the search
  box finds nothing; keywords are only usable via the id-based filter.
- **Substring `LIKE` with no index, no FTS, no ranking.** Every search is a full table scan
  of `Collection` then `Media`, results are alphabetical rather than by relevance, and
  "Matrix Reloaded" does not match "matrix reloded". Case-insensitivity is ASCII-only.
- **`/api/persons/search` is unreachable** because `/:id` is registered first; the client
  method is dead code and PersonPage has no search.
- **Access-control divergence.** `libraryService.getAccessibleLibraries` treats libraries
  with no groups as public, but `search.ts` only includes group-linked libraries, so a
  non-admin can browse a public library yet get zero search results from it.
- **Pagination is two parallel offsets** (up to `2 * limit` per page, `hasMore` true for an
  empty tail page); the no-access early return omits totals and `hasMore`.
- **Search page filter options are sampled from page 1.** Keywords/ratings not present in
  the first 50 unfiltered, alphabetically-first collections are never offered, and the
  option list is not rebuilt when `q` changes after the first load of the session cache.
- **Sort by release date / rating / runtime is only page-local** in
  `getPaginatedCollections`; combined with infinite scroll the visible order is wrong.
- **Quick search cannot type non-ASCII or punctuation** (accents, CJK, `-`, `'`), and it
  captures keys on any focused non-input element with no opt-out beyond dialogs.
- **Search page has no sort, no live search, no library/type facet**, and no way to
  restrict to a single library or to seasons/episodes only.
- **Duplication.** The rating `OR`, keyword `AND` and name `contains` clauses are hand-built
  in both `search.ts` and `getPaginatedCollections`; the MPAA order and filter-badge UI are
  copied between SearchPage and LibraryPage; `mediaService.searchMedia` is an unused copy.
- **Tests.** No backend tests for `search.ts`, `getPaginatedCollections`, or persons
  search. Frontend has `SearchPage.test.tsx` (render, navigation, filter toggle only — no
  pagination, selection, or filter-application assertions) and `KeywordFilter.test.tsx`;
  there are no tests for `useQuickSearch`, `useDebouncedValue`, `QuickSearchOverlay`,
  `FilterChips`, `SortControls`, or LibraryPage/CollectionPage quick-search behaviour.

## Opportunities

- **Fix persons route ordering** (move `/search` above `/:id`) and wire `searchPersons`
  into the Search page as a third result section. S.
- **Reuse `libraryService.getAccessibleLibraries` in `search.ts`** so public (no-group)
  libraries are searchable and the empty response has the standard shape. S.
- **Extract a shared `buildCollectionWhere({ nameFilter, keywordIds, excludedRatings,
  libraryIds })`** used by both the search route and `getPaginatedCollections`, plus a
  shared rating-order constant on the frontend. S–M.
- **Add SQLite FTS5 virtual tables** for `Collection.name`/`Media.name`/`Person.name`
  (plus description and original title) maintained by triggers or the scan/scrape workers,
  with `bm25()` ranking and a single merged, cursor-paginated result list. Removes the full
  scan and adds token/prefix matching and Unicode-insensitive search. L.
- **Search keyword names and people** in the same query (`keywords.some.name contains`,
  credits via `Person.name`) so free-text search covers tags and cast; the `Keyword` table
  also makes a "browse by tag" page and library/type/year facets natural. M.
- **Move releaseDate/rating/runtime sorting into SQL** (nullable relation `orderBy` with
  `nulls: 'last'`, or a denormalised `sortDate`/`sortRating` column on `Collection`) so
  sorting is correct across pages. M.
- **Serve Search-page filter options from the server** (a global `/keywords` and a
  distinct-ratings endpoint, or `facets` in the search response) rather than sampling page
  1. S.
- **Live search on the Search page** using the existing `useDebouncedValue` hook, and a
  Header search box that submits to `/search?q=`. S.
- **Broaden `useQuickSearch` key acceptance** to `/\p{L}|\p{N}|[\s'\-:]/u` and add an
  opt-out attribute for components that handle their own keys. S.
- **Tests:** supertest coverage for `GET /api/search` (access filtering, keyword AND,
  rating exclusion, pagination shape), unit tests for `useQuickSearch`/`useDebouncedValue`,
  and SearchPage tests for infinite scroll, selection mode and filter application. M.
