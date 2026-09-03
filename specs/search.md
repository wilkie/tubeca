# Search & Discovery

> Search & Discovery is how a user finds a specific title in their libraries without browsing
> the hierarchy. It consists of one global `GET /api/search` endpoint plus a dedicated Search
> page, a keyboard-driven "quick search" overlay on the Library and Collection pages, and the
> shared sort / rating / keyword filter controls that those pages (and the user-collection
> pages) use to narrow a listing. Free-text matching runs against an SQLite FTS5 index over
> titles, alternative titles, descriptions, keywords and cast, ranked with `bm25()`; the
> narrowing controls on list pages still use `LIKE` on `name`.

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

- **Find a title by anything you remember about it.** The index covers the title, the
  original title, the description, the keywords and the cast, so an actor's name or a plot
  word finds the film. Matching is token-based with a prefix on the last word, and diacritics
  are folded, so "amelie" finds "Amélie" and "blade runn" finds Blade Runner while you type.
- **Never regress into a worse search.** The index is rebuilt on first boot after upgrading
  and kept current by the workers, but a search still falls back to the old `contains` match
  whenever the index is empty, so a server mid-rebuild is not a server without search.
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
| `backend/src/routes/search.ts` | `GET /api/search` (global search), `GET /api/search/facets` (filter options), `POST /api/search/reindex` (Admin) |
| `backend/src/services/searchIndexService.ts` | The FTS5 index: `indexCollection`/`indexMedia`/`remove`/`rebuild`/`search`, and `toMatchQuery` which turns typed text into an FTS5 query |
| `backend/prisma/migrations/20260903200000_search_index/` | Creates the `search_index` virtual table |
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
2. Resolves library access through `LibraryService.getAccessibleLibraries` (admins are not
   filtered; others get public libraries plus those shared with their groups) and applies the
   ids as `libraryId: { in: [...] }` to both queries. A user with no accessible libraries gets
   the normal response shape with empty arrays.
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

`GET /api/persons/search` (`contains` on `Person.name`, limit 20) is registered before
`GET /:id` in `persons.ts` (it was shadowed by `/:id` until 2026-09-03; a router-order test in
`routes/__tests__/persons.test.ts` guards the fix). `apiClient.searchPersons` has a URL unit
test but no UI caller; PersonPage has no search. `POST /api/collections/search` (identification) queries
external scrapers and belongs to Metadata Scraping.

### The full-text index

`search_index` is an FTS5 virtual table holding one row per collection and per media item:
`entityId`, `entityType`, `libraryId` and `contentRating` as UNINDEXED columns for filtering,
then `name`, `altNames`, `description`, `keywords` and `people` as the indexed text. The
tokenizer is `unicode61 remove_diacritics 2`.

Rows are written where the text is written: `ImportService` indexes a media item or collection
as it is created or moved, the scrape workers re-index after applying metadata, and
`ContentDeletionService` removes rows it deletes. Nothing reads the index as a source of truth,
so a stale one is repaired by `POST /api/search/reindex` rather than being a data problem. The
API process builds the index once on boot when it is empty, in the background.

`toMatchQuery` turns what someone typed into an FTS5 query: the text is split on anything that
is not a letter or digit, each token is quoted as a literal (so a title containing `NOT`, `-`
or `*` cannot become syntax), and the last token gets a prefix match. Ranking is `bm25()` with
the title weighted highest, then alternative titles, keywords, people and finally the
description, so a title match beats a mention in a plot summary.

Access and rating filters are applied inside the FTS query through the UNINDEXED columns, so
the page of ids it returns is the page to render. Prisma then loads those rows and the route
puts them back into rank order. A keyword-id filter still goes through the Prisma path, since
the index holds keyword names rather than ids.

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

- 2026-09-03 — FTS5 `search_index` over titles, alternative titles, descriptions, keywords and
  cast, written by the importer and the scrape workers and rebuilt on first boot; `bm25`
  ranking with access and rating filters applied inside the query; `GET /api/search/facets`
  and `POST /api/search/reindex`; live search, a people section and server-served filter
  options on the Search page.
- `a3f2f55` 2025-11-30 — People listing added, including `personService.searchByName` and
  `GET /api/persons/search` (shadowed by `/:id` until 2026-09-03).
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
- 2026-09-03 — `/api/persons/search` registered before `/:id`, with a router-order test.
- 2026-09-03 — Search scope now comes from `LibraryService.getAccessibleLibraries`; public libraries are searchable by everyone and the response shape no longer changes for users without groups. Route tests added.

## Known Limitations

- **No typo tolerance.** Matching is token-based with a prefix on the last word, so
  "matrix reloded" still finds nothing; FTS5 has no built-in edit distance.
- **File paths are still not searched**, and the quick-search filters on list pages remain
  `LIKE` on `name` rather than going through the index.
- **The index is only as fresh as its writers.** A row edited by a path that does not
  re-index it, or a restore from a database backup, leaves it stale until a reindex; nothing
  detects that automatically.
- **People are matched with `LIKE`.** The content index knows cast names, so a film is found
  by its actor, but the people section itself is a substring match on `Person.name` with no
  ranking, no diacritic folding and no library scoping.
- **Pagination is two parallel offsets** (up to `2 * limit` per page, `hasMore` true for an
  empty tail page).
- **Search itself offers no sort control** (always `name` ascending), though the columns the
  library view sorts on (`sortReleaseDate`, `sortRating`, `sortRuntime`) are now on `Collection`
  and available to it.
- **Quick search cannot type non-ASCII or punctuation** (accents, CJK, `-`, `'`), and it
  captures keys on any focused non-input element with no opt-out beyond dialogs.
- **Search page has no sort and no library/type facet**, and no way to restrict to a single
  library or to seasons/episodes only. Results are ordered by relevance with no way to change
  it.
- **Duplication.** The rating `OR`, keyword `AND` and name `contains` clauses are hand-built
  in both `search.ts` and `getPaginatedCollections`; the MPAA order and filter-badge UI are
  copied between SearchPage and LibraryPage; `mediaService.searchMedia` is an unused copy.
- **Tests.** `search.ts` and `searchIndexService` are covered; there are none for
  `getPaginatedCollections` or persons search. Frontend has `SearchPage.test.tsx` (render, navigation, filter toggle only — no
  pagination, selection, or filter-application assertions) and `KeywordFilter.test.tsx`;
  there are no tests for `useQuickSearch`, `useDebouncedValue`, `QuickSearchOverlay`,
  `FilterChips`, `SortControls`, or LibraryPage/CollectionPage quick-search behaviour.

## Opportunities

- **Extract a shared `buildCollectionWhere({ nameFilter, keywordIds, excludedRatings,
  libraryIds })`** used by both the search route and `getPaginatedCollections`, plus a
  shared rating-order constant on the frontend. S–M.
- **Index people as their own entity** (S): the people section is still a `LIKE` on
  `Person.name`; putting them in `search_index` would give it the same prefix, diacritic and
  ranking behaviour, and let it be scoped to the libraries a viewer can see.
- **A merged, ranked result list** (M): collections and media are two lists with two offsets;
  one list ordered by score across both would page correctly and read better.
- **A Header search box** that submits to `/search?q=` (S), now that the page searches live.
- **Offer the library's sort fields on the Search page** by ordering on the denormalised
  `sortReleaseDate` / `sortRating` / `sortRuntime` columns, as the library view already does. S.
- **Broaden `useQuickSearch` key acceptance** to `/\p{L}|\p{N}|[\s'\-:]/u` and add an
  opt-out attribute for components that handle their own keys. S.
- **Tests:** supertest coverage for `GET /api/search` (access filtering, keyword AND,
  rating exclusion, pagination shape), unit tests for `useQuickSearch`/`useDebouncedValue`,
  and SearchPage tests for infinite scroll, selection mode and filter application. M.
