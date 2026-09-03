# Images & Artwork

> Images & Artwork is the subsystem that turns scraper-supplied artwork URLs into locally stored files, records them in the `Image` table against the entity they belong to (collection, media, person, credit), serves them back to the browser through an authenticated Express route, and decides, in the UI, which stored image to show in a given context (poster grid, landscape list row, hero backdrop, season tile). It exists so that the app never hot-links to TMDB/TVDB at render time and so artwork survives scraper outages and key rotation.

## Responsibilities

- Define the `Image` Prisma model and `ImageType` enum, with polymorphic ownership by `Collection`, `Media`, `Person`, `Credit`, `ShowCredit` and `FilmCredit`.
- Download an image from a URL, detect its format, measure it with `sharp`, write it under the configured `imagePath`, and upsert the matching `Image` row (`ImageService.downloadAndSaveImage`).
- Enforce "one stored image per (entity, imageType)" and "one primary per (entity, imageType)" (`ImageService.saveImage`).
- Serve image bytes at `GET /api/images/:id/file` with a query-string JWT so `<img>` tags can load them, plus JSON list/metadata/download/delete endpoints.
- Delete image files when an image, collection or media item is deleted through the service layer.
- In the frontend, build image URLs (`apiClient.getImageUrl`), show a read-only gallery of an entity's images (`ImagesDialog`), and pick poster vs. landscape vs. backdrop/logo per view, falling back to parent-collection artwork where a child has none.

## Goals

- **Self-contained artwork**: every rendered image comes from local disk via the API, never from a third-party CDN (`bf45a3c`).
- **Deterministic storage**: a fixed path per entity and type (`collections/<id>/poster.jpg`) so re-scrapes overwrite rather than accumulate.
- **Cheap serving in dev**: `res.sendFile` instead of manual stream piping because `tsx watch` made piping noticeably slow (`16178fd`); a day-long `Cache-Control` so the browser does not re-fetch grids.
- **Correct content types**, including SVG logos from TMDB (`00c1767`).
- **Consistent UI rows**: list views prefer landscape (`Thumbnail > Backdrop > Poster`) so row heights match (`a27f5f8`); seasons borrow the show poster rather than showing a folder icon (`d188a96`).
- **Do not clobber curated images on metadata refresh** (`skipImages`) while still filling in empty entities.

## Components

| File | Role |
|------|------|
| `backend/prisma/schema.prisma:260-269, 577-620` | `ImageType` enum and `Image` model (polymorphic FKs, `isPrimary`, `path`, `format`, `sourceUrl`, `scraperId`). |
| `backend/src/services/imageService.ts` | Download, format detection, disk layout, upsert-per-type, delete, `getFullPath`. |
| `backend/src/routes/images.ts` | `imageAuth` (query token), file serving, list/metadata, `POST /download`, `DELETE /:id`. |
| `backend/src/config/appConfig.ts:133-164` | `getImageStoragePath()`: resolves `imagePath` from `tubeca.config.json`, defaults to `backend/data/images`, creates the directory. |
| `backend/src/workers/collectionScrapeWorker.ts:304-312, 385-522` | Downloads Poster/Backdrop/Thumbnail/Logo for shows and films, Poster for seasons, Photo for credits. |
| `backend/src/workers/metadataScrapeWorker.ts:280-289, 360-440` | Downloads Poster/Thumbnail (video) or AlbumArt (audio) for media, Photo for credits. |
| `backend/src/routes/persons.ts:92-106, 240-250` | Downloads a person's `Photo` on first view / explicit refresh. |
| `backend/src/routes/collections.ts:748-751, 623-670` | Identify clears `Image` rows; `refresh-images` queues an `imagesOnly` scrape. |
| `backend/src/services/collectionService.ts`, `mediaService.ts`, `userCollectionService.ts`, `personService.ts` | Prisma `include` filters that decide which one image travels with list responses; file cleanup on entity delete. |
| `frontend/ui/src/api/client.ts:622-626` | `getImageUrl(id)` appends `?token=<localStorage JWT>`. |
| `frontend/ui/src/components/ImagesDialog.tsx` | Read-only gallery: type chip, primary highlight, dimensions, file size. |
| `frontend/ui/src/components/ChildCollectionGrid.tsx:72-76`, `ShowHeroView.tsx:173-175, 502-505`, `FilmHeroView.tsx:124-126`, `StandardCollectionView.tsx:150, 524` | Poster/backdrop/logo selection and parent fallback. |
| `frontend/ui/src/pages/UserCollectionPage.tsx:74-100`, `QueuePage.tsx:152-172`, `MediaPage.tsx:368-370`, `PersonPage.tsx:228` | Landscape-vs-portrait selection, `Still` lookup, person photo. |

## How It Works

### Data model

`Image` has one nullable foreign key per owner (`mediaId`, `collectionId`, `personId`, `creditId`, `showCreditId`, `filmCreditId`), all `onDelete: Cascade`, plus `imageType`, a `path` relative to the storage root, optional `width`/`height`/`format`/`fileSize`, `sourceUrl` and `scraperId` for provenance, and `isPrimary`. `ImageType` is `Poster | Backdrop | Logo | Thumbnail | Still | Photo | AlbumArt | ArtistImage`. In practice the workers only ever create `Poster`, `Backdrop`, `Thumbnail`, `Logo`, `Photo` and `AlbumArt`; nothing writes `Still` or `ArtistImage`, and `filmCreditId` is accepted by the schema but not by `SaveImageInput` or the download route.

### Download and storage

1. A worker or route calls `downloadAndSaveImage(url, { imageType, <ownerId>, isPrimary, scraperId })`.
2. The owner id chooses a folder: `media/`, `collections/` or `people/` (person, showCredit and credit all share `people/`) (`imageService.ts:104-121`).
3. The URL is fetched with global `fetch` and fully buffered. Format is taken from `Content-Type` (`png`, `webp`, `gif`, `svg`), then from the URL extension, else `jpg` (`imageService.ts:133-149`). SVG was added in `00c1767`; before that TMDB logos were written as `logo.jpg` and served as `image/jpeg`.
4. The file is written synchronously to `<imagePath>/<folder>/<entityId>/<imagetype>.<format>`. There is no hashing, no dedup across entities, no resizing and no size cap; `sharp` is used only to read dimensions, and failure there is a warning.
5. `saveImage` upserts: if `isPrimary`, every other image with the same owner and type is un-primaried; then the existing row for that owner+type is updated in place, otherwise created (`imageService.ts:216-278`). Because the filename is also keyed on type, an entity can never hold more than one image per type, so "primary" is effectively always true and the DB row and file are 1:1.

`getImageStoragePath()` memoises the resolved root; an absolute `imagePath` is used verbatim, a relative one is resolved against the repo root, and the default is `backend/data/images` (`5bfbb97` fixed it ignoring config when called without arguments).

### Who triggers downloads

- **Collection scrape** (`collectionScrapeWorker.ts`): shows and films download Poster, Backdrop, Thumbnail and Logo concurrently with `Promise.all`; seasons download only a Poster; each credit's person gets a `Photo` only if it has none. TMDB supplies one URL per slot: poster at the configured `imageSize` (default `w500`), backdrop and logo as the top-voted `original`, thumbnail as the top-voted English backdrop (`scrapers/tmdb/src/index.ts:379-423`). TVDB picks artwork by type code (2/3/6).
- **Media scrape** (`metadataScrapeWorker.ts`): video gets Poster and Thumbnail (episode still), audio gets AlbumArt.
- **Metadata refresh** passes `skipImages: true` and the worker still downloads when `prisma.image.count` is zero; **refresh-images** passes `imagesOnly: true` and re-downloads everything (`collections.ts:576, 667`, `media.ts:159, 230`).
- **Identify** (`collections.ts:748`) does `prisma.image.deleteMany` for the collection so the next scrape re-downloads; files are not removed.
- **Person page** first view and `refresh` download the person's `Photo`.
- `POST /api/images/download` (Editor) exposes the same service for arbitrary URLs; nothing in the frontend calls it.

### Serving

`GET /api/images/:id/file` uses `imageAuth`: a `token` query parameter is verified with `AuthService.verifyToken` first, then it falls back to the normal `Authorization` header (`images.ts:15-30`). The handler looks the row up by id, checks the file exists, sets `Content-Type` from `image.format` (falling back to the extension) and `Cache-Control: public, max-age=86400`, then `res.sendFile(fullPath)`. Express's `send` adds `ETag`, `Last-Modified`, `Accept-Ranges` and 304 handling for free. All other image routes sit behind `router.use(authenticate)`; `download` and `delete` additionally `requireRole('Editor')`. No route checks that the caller's groups grant access to the owning library.

`apiClient.getImageUrl(id)` returns `${API_BASE}/images/${id}/file?token=${localStorage.token}`; every `<img>` in the app goes through it, so the JWT appears in every image URL.

### Which image the UI shows

The backend pre-selects one image for list payloads: collection listings and child lists include only the primary `Poster` (`collectionService.ts:45, 199, 311`), media inside a show tree include the primary of any type (`:364`), credits include the primary `Photo`, and user-collection items include primaries in `Thumbnail/Backdrop/Poster` with no ordering (`userCollectionService.ts:31-35, 67-71`). Detail endpoints (`getCollectionById`, `getMediaById`) include all images. Frontend rules:

- Grids (`LibraryPage`, `MediaGrid`, `SearchPage`, `CastCrewGrid`) render `images[0]`, i.e. whatever the backend filtered to.
- Hero views find `Backdrop`, `Poster` and `Logo` explicitly from the full list; `HeroSection` pins the backdrop while content scrolls (`d06b185`).
- `UserCollectionPage.getItemImage` orders `Thumbnail > Backdrop > Poster` when the view is a list or the library is `Film`, otherwise `Poster > Backdrop > Thumbnail`, then falls back to the media's parent collection images. `QueuePage` always prefers landscape but uses `media.images[0]` unfiltered for the media's own images, applying the order only to the parent fallback.
- Seasons without their own poster show the parent show's poster: `ChildCollectionGrid` takes a `fallbackImages` prop that `StandardCollectionView` fills with the parent's images, and `ShowHeroView` does the same inline (`d188a96`).
- `MediaPage` looks for a primary `Still`, then any `Still`, then any primary; since `Still` is never created this always resolves to the Thumbnail or Poster.

### Deletion

`ImageService.deleteImage` unlinks the file and deletes the row. `collectionService.deleteCollection` and `mediaService.deleteMedia` walk the included images, unlink each file and remove the now-empty entity directory (`collectionService.ts:594-608`, `mediaService.ts:165-178`). Deletions that go straight through Prisma, such as `libraryService.deleteLibrary` (`:212`), the file watcher removing vanished media (`fileWatcherService.ts:348`), and the identify `deleteMany`, rely on the FK cascade and leave files on disk.

### Trickplay thumbnails

Scrubbing previews are not `Image` rows. `Media.thumbnails` is a path to a trickplay folder and `GET /api/stream/trickplay/:id` (`stream.ts:466`) serves its metadata; `videoWorker.processThumbnail` is still a `TODO` stub. That belongs to [Streaming & Transcoding](streaming-and-transcoding.md).

## Interactions

- **Depends on:** [Metadata Scraping](metadata-scraping.md) for every URL it downloads (`posterUrl`, `backdropUrl`, `thumbnailUrl`, `logoUrl`, `photoUrl`, `albumArtUrl` in `packages/scraper-types`); [Auth & Users](auth-and-users.md) for `authenticate`, `requireRole` and `AuthService.verifyToken`; [Configuration](configuration.md) for `imagePath` in `tubeca.config.json`.
- **Used by:** [Content Model](content-model.md) and [Libraries & Scanning](libraries-and-scanning.md) responses that embed `images`; [User Collections](user-collections.md) and [Search](search.md) list payloads; [Frontend App](frontend-app.md) pages and components listed above; [Playback](playback.md) for poster art in the player context.
- **Shared data:** reads/writes the `Image` table; reads `Collection`, `Media`, `Person`, `Credit`, `ShowCredit` ids; the image directory on disk; `skipImages`/`imagesOnly` flags on the `collectionScrape` and `metadataScrape` queues; `imagePath` config key. [Deployment](deployment.md) must persist the image directory alongside the SQLite file.

## History

- `fe77ae6` 2025-11-29 Scraper plugins introduced; metadata carries artwork URLs.
- `bf45a3c` 2025-11-29 `add_image_storage` migration, `ImageService`, `/api/images` routes, workers download artwork, frontend renders it.
- `9600bde` 2025-11-30 `ImagesDialog` gallery and refresh-metadata / refresh-images actions.
- `edd67c9` 2025-11-30 `Person` entity gains `images`; person photos downloaded on view.
- `20251202222947_add_film_details` 2025-12-02 `filmCreditId` added to `Image`.
- `8371767` 2025-12-02 CollectionPage split into `ShowHeroView` / `FilmHeroView` / `StandardCollectionView` with tests.
- `6888f86` 2025-12-05 `appConfig` gains `getImageStoragePath` alongside HLS cache path.
- `a27f5f8` 2025-12-13 List views prefer landscape images (`Thumbnail > Backdrop > Poster`).
- `d188a96` 2025-12-15 Seasons fall back to the parent show's poster.
- `5bfbb97` 2025-12-15 `getImageStoragePath()` honours config when called with no argument.
- `d06b185` 2025-12-16 Hero backdrop fixed while content scrolls.
- `16178fd` 2025-12-19 `res.sendFile` replaces manual stream piping.
- `00c1767` 2025-12-20 SVG detected on download; `Content-Type` taken from the DB `format`.

## Known Limitations

- One image per entity per type: the model has `isPrimary` and the dialog highlights it, but there is never a second candidate to choose from, and no endpoint sets primary. `ImagesDialog` is display-only.
- No resizing or thumbnail generation: TMDB `original` backdrops and logos are stored and served at full size to every grid tile; `sharp` is imported but only reads metadata.
- No dedup or hashing: the same person photo is downloaded once per entity directory; re-downloads overwrite even when bytes are unchanged, bumping `updatedAt` and `Last-Modified`.
- Orphaned files: a format change (`poster.jpg` then `poster.png`), identify's `deleteMany`, library deletion, and watcher-driven media deletion all leave files behind; there is no sweep.
- No library-level authorisation on `/api/images/:id/file`; any valid token can fetch any image by UUID.
- JWT in the query string of every image URL: it lands in server logs, browser history and any `Referer`, and the `public` cache directive makes the token-bearing URL cacheable by intermediaries. URLs also change whenever the token changes, defeating browser caching across logins.
- Download has no timeout, size limit or MIME validation; a hostile or slow scraper URL can block a worker or write arbitrary bytes.
- Images are served by a Node handler with a DB lookup per request rather than a static file server or reverse proxy.
- No user upload of custom artwork.
- `QueuePage` ignores the landscape preference for a media item's own images (`media.images[0]`), unlike `UserCollectionPage`.
- OpenAPI docs list `[Poster, Backdrop, Banner, Thumb, Logo, Photo]` (`images.ts:127, 176, 269`), which does not match the enum.
- `Still` and `ArtistImage` types, and `filmCreditId` ownership, are dead in practice.
- No backend tests cover `imageService` or `images.ts`; only `mediaParser` and `authService` have tests. Frontend has `ImagesDialog.test.tsx` and a `getImageUrl` test.

## Opportunities

- **Candidate galleries and set-primary** (M): let scrapers return `posterUrls[]`, store multiple rows per type with unique filenames, add `PUT /api/images/:id/primary`, and make `ImagesDialog` selectable. The model already supports it; only the filename scheme and upsert block it.
- **Resize on ingest** (M): use `sharp` to write a bounded-size variant (and a small grid thumbnail) next to the original; serve via a `?size=` parameter. Removes multi-megabyte `original` backdrops from list pages.
- **Content-hash dedup and skip-if-unchanged** (S): hash the buffer, store it on `Image`, and skip rewrite when unchanged; optionally share person photos across credits.
- **Orphan cleanup** (S): make identify and library deletion go through `ImageService`, and add an admin "prune images" job that diffs disk against `Image.path`.
- **Short-lived signed image URLs or cookie auth** (M): replace the long-lived JWT query param with a scoped, short-TTL token (or `SameSite` cookie) and drop `public` from `Cache-Control`.
- **Library access check on serve** (S): join through `collection.libraryId` / `media.collection.libraryId` and reuse the group-access helper from [Auth & Users](auth-and-users.md).
- **Download hardening** (S): `AbortSignal.timeout`, a max byte size, and rejecting non-image `Content-Type`; validate the URL host against the scraper's known image base.
- **Static serving** (S/M): expose the image directory via `express.static` behind the same auth, or document a reverse-proxy `X-Accel-Redirect` path for production.
- **User upload** (M): `POST /api/images/upload` (multipart) reusing `saveImage` with a `manual` scraperId, so curated art survives `refresh-images`.
- **Fix `QueuePage` selection** (S) and delete the `Still` lookup on `MediaPage` or start producing `Still` images from the episode still URL.
- **Regenerate the OpenAPI enums** from `ImageType` (S).
- **Tests** (M): unit tests for format detection, upsert semantics, and file cleanup in `imageService`; supertest coverage for `imageAuth` and `Content-Type`/cache headers.
