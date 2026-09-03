# User Collections, Favorites, Watch Later & Queue

> Per-user, user-curated groupings of library content. A `UserCollection` is an ordered list of
> references to `Media` rows, library `Collection` rows (shows, seasons, films, albums) or other
> `UserCollection`s, owned by one user. The same table also backs three hidden "system"
> collections per user (`Favorites`, `WatchLater`, `PlaybackQueue`), so favoriting, watch-later
> and the playback queue are all just special-cased user collections. The part exists so that
> users can organise content independently of the scanned library hierarchy and so that the
> player has a server-side queue to advance through.

## Responsibilities

- Persist user-owned collections (`Set` = unordered grid, `Playlist` = ordered, playable list) and
  their items, with a stable integer `position` per item and one-of-three reference columns.
- Enforce ownership on every mutation; allow read access to a collection only to its owner or, if
  `isPublic`, to any authenticated user; list other users' public collections for discovery.
- Lazily create and expose per-user system collections: Favorites, Watch Later, Playback Queue.
- Provide bulk "is X in Favorites / Watch Later" checks so grids can render heart/clock state.
- Provide toggle (add-or-remove) semantics for Favorites and Watch Later, and set/append/clear
  semantics for the Playback Queue.
- Render all of this in the frontend: list/detail pages, drag-and-drop reorder, quick-action
  overlays on cards, an add-to-collection dialog, and a multi-select action bar.
- Feed the in-memory queue in `PlayerContext` so the player can offer next/previous and auto-advance.

## Goals

- **Zero-setup personal lists.** System collections are created on first read
  (`getSystemCollection`, `userCollectionService.ts:415`), so there is no onboarding step and no
  migration to seed rows.
- **One schema for everything list-like.** The commit sequence (d4dc400 -> 84d7bdb -> a67a00e
  -> 70b750e) deliberately folded favorites, watch-later and the queue into `UserCollection`
  rather than adding tables; the short-lived `isFavorites` boolean was replaced within hours by
  the generic `isSystem`/`systemType` pair.
- **Heterogeneous membership.** An item may point at a `Media`, a `Collection` or another
  `UserCollection`; the UI is expected to render mixed grids.
- **Cheap "is it favorited?" reads.** The `/check` endpoints accept comma-separated id lists so
  a library grid does one request per page of cards rather than one per card.
- **Server-side queue.** The queue survives reloads and is shared across tabs because it is a DB
  row, not React state; `PlayerContext` only mirrors it.
- **Low ceremony on the write path.** Every mutation bumps `updatedAt` inside a `$transaction` so
  "most recently used collection" (used by `CardQuickActions` and `SelectionActionBar`) is
  ordering by `updatedAt desc`.

## Components

| File | Role |
|------|------|
| `backend/prisma/schema.prisma:271` | `UserCollectionType` enum (`Set`, `Playlist`). |
| `backend/prisma/schema.prisma:676` | `UserCollection` model: `name`, `description`, `collectionType`, `isPublic`, `isSystem`, `systemType`, owner `userId`. |
| `backend/prisma/schema.prisma:704` | `UserCollectionItem`: `position`, `addedAt`, and nullable `collectionId` / `mediaId` / `itemUserCollectionId`, each with a `@@unique([userCollectionId, <ref>])`. |
| `backend/prisma/migrations/2025120[3-5]*`, `20251211185100_*` | The five migrations that shaped the tables (see History). |
| `backend/src/services/userCollectionService.ts` | All business logic: CRUD, item add/remove/reorder, system-collection helpers, favorites/watch-later/queue. `itemInclude` (line 25) is the single Prisma include shape used for every item response. |
| `backend/src/routes/userCollections.ts` | Express router mounted at `/api/user-collections`; `router.use(authenticate)` at the top. |
| `packages/shared-types/src/index.ts:670-809` | `UserCollection`, `UserCollectionItem`, `UserCollectionItem{Collection,Media,UserCollection}`, request/response types. |
| `frontend/ui/src/api/client.ts:673-800` | `apiClient` methods, one per endpoint. |
| `frontend/ui/src/pages/UserCollectionsPage.tsx` | `/my-collections`: tabs for "mine" and "public", create/delete, favorite-a-collection heart. |
| `frontend/ui/src/pages/UserCollectionPage.tsx` | `/my-collections/:collectionId`: detail view; grid for `Set`, DnD list for `Playlist`; inline edit; Play / Play-from-item. |
| `frontend/ui/src/pages/FavoritesPage.tsx`, `WatchLaterPage.tsx` | `/favorites`, `/watch-later`: near-identical sortable/filterable grids of a system collection. |
| `frontend/ui/src/pages/QueuePage.tsx` | `/queue`: DnD list of the `PlaybackQueue` system collection with play/remove/clear. |
| `frontend/ui/src/components/SortableMediaListItem.tsx` | The shared `@dnd-kit` row (drag handle, 125px landscape thumb, `#n` badge, duration, play/remove) used by QueuePage and Playlist view. |
| `frontend/ui/src/components/AddToCollectionDialog.tsx` | Multi-checkbox dialog to add one item to N collections, with inline create and name/date sort. |
| `frontend/ui/src/components/CreateCollectionDialog.tsx` | Name/description/Set-vs-Playlist toggle/public switch. |
| `frontend/ui/src/components/FavoriteButton.tsx`, `WatchLaterButton.tsx` | Self-fetching toggle icon buttons for a single `collectionId` or `mediaId` (hero views, MediaPage, StandardCollectionView). |
| `frontend/ui/src/components/CardQuickActions.tsx` | Hover overlay (or inline variant for list view) with heart, clock and "+" menu offering the most-recent collection and "Choose..."; state is seeded from props (bulk check) rather than self-fetched. |
| `frontend/ui/src/components/SelectionActionBar.tsx` | Floating bar for multi-select on LibraryPage/SearchPage: "N selected", Select All, add-all-to-collection menu with inline create. |
| `frontend/ui/src/context/PlayerContext.tsx:802-976` | `queue`, `queueIndex`, `refreshQueue`, next/previous resolution, `playNext`/`playPrevious`, auto-advance on `ended`. |
| `frontend/ui/src/components/Sidebar.tsx:102-153`, `Header.tsx:124-148` | Navigation entries for Favorites, Watch Later, Queue, My Collections. |

## How It Works

### Data model

- A `UserCollection` belongs to exactly one `User` (`onDelete: Cascade`). Non-system collections
  have `collectionType` `Set` (default) or `Playlist`; the type is purely a UI hint and nothing on
  the backend behaves differently for it.
- `UserCollectionItem` has three nullable foreign keys and the service enforces "exactly one is
  set" (`addItem`, line 264; `toggleSystemCollectionItem`, line 708). Each FK cascades on delete,
  so deleting a `Media`, `Collection` or the referenced `UserCollection` silently removes the item.
  The three partial unique indexes prevent the same target being added twice to one collection.
- System collections are rows with `isSystem: true` and a free-text `systemType` in
  `{'Favorites','WatchLater','PlaybackQueue'}`. There is no enum and no unique index on
  `(userId, systemType)`; uniqueness relies on `findFirst`-then-`create` in `getSystemCollection`.
  They are excluded from `GET /` and `GET /public` by `isSystem: false` filters but are
  otherwise ordinary rows: `GET /:id`, `PATCH /:id`, `DELETE /:id` and `POST /:id/items` all
  accept a system collection id (the owner check passes), so a user can rename, publish or delete
  their own Favorites; it is recreated empty on the next read.
- `position` is assigned as `max(position)+1` on add and rewritten to `0..n-1` on reorder.
  Deletion leaves gaps, which is harmless because reads always `orderBy: { position: 'asc' }`.

### What a collection can hold and how it is rendered

Items reference `Media` (episodes, films' single media, tracks), library `Collection`s (Show,
Season, Film, Artist, Album, Generic) or other `UserCollection`s. `itemInclude` (service line 25)
shapes every item response: for a media item it pulls the media's primary image plus its parent
collection (with images, `parent` for the show name, and `library` for `libraryType`) and
season/episode or disc/track numbers; for a collection item it pulls primary Thumbnail/Backdrop/
Poster images, `library`, and `media[0].id` (added in 7a46ade / 5cbbd47 so a Film collection is
playable); for a nested user collection it pulls name, description, `_count.items` and owner.

Only Favorites can hold a `UserCollection` reference: the `POST /favorites/toggle` route passes
`userCollectionId` through, `POST /watch-later/toggle` does not, and neither
`AddToCollectionDialog` nor `SelectionActionBar` ever sends one even though `POST /:id/items`
would accept it. Consequently `FavoritesPage` is the only page that renders the third kind
(List icon, "N items" subtitle, navigates to `/my-collections/:id`); `UserCollectionPage` and
`WatchLaterPage` ignore `itemUserCollection` entirely.

Mixed rendering rules the pages agree on: name = `media.name || collection.name`; subtitle =
`Show · SxEy` / `Disc d, Track t` / parent collection name for media, library name for
collections; icon by `media.type` or `library.libraryType`. `Set` grids draw collection items at
2:3 and media at 16:9 (`UserCollectionPage.tsx` grid branch), while Favorites/WatchLater force
2:3 for everything. List rows (Playlist, Queue) prefer landscape images (Thumbnail > Backdrop >
Poster). Each page reimplements these helpers; only the row component is shared.

### Endpoints (`/api/user-collections`, all `authenticate`d)

| Method & path | Service call | Notes |
|---|---|---|
| `GET /` | `getUserCollections` | Own non-system collections, `_count.items`, `updatedAt desc`. |
| `GET /public` | `getPublicCollections(excludeUserId)` | Other users' `isPublic` non-system collections with owner name. |
| `GET /favorites`, `GET /watch-later`, `GET /queue` | `getSystemCollection(userId, type)` | Get-or-create; returns full items. |
| `GET /favorites/check?collectionIds=&mediaIds=&userCollectionIds=` | `checkFavorites` | Returns the subset of ids present. `watch-later/check` has no `userCollectionIds`. |
| `POST /favorites/toggle`, `POST /watch-later/toggle` | `toggleFavorite` / `toggleWatchLater` | Body: one of `collectionId`/`mediaId`(/`userCollectionId`). Returns `{favorited}` / `{inWatchLater}`. 400 on "Exactly one". |
| `PUT /queue` `{items:[{mediaId|collectionId}]}` | `setPlaybackQueue` | Delete-all then create in order, in one transaction. No per-item validation; a bad id fails the whole transaction as a 500. |
| `POST /queue/add` | `addToPlaybackQueue` | Append; silently no-op if already queued. |
| `DELETE /queue` | `clearPlaybackQueue` | Empties; returns the (empty) queue. |
| `GET /:id` | `getCollectionById` | 404 unless owner or public. |
| `POST /` | `createCollection` | 400 if `name` blank; `collectionType` defaults `Set`, `isPublic` defaults false. |
| `PATCH /:id` | `updateCollection` | Owner only (404 otherwise); can change `collectionType` though no UI exposes that. |
| `DELETE /:id` | `deleteCollection` | 204; items cascade. |
| `POST /:id/items` | `addItem` | 400 for duplicate / bad ref / self-reference; 404 if not owner. |
| `DELETE /:id/items/:itemId` | `removeItem` | Verifies the item belongs to `:id`. |
| `PATCH /:id/items/reorder` `{itemIds}` | `reorderItems` | Rewrites `position = index` for each id in a transaction. |

Route order matters: the literal `/favorites`, `/watch-later`, `/queue`, `/public` routes are
declared before `/:id` (`userCollections.ts:32-564`). Errors are mapped to status codes by
substring-matching the thrown `Error.message` (`'not found'`, `'already exists'`, `'Exactly one'`).

### Reorder integrity

`reorderItems` (line 369) checks that the caller owns the collection but does **not** check that
each `itemId` belongs to it, that the list is complete, or that ids are unique. A partial list
leaves the omitted items at their old positions (possible duplicates until the next full
reorder), and an id from someone else's collection would have its position rewritten. The
frontend always sends the full id list after `arrayMove`, and updates state optimistically before
awaiting the response (`UserCollectionPage.tsx` `handleDragEnd`); a failed request leaves the
optimistic order on screen.

### Favorites and Watch Later in the UI

- `FavoriteButton`/`WatchLaterButton` each fire their own `/check` on mount, so a page with
  both does two requests; `CardQuickActions` instead receives `initialFavorited`/`initialInWatchLater`
  from a bulk check done by the parent (`LibraryPage.tsx:182`, `ShowHeroView.tsx:156`) and keeps
  local state after toggling. There is no shared cache, so toggling on one component does not
  update another instance showing the same item.
- `FavoritesPage`/`WatchLaterPage` remove an item by calling the *toggle* endpoint, then only
  prune local state if the response says it is now absent.
- Favoriting a user collection (e55451d) is exposed on `UserCollectionsPage` cards (own and
  public) and on `UserCollectionPage`; it stores an `itemUserCollectionId` in Favorites. Adding
  a system collection to itself is blocked (`'Cannot add a collection to itself'`).

### Playback queue: server row + client mirror

The queue **is persisted server-side** as the `PlaybackQueue` system collection; `PlayerContext`
never writes it. The flow:

1. "Play" on `MediaPage`/`CollectionPage`/`LibraryPage` calls `setPlaybackQueue([{mediaId}])`
   (replacing the queue with that one item) then navigates to `/play/:id`. "Play after current"
   calls `addToPlaybackQueue`. "Play" or a row's play button on a `Playlist` in
   `UserCollectionPage` sets the queue to every playable item of the playlist in stored order
   (Film collection items resolve to `collection.media[0].id`), then plays the clicked one; on a
   `Set` it uses the current sort order.
2. `PlayPage` calls `refreshQueue()` on mount (`PlayPage.tsx:64`), which `GET /queue`s into
   `PlayerContext.queue`. `UserCollectionPage` and `QueuePage` call it after their writes.
3. An effect (`PlayerContext.tsx:815-947`) locates `currentMedia` in the queue by media id, sets
   `previousItem` to the queue neighbour, and `nextItem` to the next queue item; if there is
   none and the media is an episode it falls back to fetching the season (and next season) to
   find the next episode. `playNext`/`playPrevious`, the skip buttons in `VideoControls`, the
   `UpNextPopup` ("From queue") and the auto-advance on the video `ended` event all use these.
4. Items are never consumed: playing does not remove queue entries, so the queue behaves like a
   playlist cursor, not a FIFO.

`QueuePage` reorders and removes by re-sending the whole list to `PUT /queue`, filtering to
`mediaId` only, so any `collectionId` entries (which `PUT /queue` and `/queue/add` accept) are
dropped the first time the user reorders or removes. `PlayerContext` likewise only considers
`item.media` when computing next/previous.

### Multi-select add

`LibraryPage` and `SearchPage` maintain selected id sets and render `SelectionActionBar`, which
fans out one `POST /:id/items` per selected id, treats `'already exists'` errors as success and
otherwise silently keeps the menu open (no error surfaced). Same pattern in
`AddToCollectionDialog`, which does surface non-duplicate errors.

## Interactions

- **Depends on:** [Auth & Users](auth-and-users.md) for `authenticate` and `req.user.userId`
  (every ownership check keys on it; user deletion cascades all collections);
  [Content Model](content-model.md) for `Media`/`Collection` rows and the `CollectionType` and
  `LibraryType` values used to pick icons and playability; [Images](images.md) for primary
  images and `apiClient.getImageUrl`; [Frontend App](frontend-app.md) for routing (`App.tsx:49-53`),
  Sidebar/Header entries, `SortControls`/`FilterChips`, i18n keys `favorites.*`, `watchLater.*`,
  `queue.*`, `userCollections.*`, `selection.*`.
- **Used by:** [Playback](playback.md) — `PlayerContext` reads the queue to drive next/previous
  and auto-advance; `PlayPage`, `VideoControls`, `UpNextPopup`, `MiniPlayer` consume that state.
  [Libraries & Scanning](libraries-and-scanning.md) and [Search](search.md) pages host
  `CardQuickActions`, `SelectionActionBar` and `AddToCollectionDialog`.
- **Shared data:** Prisma `UserCollection`, `UserCollectionItem` (read/write); reads `Media`,
  `Collection`, `Image`, `VideoDetails`, `AudioDetails`, `Library`, `User` via includes. No queues,
  no config keys, no Redis. `localStorage` is used by `PlayerContext` only for quality level and
  mini-player position, never for the queue.
- **Not integrated with:** [Streaming & Transcoding](streaming-and-transcoding.md),
  [Metadata Scraping](metadata-scraping.md), [Configuration](configuration.md),
  [Deployment](deployment.md). Search does not index user collections.

## History

- `d4dc400` 2025-12-03 — Initial `UserCollection`/`UserCollectionItem` tables (media + collection refs), service, routes, `AddToCollectionDialog`, `CreateCollectionDialog`, list/detail pages, quick-add on film hero.
- `84d7bdb` 2025-12-04 — Favorites: first as an `isFavorites` boolean, replaced the same day by `isSystem`/`systemType`; `FavoriteButton`, `FavoritesPage`, `/favorites*` routes.
- `a67a00e` 2025-12-04 — Watch Later as a second system type; generic `checkSystemCollectionItems`/`toggleSystemCollectionItem` helpers; `WatchLaterButton`, `WatchLaterPage`.
- `ae3a327` 2025-12-04 — `CardQuickActions` overlay, sort/filter on `UserCollectionPage`, "+" menus on Show/Season/Media pages.
- `70b750e` 2025-12-04 — `PlayerContext` and mini player; `PlaybackQueue` system type and `/queue*` routes added alongside.
- `e55451d` 2025-12-04 — `itemUserCollectionId` column; Favorites may contain user collections; hearts on collection cards.
- `0d41baf` 2025-12-05 — Page tests for Favorites/WatchLater/UserCollection(s) pages.
- `42bbba0` 2025-12-07 — `QueuePage` with sidebar link.
- `4c3a261` 2025-12-07 — `CardQuickActions` inline variant for list view.
- `8ec0361` 2025-12-10 — `@dnd-kit` added; QueuePage converted to reorderable list (`MediaListItem`).
- `7a46ade` 2025-12-10 — Queue rows show show name for episodes; Film items get `media[0]` and navigate to the film collection.
- `914fd5d` 2025-12-11 — `collectionType` enum (`Set`/`Playlist`) with migration; type picker in create dialog.
- `5cbbd47` 2025-12-13 — `SortableMediaListItem` extracted and shared; Playlist view with DnD and per-row play in `UserCollectionPage`; "Play" sets the queue from a playlist; previous-track navigation.
- `a27f5f8` 2025-12-13 — `SelectionActionBar`; multi-select on LibraryPage; landscape images in list rows.
- `6830b9a` 2025-12-14 — Multi-select and Select All on SearchPage.

## Known Limitations

- **Sharing is read-only visibility, not collaboration.** `isPublic` lets any authenticated user
  view a collection and favorite it; there is no per-user/group sharing, no collaborative editing,
  and no "copy to my collections". Public collections are also not filtered by library access:
  `getCollectionById` returns item names and image ids regardless of which libraries the viewer
  can see.
- **No watch history / continue watching / progress.** Nothing records that an item was played or
  where; Watch Later is a manual list, and the queue is not consumed on playback.
- **Set vs Playlist is UI-only.** The backend never reads `collectionType`; a `Set` still has
  positions and can be reordered via the API, and `PATCH` can flip the type silently.
- **Reorder trusts the client** (see *Reorder integrity*): no membership/completeness check on
  `itemIds`, and the optimistic UI is not rolled back on failure.
- **Queue reorder/remove drop non-media entries**, and `PUT /queue` performs no validation
  (missing "exactly one" check, no existence check) so a malformed body yields a 500 mid-transaction.
- **System collections are not protected**: their ids are returned by `GET /favorites` etc. and
  the generic `PATCH`/`DELETE`/`POST /:id/items` routes accept them. `systemType` is a free-text
  string without a unique `(userId, systemType)` index, so a race on first access can create two
  Favorites rows for one user.
- **Nested user collections are second-class**: only the Favorites toggle can add them, only
  `FavoritesPage` renders them, `UserCollectionPage` would show them as "Unknown" and the
  self-reference check does not detect cycles deeper than one level.
- **N+1 status checks**: every `FavoriteButton`/`WatchLaterButton` instance fires its own
  `/check` request on mount, and there is no client-side cache, so two buttons for the same item
  on one page can disagree after a toggle.
- **Error handling by message substring** in the routes; any new service error text falls
  through to 500. `SelectionActionBar` swallows failures without feedback.
- **Duplication**: `FavoritesPage` and `WatchLaterPage` differ by ~40 lines out of ~380;
  `FavoriteButton`/`WatchLaterButton` are the same component with icons swapped; the
  image/name/subtitle/icon/type helpers are copy-pasted across `UserCollectionPage`,
  `FavoritesPage`, `WatchLaterPage` and `QueuePage`; the sort/filter block is duplicated three times.
- **Tests**: no backend tests for `userCollectionService` or the routes (backend `__tests__`
  covers only `authService` and `mediaParser`). Frontend has page tests for the four collection
  pages and dialog tests, but none for `QueuePage`, `FavoriteButton`, `CardQuickActions`,
  `SelectionActionBar`, `SortableMediaListItem`, the DnD reorder paths, or the queue logic in
  `PlayerContext` (its test file has no queue cases).

## Opportunities

- **Backend unit/integration tests for `UserCollectionService`** (ownership, exactly-one
  validation, toggle idempotency, reorder, system-collection get-or-create). Highest-value gap;
  the service is 780 lines with zero coverage. (M)
- **Harden `reorderItems`**: verify all `itemIds` belong to the collection, are unique, and cover
  the full set (or renumber the remainder); roll back optimistic state on error in the UI. (S)
- **Add `@@unique([userId, systemType])`** plus a `SystemCollectionType` enum, and reject
  `PATCH`/`DELETE`/`POST /:id/items` on `isSystem` rows (or route them through the toggle
  helpers). (S)
- **Validate `PUT /queue` items** the same way `addItem` does, and decide whether the queue may
  hold collections at all; if not, reject `collectionId` there and in `/queue/add` so
  `QueuePage`'s media-only filter stops being lossy. (S)
- **Extract a `SystemCollectionPage`** parameterised by system type, and a single
  `ToggleIconButton` for Favorite/WatchLater; move `getItemImage/Name/Subtitle/Icon/Type` into
  `utils/userCollectionItem.ts` and reuse across the four pages and the row component. (M)
- **Client-side favorites/watch-later store** (context keyed by id, hydrated by bulk `/check`)
  so all buttons for one item stay in sync and hero pages stop double-fetching. (M)
- **Library-access filtering on public collections** once library ACLs are enforced elsewhere:
  filter `items` in `getCollectionById` by the viewer's accessible libraries. (M)
- **Queue semantics**: consume-on-play (or a `currentIndex` on the queue row) and "Play next"
  (insert after current) alongside "Play after current" (append); the data model already supports
  both with `position`. (M)
- **Watch history / continue watching** would fit as further system types
  (`History`, `InProgress`) if items gained a `progress` column, reusing all existing plumbing;
  the product gap is visible in the fact that Watch Later is the only "what to watch" surface. (L)
- **Nested collections properly**: let `AddToCollectionDialog` add a user collection to a `Set`,
  render `itemUserCollection` in `UserCollectionPage`, and add cycle detection. (M)
- **Typed error classes** in the service (`NotFoundError`, `ValidationError`) instead of message
  substring matching in the router. (S)
- **Frontend tests** for `QueuePage`, `CardQuickActions`, `SelectionActionBar`, DnD reorder
  (mock `@dnd-kit` `onDragEnd`), and `PlayerContext` next/previous/auto-advance. (M)
