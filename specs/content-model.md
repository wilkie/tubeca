# Content Model: Collections, Media, Details & People

> The content model is the Prisma/SQLite schema that represents everything in a user's library
> (libraries, the collection tree, media files with probed stream info, per-type detail tables,
> credits, keywords, people and images) plus the three services and route modules that read and
> mutate it directly. It exists so that scanning, scraping, browsing, search, playback and user
> collections all share one normalised representation of "what content do we have and what do we
> know about it".

## Responsibilities

- Define the persistent shape of library content: `Library` -> `Collection` tree -> `Media`, with
  a `collectionType` discriminator (`Generic|Show|Season|Film|Artist|Album`) and a `MediaType`
  discriminator (`Video|Audio`).
- Hold scraped metadata in one-to-one detail tables (`ShowDetails`, `SeasonDetails`, `FilmDetails`,
  `ArtistDetails`, `AlbumDetails` for collections; `VideoDetails`, `AudioDetails` for media) and
  their per-type credit tables (`ShowCredit`, `FilmCredit`, `Credit`, `AlbumCredit`, `ArtistMember`).
- Hold probed technical stream info per file (`MediaStream`: codec, language, channels, resolution).
- Link credits across works through a single `Person` row keyed by TMDB/TVDB/IMDB ids, and expose a
  person's filmography (shows, films, episodes).
- Tag collections with many-to-many `Keyword`s for filtering.
- Serve the read API used by the browse pages: paginated/sorted/filtered library listing, full
  collection detail, full media detail, person detail.
- Serve the write API for editors: create/rename/re-parent/delete collections, delete media, queue
  metadata/image refreshes, and manually "identify" a Show/Film against a scraper result.
- Remove image files from disk when a collection or media row is deleted (the DB side is cascade).
- Publish the API-facing TypeScript shapes in `@tubeca/shared-types` so the frontend consumes the
  same field names as the schema.

## Goals

- **One tree for every library type.** A single self-referential `Collection` table with a type
  enum, rather than separate Show/Season/Film tables, so the scanner can map folder depth to type
  (`libraryScanWorker.ts:212-223`) and the UI can render any node generically.
- **Cheap listing, rich detail.** The list endpoint selects only what cards need (primary poster,
  counts, a handful of sortable fields); the detail endpoint eagerly loads everything the page
  renders in one query (children with first-episode hints, media with credits and person photos,
  all detail tables, keywords, all images).
- **Scraper-agnostic metadata.** Every detail table stores `scraperId` + `externalId` so refreshes
  and Identify can re-target the same provider without re-searching.
- **People are first-class.** Commit `a3f2f55` introduced `Person` specifically so the same actor
  shown on a film, a show and an episode resolves to one page; matching prefers stable external
  ids over names (`personService.ts:87-136`).
- **Deletes leave no orphans on disk.** Both delete paths walk images (including credit photos)
  and unlink files before letting Prisma cascade the rows.
- **Filterable browsing without a search engine.** Keyword AND-filtering, content-rating
  exclusion, substring name filter and five sort fields are all expressed in Prisma `where`/`orderBy`
  on SQLite, with in-memory fallback where Prisma cannot order by a relation.

## Components

| File | Role |
|------|------|
| `backend/prisma/schema.prisma` | All models and enums; the source of truth for this part (725 lines). |
| `backend/prisma/migrations/*` | 23 SQLite migrations, Nov 28 - Dec 19 2025 (listed in History). |
| `backend/src/services/collectionService.ts` | Paginated listing, keyword listing, detail fetch, create/update (with cycle check), delete with image cleanup. |
| `backend/src/services/mediaService.ts` | Media CRUD, detail fetch, delete with image cleanup, thin wrappers that enqueue video jobs. |
| `backend/src/services/personService.ts` | `findOrCreatePerson` id-merging, filmography assembly, metadata update, name search. |
| `backend/src/types/media.ts` | `Video`/`Audio` narrowed types and `isVideo`/`isAudio` guards over the STI `Media` row. |
| `backend/src/routes/collections.ts` | `/api/collections/*` (11 endpoints incl. Identify and scraper search). |
| `backend/src/routes/media.ts` | `/api/media/*` (7 endpoints incl. scraper list/search/queue-status). |
| `backend/src/routes/persons.ts` | `/api/persons/*` (3 endpoints; GET lazily fetches biography). |
| `packages/shared-types/src/index.ts` | API-facing mirrors of the schema (`Collection`, `Media`, `*Details`, `*Credit`, `Person*`, `Keyword`, `Image`, `MediaStream`). |
| `frontend/ui/src/api/client.ts:440-640` | `getCollectionsByLibrary`, `getCollection`, `getMedia`, `getPerson`, `identifyCollection`, etc. |
| `frontend/ui/src/pages/{LibraryPage,CollectionPage,MediaPage,PersonPage}.tsx` | Primary consumers (see [Frontend App](frontend-app.md)). |

## How It Works

### Schema shape

- **Library** (`name`, `path`, `libraryType`, `watchForChanges`, `groups[]`) owns `collections[]`;
  deleting a library cascades to its collections (`schema.prisma:44`).
- **Collection** has `libraryId` (cascade), optional `parentId` (self-relation, cascade), a
  `collectionType` defaulting to `Generic`, five optional one-to-one detail relations, `media[]`,
  `images[]`, `keywords[]` (implicit join table `_CollectionToKeyword`) and `userCollectionItems[]`.
  Indexed on `libraryId`, `parentId`, `collectionType`. There is no uniqueness constraint on
  `(libraryId, parentId, name)`; the scanner de-duplicates with `findFirst` before create
  (`libraryScanWorker.ts:436-450`).
- **Media** is single-table inheritance: `path`, `duration Int` (seconds, from ffprobe), `name`,
  `type`, optional `thumbnails` (trickplay folder path), `collectionId` with **`onDelete: SetNull`**
  (`schema.prisma:107`). Indexed on `type` and `collectionId`. `path` is not unique; the scanner and
  file watcher look up by `findFirst({ where: { path } })`.
- **MediaStream** one row per ffprobe stream, `@@unique([mediaId, streamIndex])`, cascade on media.
- **Detail tables** all share the pattern `collectionId @unique` (or `mediaId @unique`), cascade
  delete, nullable `scraperId`/`externalId` with a composite index. `FilmDetails` is the widest
  (tagline, runtime, contentRating, rating Float, genres as a comma-separated string, budget,
  revenue). `VideoDetails` carries episode context (`showName`, `season`, `episode`) plus
  `rating String` (a content rating, unlike the `Float` average on Film/Show).
- **Credits** exist in four flavours because each hangs off a different details table:
  `ShowCredit`, `FilmCredit`, `Credit` (episodes, off `VideoDetails`), `AlbumCredit`. The first
  three share `name/role/creditType/order/personId` and their own `images[]`; `AlbumCredit` has no
  `creditType`, `order` or images. `ArtistMember` is a separate band-membership table.
- **Person** has nullable `@unique` `tmdbId`, `tvdbId`, `imdbId` and an index on `name` (not
  unique). Credit rows point at it with `onDelete: SetNull`, so deleting a person keeps the credit
  text.
- **Keyword** has a `@unique name` and a redundant `@@index([name])` (migration
  `20251202224452` creates both `Keyword_name_key` and `Keyword_name_idx`).
- **Image** is polymorphic: six nullable FK columns (`mediaId`, `collectionId`, `showCreditId`,
  `filmCreditId`, `creditId`, `personId`), all cascade, with `imageType`, `isPrimary` and source
  tracking. Owned by [Images](images.md); referenced here because every read query filters on
  `{ isPrimary: true, imageType: 'Poster' }` etc.
- **No watch-progress or playback-state table exists.** The only user state that references
  content is `UserCollectionItem` (favorites, watch-later, queue), which cascades on collection
  and media delete and is owned by [User Collections](user-collections.md).

### Type assignment

The scanner maps folder depth to `collectionType` per library type
(`libraryScanWorker.ts:212-223`): Television `0->Show, 1->Season, else Generic`; Music
`0->Artist, 1->Album`; Film `0->Film`. Anything deeper is `Generic`. The file watcher applies the
same rule (`fileWatcherService.ts:543-560`). `createCollection` from the API does **not** accept a
type, so manually created collections are always `Generic` (`collectionService.ts:447-452`).

### Listing a library (`GET /api/collections/library/:libraryId`)

Query params: `page` (1-based, default 1), `limit` (default 50), `sortField`
(`name|dateAdded|releaseDate|rating|runtime`), `sortDirection`, `excludedRatings` (CSV of
`FilmDetails.contentRating` values), `keywordIds` (CSV; collection must have **all**), `nameFilter`
(substring; SQLite `LIKE` is case-insensitive for ASCII). Response
`{ collections, total, page, limit, hasMore }`; `hasMore = skip + returned < total`, which
`LibraryPage.tsx:300-326` feeds to an `IntersectionObserver` for infinite scroll.

Flow (`collectionService.ts:103-286`):

1. Build `where`: `libraryId`, `parentId: null` (root nodes only), optional name `contains`,
   optional `OR` of `[filmDetails null | contentRating null | contentRating notIn]`, optional
   `AND` of one `keywords.some` clause per id.
2. `count()` then `findMany()` with the card projection (children ids, parent, first primary
   poster, `_count`, sortable fields from show/film/album details, keywords).
3. `name` and `dateAdded` sort in SQL. `releaseDate`, `rating` and `runtime` fall back to
   `createdAt` in SQL and then **sort the returned page in memory**
   (`collectionService.ts:161-178, 242-277`), coalescing film -> show -> album values and pushing
   nulls last.

`GET /library/:libraryId/keywords` returns keywords used by any collection in the library.

### Collection detail (`GET /api/collections/:id`)

One `findUnique` with a large `include` (`collectionService.ts:288-421`): library summary,
parent summary, children (each with primary poster and its media's `videoDetails.episode` so the
Show hero can find the first episode), media (with `videoDetails` credits -> person -> primary
photo, `audioDetails` track/disc, one primary image), all five detail relations with credits and
person photos, keywords and **all** images. Children and media are ordered by `name`, so episode
order depends on filenames sorting correctly.

### Mutations on collections

- `POST /api/collections` (Editor): `{ name, libraryId, parentId? }`; verifies library and that the
  parent belongs to the same library. Returns 201.
- `PATCH /api/collections/:id` (Editor): `{ name?, parentId? }`; rejects self-parenting and walks
  the ancestor chain one `findUnique` at a time to detect cycles
  (`collectionService.ts:497-508`). 404 on missing, 400 on validation.
- `DELETE /api/collections/:id` (Editor): loads the collection's own media (with images and credit
  images) and the collection with its detail/credit images, unlinks each file under the image
  storage path (removing the directory if now empty), then `media.deleteMany({ collectionId })`
  and `collection.delete()`. Returns 204; every failure, including not-found, is a 500.
- `POST /:id/refresh-metadata` and `POST /:id/refresh-images` (Editor): read the stored
  `scraperId`/`externalId` from whichever details row exists and enqueue a collection scrape job
  with `skipImages` or `imagesOnly` respectively (202 with `jobId`).
- `POST /api/collections/search`: `{ query, type: 'Show'|'Film', year? }`; fans out to every
  configured video scraper (`searchSeries` / `searchVideo`) and concatenates results tagged with
  `scraperId`. Used by the Identify dialog.
- `POST /:id/identify` (Editor, `collections.ts:730-799`): `{ externalId, scraperId }`; only
  Show/Film. Deletes the collection's `Image` **rows** (`image.deleteMany`), upserts the
  `showDetails`/`filmDetails` row with the new ids, and enqueues a scrape with those ids (images
  included). The route talks to Prisma directly rather than through the service.

### Media endpoints

- `GET /api/media/:id`: `findUnique` with collection (+ primary backdrop, parent + backdrop,
  library), all images, streams ordered by type then index, `videoDetails` credits -> person ->
  photo, `audioDetails`.
- `DELETE /api/media/:id` (Editor): same file-unlink pattern as collections, then `media.delete`
  (cascades `VideoDetails`, `Credit`, `MediaStream`, `Image`, `UserCollectionItem`). 404 on
  not-found, 204 on success.
- `POST /:id/refresh-metadata` (Editor): optional `{ scraperId, externalId }`; passes
  `showName/season/episode` from `videoDetails` so episode scrapes can resolve the parent show.
- `POST /:id/refresh-images` (Editor): enqueues `imagesOnly`; it cannot pass ids because
  `VideoDetails` has no `scraperId`/`externalId` columns (dead `if (media.videoDetails) {}` at
  `media.ts:219-222`).
- `GET /scrapers/list`, `GET /scrapers/queue-status` (Admin), `GET /scrapers/search?query&type&scraperId`
  are scraper plumbing that happens to live in this router; see [Metadata Scraping](metadata-scraping.md).

### Person endpoints and filmography

- `GET /api/persons/:id` (`persons.ts:46-121`): loads the person; if `biography` is null and a
  TMDB/TVDB id exists, synchronously calls the scraper's `getPersonMetadata`, updates the row,
  downloads a photo if none exists, and re-reads. A first visit to a person page therefore
  performs network I/O inside the request.
- `GET /api/persons/search?q=`: name `contains`, limit 20. **Shadowed**: `router.get('/:id')` is
  registered first, so `/search` resolves to `getPersonById('search')` and returns 404. The
  client method `searchPersons` exists but nothing in the UI calls it.
- `POST /:id/refresh` (Editor): same scraper fetch as the lazy path, 404 if no scraper returns data.

`getPersonById` (`personService.ts:170-352`) issues four queries (person, `showCredit`,
`filmCredit`, `credit`) and assembles `filmography.{shows,films,episodes}`. Films borrow the first
media row of the film collection as the playable target (`media[0]`, else `{ id: '', name }`);
episodes pick thumbnail -> backdrop -> poster -> collection poster.

`findOrCreatePerson` (`personService.ts:87-136`) is called once per credit by the scrape workers:
lookup by `imdbId`, then `tmdbId`, then `tvdbId`, then **exact name**, else create; a match
back-fills any missing external ids.

### Writers outside this part

The services above own reads and deletes; most rows are written elsewhere:
`libraryScanWorker.ts` / `fileWatcherService.ts` create collections, media and streams;
`collectionScrapeWorker.ts` upserts show/season/film details, replaces credits
(`deleteMany` then one `create` per credit), and connects keywords (`saveKeywords`, upsert +
connect per keyword, never disconnect); `metadataScrapeWorker.ts` / `scraperService.ts` upsert
video/audio details and episode credits; `videoWorker.ts` updates `Media.thumbnails`.
`ArtistDetails`, `AlbumDetails`, `AlbumCredit` and `ArtistMember` have **no writer** anywhere
(`collectionScrapeWorker.ts:225` returns "Album scraping not yet implemented").

### Shared types vs schema

`packages/shared-types/src/index.ts:174-364, 411-509, 547-651` mirror the models field-for-field
with `DateTime` -> `string`. Differences worth knowing:

- `Collection.media` is typed as `MediaSummary` (id, name, type, season/episode, track/disc) but
  the detail query also returns `duration`, `description`, `releaseDate`, `rating`, `credits` and
  `images`; the frontend reads those through local casts.
- `Image` omits `filmCreditId`, which exists in the schema.
- `PersonWithFilmography` is declared twice: in `personService.ts:5-80` and in shared-types
  `632-643`, with `collectionType`/`creditType`/`imageType` widened to `string`.
- `CreateCollectionInput`/`UpdateCollectionInput` are also declared twice (service and shared
  types) with identical shapes.
- Backend `Video`/`Audio` (`types/media.ts`) are Prisma-row narrowings; shared-types has no
  per-type media interface, only `Media` with nullable `videoDetails`/`audioDetails`.

## Interactions

- **Depends on:** [Auth & Users](auth-and-users.md) for `authenticate`/`requireRole` on every
  route; [Images](images.md) for `ImageService.downloadAndSaveImage` (person photos) and the
  storage path used when unlinking files; [Metadata Scraping](metadata-scraping.md) for
  `scraperManager` (Identify search, person metadata) and the `collectionScrapeQueue` /
  `metadataScrapeQueue` producers; [Configuration](configuration.md) for `getImageStoragePath`.
- **Used by:** [Libraries & Scanning](libraries-and-scanning.md) (creates the rows this part
  reads); [Metadata Scraping](metadata-scraping.md) (writes every details/credit/keyword table and
  calls `PersonService.findOrCreatePerson`); [Search](search.md) (re-implements the same keyword
  and rating filters directly on `prisma.collection`/`prisma.media`, with library-access
  filtering this part lacks); [Streaming & Transcoding](streaming-and-transcoding.md) and
  [Playback](playback.md) (`MediaService.getVideoById`, `MediaStream` rows for track selection,
  `Media.thumbnails` for trickplay); [User Collections](user-collections.md) (FK targets
  `Collection`/`Media`); [Frontend App](frontend-app.md) (LibraryPage, CollectionPage, MediaPage,
  PersonPage, IdentifyDialog).
- **Shared data:** reads/writes `Library`, `Collection`, `Media`, `MediaStream`, `VideoDetails`,
  `AudioDetails`, `ShowDetails`, `SeasonDetails`, `FilmDetails`, `ArtistDetails`, `AlbumDetails`,
  `ShowCredit`, `FilmCredit`, `Credit`, `AlbumCredit`, `ArtistMember`, `Person`, `Keyword`,
  `_CollectionToKeyword`, `Image` (delete only). Enqueues on `collectionScrapeQueue`,
  `metadataScrapeQueue`, `videoQueue`. Reads the image storage path from `tubeca.config.json`.

## History

Commits touching the schema, migrations, the three services/routes and shared types:

- `4946f1d` 2025-11-28 Initial commit: `User` only (`20251128023525_init`).
- `5282cf0` 2025-11-28 Libraries, collections, library scan; migrations `add_media_model`,
  `add_user_auth_and_roles`, `add_user_groups`, `remove_user_email`, `add_library_model`.
- `dd02263` 2025-11-28 Basic streaming; `add_video_thumbnails` adds `Media.thumbnails`.
- `41cf2f0` 2025-11-29 Scrapers and metadata; `add_media_details` (Video/AudioDetails, Credit),
  `add_collection_type` (enum + indexes), `add_collection_details` (Show/Season/Artist/Album
  details and credits).
- `b3fb3ee` 2025-11-29 Image scraping; `add_image_storage` (polymorphic `Image`).
- `78ab1ff` 2025-11-29 Credit/season/episode images shown in containing views.
- `a3f2f55` 2025-11-30 People listing and cross-work linking; `add_person_entity`,
  `personService`, `/api/persons`.
- `78254a5` 2025-11-30 Stream probing and audio track switching; `add_media_streams`.
- `3404584` 2025-11-30 Image dialog and metadata refresh endpoints.
- `d7d4c32` 2025-12-01 File watcher; `add_watch_for_changes` on `Library`.
- `d9c9154` 2025-12-01 Fix person pages listing film media as episodes (filmography split).
- `322f4ef`, `d37f069` 2025-12-01 Hero banners for collections/shows (detail query grows).
- `ac951c2` 2025-12-02 Fix film media names.
- `a52dbe1` 2025-12-02 `FilmDetails` and `Keyword` (`add_film_details`, `add_keywords`).
- `f7f96fd` 2025-12-02 Library sorting; fix film user ratings.
- `fc8e567` 2025-12-03 Search page (parallel query logic in `routes/search.ts`).
- `a801620` 2025-12-03 User collections (`add_user_collections`; FK back-relations on
  `Collection`/`Media`).
- `d98b923`, `775a6e9`, `7685e01`, `3d28f43`, `a67dcbf` 2025-12-04 Favorites, watch-later,
  sorting/filtering across views, mini player and person filmography fix, favoriting user
  collections (three migrations on `UserCollection`).
- `68439dd` 2025-12-05 Keyword/tag filtering with collapsible panel (`keywordIds`, `/keywords`).
- `482f7af` 2025-12-05 Infinite scroll; `getPaginatedCollections` with `hasMore`.
- `33b11fc` 2025-12-07 List view mode.
- `8143c03`, `62dc88f` 2025-12-10 Library group access control (search only) and quick search
  (`nameFilter`).
- `5d8d37c` 2025-12-10 Queue page display for films and episodes.
- `6184e8d` 2025-12-11 `add_user_collection_type` (Set/Playlist).
- `62dafea` 2025-12-13 Shared playlist component, play button.
- `b088bdc` 2025-12-15 Identify feature (`POST /search`, `POST /:id/identify`, `IdentifyDialog`).
- `b6003ef`, `0fc5947` 2025-12-16/19 `TranscodingSettings` table (`add_transcoding_settings`,
  `add_max_concurrent_transcodes`); last schema change to date.

## Known Limitations

- **No library access enforcement on content routes.** `collections.ts`, `media.ts` and
  `persons.ts` only require authentication; any Viewer can fetch any collection or media by id
  regardless of group membership. Only `routes/search.ts:104-118` and the libraries list apply the
  group filter.
- **Sort by releaseDate/rating/runtime is per-page only.** SQL orders by `createdAt`, then the
  50-item page is sorted in memory (`collectionService.ts:242-277`), so infinite scroll shows
  each page internally sorted but globally unordered.
- **Deleting a Show orphans season content.** `deleteCollection` only handles the target's own
  media and images. Child Seasons are removed by DB cascade, but their `Media` rows survive with
  `collectionId = null` (`onDelete: SetNull`), and season/episode image files stay on disk.
- **Identify leaks image files.** `/:id/identify` deletes `Image` rows with `deleteMany` but never
  unlinks the files; the rows' `path`s are lost.
- **Identify does not clear keywords or stale details.** `saveKeywords` only connects; a film
  re-identified as a different film keeps the old film's keywords. Detail fields not returned by
  the new scrape keep their previous values (upsert with partial data).
- **`GET /api/persons/search` is unreachable** because `/:id` is registered first
  (`persons.ts:46` vs `:153`).
- **Person merging by exact name** (`personService.ts:120-125`) conflates distinct people with
  the same name when a scraper omits external ids, and the back-filled ids then stick.
- **N+1 in scrape write paths that this part owns the tables for:** credits are inserted one
  `create` per row after a `deleteMany` (`collectionScrapeWorker.ts:318-348`,
  `metadataScrapeWorker.ts:299-330`), each preceded by up to four `Person` lookups and an
  `image.findFirst`; keywords are an upsert plus a `collection.update` per keyword.
- **Cycle check is O(depth) queries** (`collectionService.ts:497-508`) and not transactional, so a
  concurrent re-parent can still create a cycle.
- **`Media.path` and `Collection (libraryId, parentId, name)` are not unique**, so a scan racing
  the file watcher can create duplicates; the DB will not stop it.
- **Person detail does network I/O on GET** (`persons.ts:53-115`), so a cold person page blocks on
  TMDB/TVDB latency and fails silently to a bare record on error.
- **Genres and keywords are strings.** `genres` is a comma-separated column on four tables and is
  not filterable; only keywords got a join table.
- **Music detail tables are unwritten.** `ArtistDetails`/`AlbumDetails`/`AlbumCredit`/`ArtistMember`
  exist in the schema and shared types but no scraper or service populates them.
- **Media names are the sort key for episodes** (`orderBy: { name }` in the detail query), not
  `videoDetails.season/episode`, so "Episode 10" sorts before "Episode 2" unless zero-padded.
- **Backend tests: none** for `collectionService`, `mediaService`, `personService` or any of the
  three routers (`backend/src/services/__tests__` holds only `authService.test.ts`). The
  frontend has page tests for CollectionPage, MediaPage and PersonPage only.
- Shared-type drift: `Image` lacks `filmCreditId`; `Collection.media` under-types what the detail
  endpoint returns; `PersonWithFilmography` and `Create/UpdateCollectionInput` are duplicated.
- Dead code: `getCollectionsByLibrary`, `searchMedia`, `processMedia`, `updateMedia`,
  `getPersonByExternalId` have no callers.

## Opportunities

- **Enforce library access in `collections.ts`/`media.ts`** by reusing
  `libraryService.getAccessibleLibraries` (or a middleware that resolves the row's `libraryId`);
  the search route already has the pattern. (M)
- **Fix `/persons/search` ordering**: register `/search` before `/:id`. One-line move. (S)
- **Push relation sorts into SQL**: either denormalise `releaseDate`/`rating`/`runtime` onto
  `Collection` (updated by the scrape workers) or use `orderBy: { filmDetails: { releaseDate } }`
  with nulls-last, so pagination is globally ordered. (M)
- **Make `deleteCollection` recursive**: collect descendant collection ids, delete their media via
  `mediaService.deleteMedia` semantics, unlink all image files, then delete the root. Also route
  not-found to 404 instead of 500. (M)
- **Unlink files in Identify** by calling the existing image-deletion helper before
  `image.deleteMany`, and `set: []` on keywords so re-identification starts clean. (S)
- **Batch credit and keyword writes**: resolve persons first (one `findMany` on the id set), then
  `createMany` credits and a single `collection.update({ keywords: { connect: [...] } })`. (M)
- **Add `@@unique([libraryId, parentId, name])` on `Collection` and `@unique` on `Media.path`**,
  with the scanner switched to `upsert`. Requires a data-dedupe migration on SQLite (table
  rebuild). (M)
- **Order episodes by `videoDetails.season, episode`** in `getCollectionById` and fall back to
  name; the data is already loaded. (S)
- **Move person auto-fetch off the request path**: enqueue a person-scrape job on first view and
  return the stub immediately, or fetch persons at credit-link time in the workers. (M)
- **Extract the duplicated `deleteImageFile` helper** (`collectionService.ts:596-610`,
  `mediaService.ts:166-180`) into `imageService`, and share it with Identify. (S)
- **Single source for API types**: have `personService` and `collectionService` import
  `PersonWithFilmography`, `CreateCollectionInput`, `UpdateCollectionInput` from
  `@tubeca/shared-types`; add `filmCreditId` to `Image`; widen `Collection.media` to what the
  detail query returns. (S)
- **Backend route/service tests** with a mocked Prisma client for: pagination `hasMore`, keyword
  AND semantics, rating exclusion with null details, cycle detection, delete file cleanup,
  Identify upsert, person id-merge priority. (M)
- **Watch progress table** (`UserMediaProgress { userId, mediaId, positionSeconds, completed }`)
  is the obvious missing user-state model; the `Media`/`User` FKs and cascade conventions already
  exist to hang it on. See [Playback](playback.md). (M)
- **Populate music details** or drop the unwritten tables/types to reduce surface area. (L to
  implement a MusicBrainz scraper; S to prune.)
- **Delete dead service methods** (`searchMedia`, `processMedia`, `updateMedia`,
  `getCollectionsByLibrary`, `getPersonByExternalId`). (S)
