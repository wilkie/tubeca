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

- **Self-contained artwork**: every rendered image comes from local disk via the API, never from a third-party CDN (`b3fb3ee`).
- **Deterministic storage**: a fixed path per entity and type (`collections/<id>/poster.jpg`) so re-scrapes overwrite rather than accumulate.
- **Cheap serving in dev**: `res.sendFile` instead of manual stream piping because `tsx watch` made piping noticeably slow (`f679405`); a day-long `Cache-Control` so the browser does not re-fetch grids.
- **Correct content types**, including SVG logos from TMDB (`056b695`).
- **Consistent UI rows**: list views prefer landscape (`Thumbnail > Backdrop > Poster`) so row heights match (`5e379a5`); seasons borrow the show poster rather than showing a folder icon (`db1dafa`).
- **Do not clobber curated images on metadata refresh** (`skipImages`) while still filling in empty entities.

## Components

| File | Role |
|------|------|
| `backend/prisma/schema.prisma:260-269, 577-620` | `ImageType` enum and `Image` model (polymorphic FKs, `isPrimary`, `path`, `format`, `sourceUrl`, `scraperId`). |
| `backend/src/services/imageService.ts` | Download, format detection, disk layout, upsert-per-type, delete, `getFullPath`. |
| `backend/src/services/artworkCandidates.ts` | Reads a collection's scraper identity, asks that plugin what artwork it has, and marks the URLs already saved. |
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

1. A worker or route calls `downloadAndSaveImage(url, { imageType, <ownerId>, isPrimary, scraperId, reuseExisting })`.
2. The owner id chooses a folder: `media/`, `collections/` or `people/` (person, showCredit and credit all share `people/`) (`imageService.ts:104-121`).
3. With `reuseExisting` (every scrape apply path since 2026-09-03), the stored row for that owner and type is checked first: if its `sourceUrl` matches and its file is still on disk, nothing is fetched and the result comes back with `reused: true`, still routed through `saveImage` so the primary flag stays correct. This is what keeps a full scan from re-downloading artwork that has not changed.
4. The URL is fetched with `safeFetch` (see below) under a 20 s `AbortSignal.timeout`, refusing a
   non-`image/*` `Content-Type`, a declared or actual body over 25 MB, and an empty body: a
   scraper URL is a third party that can hang, lie or answer with something else entirely.
   The body is then fully buffered. Format is taken from `Content-Type` (`png`, `webp`, `gif`, `svg`), then from the URL extension, else `jpg` (`imageService.ts:133-149`). SVG was added in `056b695`; before that TMDB logos were written as `logo.jpg` and served as `image/jpeg`.
5. The file is written synchronously to `<imagePath>/<folder>/<entityId>/<imagetype>.<format>`. There is no hashing, no dedup across entities, no resizing and no size cap; `sharp` is used only to read dimensions, and failure there is a warning.
6. `saveImage` upserts: if `isPrimary`, every other image with the same owner and type is un-primaried; then the existing row for that owner+type is updated in place, otherwise created (`imageService.ts:216-278`). Because the filename is also keyed on type, an entity can never hold more than one image per type, so "primary" is effectively always true and the DB row and file are 1:1.

`getImageStoragePath()` memoises the resolved root; an absolute `imagePath` is used verbatim, a relative one is resolved against the repo root, and the default is `backend/data/images` (`4dc330d` fixed it ignoring config when called without arguments).

### Sizes

`GET /api/images/:id/file?size=w200|w400|w780|w1280` serves a width-bounded copy. The variant is
written next to the original as `<type>-<size>.<ext>` the first time it is asked for and reused
after that, so an existing library needs no re-ingest. The original is served unchanged when the
size is unknown, when the format is SVG, when the stored image is already narrower, or when
sharp throws. The frontend asks for `w200` in list rows and cast grids, `w400` in poster grids
and hero posters, `w780` for a logo and `w1280` for a backdrop.

### Candidates and choosing

`Image` has always had `isPrimary`, but a scrape wrote one row per entity and type and replaced
it, so there was never a second candidate. An upload (`POST /api/images/upload`) and a manual
fetch (`POST /api/images/download`) now pass `allowMultiple`, which gives the file a unique
suffix and adds a row rather than replacing one; both are recorded with `scraperId: 'manual'`.
`PUT /api/images/:id/primary` moves the flag within an entity and type, leaving the other rows
alone so the choice is reversible, and `ImagesDialog` offers "Use this", an upload button and a
delete for editors.

The upload endpoint takes the raw bytes with the file's own `Content-Type` rather than a
multipart form, so the server needs no multipart parser; the entity ids travel in the query
string, which is why library access for it resolves through `entityInQuery`.

#### What the provider still has

A scrape saves one image of each kind; a provider usually has a dozen. Since 2026-09-04 the
plugins return the rest as `posterUrls`/`backdropUrls`/`logoUrls` (best rated first, capped at
twelve of each), and `GET /api/images/candidates/collection/:id` hands them to the images dialog
with a `saved` flag for the ones already downloaded. Nothing is fetched until someone picks one,
which then goes through the existing `POST /api/images/download` — validation, size limits and
all. Downloading every candidate for every title would multiply a library's artwork by ten for
images almost none of which anyone will choose.

The endpoint is Editor-only, because it makes the provider work, and the answer goes through the
same ten-minute cache the scrape workers use, so opening the dialog twice asks once. TMDB draws
from `/movie|tv/{id}/images`, which it already fetched to pick the backdrop and logo, so the
candidates cost no extra request; TVDB draws from the `artworks` array on the series record,
filtered by artwork type.

### Where a download is allowed to go (`utils/safeFetch.ts`)

`POST /api/images/download` takes a URL from the request body and the scrape workers take one from
whatever a provider returned, so both ask this server to make a request on somebody else's behalf.
Until 2026-09-05 it made whatever request it was asked for. An Editor could not read an arbitrary
response body — it has to pass the `image/*` check to be stored — but a status code and a timing
difference are enough to map what is listening on localhost, and this server usually shares a
machine with Redis, with its own API, and on a cloud host with a metadata service at
`169.254.169.254`.

`safeFetch` refuses two things. Any scheme but `http:` and `https:`, so `file:///etc/passwd` never
reaches the network layer. And any address that is not on the public internet — loopback, the three
private ranges, carrier-grade NAT, link-local, multicast, the reserved and documentation ranges,
their IPv6 equivalents, and an IPv4 address wearing an IPv6 hat (`::ffff:127.0.0.1` reaches
loopback exactly as `127.0.0.1` does). An address the parser cannot read counts as blocked.

The address check is **at the connect layer, not in front of it**: an undici `Agent` whose `lookup`
filters the resolver's answer, so what it returns is where the socket actually opens. Checking the
hostname before calling `fetch` would leave two holes — a redirect to an internal address, and a
name that resolves publicly for the check and privately for the connection — and both close when
the refusal happens at the address the connection is about to use. A name that resolves to both a
public and a private address keeps the public one.

Undici reports a connect failure as a flat `TypeError: fetch failed` with the reason in `cause`, or
an `AggregateError` when every address failed, and crossing a module realm can flatten that cause
to a plain `Error` with only its message intact. `safeFetch` therefore digs for a refusal by name,
by an `EBLOCKED` code, *and* by a marker string in the message, and re-throws it so the caller sees
"`localhost` resolves only to addresses this server will not request (127.0.0.1)" rather than
"fetch failed".

### Where a download is allowed to come from (`services/imageHosts.ts`)

A different question from the one above, and neither answers the other.
`safeFetch` decides whether a URL points somewhere dangerous; this decides
whether it points somewhere the artwork could plausibly have come from. A
provider that has been compromised, or has simply changed, pointing at an
unrelated *public* host is not a security boundary being crossed — it is
artwork arriving from somewhere nobody asked for, cached under a name that says
a scraper chose it.

`ScraperPlugin` gained an optional `imageHosts`, and each plugin declares its
own: TMDB `image.tmdb.org` (every URL it returns is built from `TMDB_IMAGE_BASE`,
and a test asserts the two agree), TVDB `artworks.thetvdb.com` (its URLs come
back absolute from the API; checked against 2,118 artwork URLs across series,
movie, season, search and person responses, with no other host among them).
`images.allowedHosts` in `tubeca.config.json` adds to the list, for a
third-party plugin or a local mirror.

The check is the **union** of every installed plugin's hosts, not the hosts of
the scraper the download claims to be for. The download route takes `scraperId`
from the request body, so keying the rule on it would let the caller pick which
rule to be judged by; a union of what is actually installed is not something a
request can widen. Matching is exact — `image.tmdb.org.example.com` and
`sub.image.tmdb.org` are both different hosts, and a suffix test is how that
gets missed.

When nothing declares a host, nothing is checked. An empty list refusing
everything is not a safer failure than not checking: it would break artwork for
anyone running a scraper written before `imageHosts` existed.

### Who triggers downloads

- **Collection scrape** (`collectionScrapeWorker.ts`): shows and films download Poster, Backdrop, Thumbnail and Logo concurrently with `Promise.all`; seasons download only a Poster; each credit's person gets a `Photo` only if it has none. TMDB supplies one URL per slot: poster at the configured `imageSize` (default `w500`), backdrop and logo as the top-voted `original`, thumbnail as the top-voted English backdrop (`scrapers/tmdb/src/index.ts:379-423`). TVDB picks artwork by type code (2/3/6).
- **Media scrape** (`metadataScrapeWorker.ts`): video gets Poster and Thumbnail (episode still), audio gets AlbumArt.
- **Metadata refresh** passes `skipImages: true` and the worker still downloads when `prisma.image.count` is zero; **refresh-images** passes `imagesOnly: true` and re-downloads everything (`collections.ts:576, 667`, `media.ts:159, 230`).
- **Identify** (`collections.ts:748`) does `prisma.image.deleteMany` for the collection so the next scrape re-downloads; files are not removed.
- **Person page** first view and `refresh` download the person's `Photo`.
- `POST /api/images/download` (Editor) exposes the same service for arbitrary URLs; nothing in the frontend calls it.

### Serving

`GET /api/images/:id/file` uses `imageAuth`: a `token` query parameter is verified with `AuthService.verifyToken` first, then it falls back to the normal `Authorization` header (`images.ts:15-30`). The handler looks the row up by id, checks the file exists, sets `Content-Type` from `image.format` (falling back to the extension) and `Cache-Control: public, max-age=86400`, then `res.sendFile(fullPath)`. Express's `send` adds `ETag`, `Last-Modified`, `Accept-Ranges` and 304 handling for free. All other image routes sit behind `router.use(authenticate)`; `download` and `delete` additionally `requireRole('Editor')`. Every route then runs `requireLibraryAccess` (since 2026-09-03): images owned by a collection or media are checked against that library's groups, person and credit artwork is unscoped, and `POST /download` checks the `collectionId`/`mediaId` in the body.

`apiClient.getImageUrl(id)` returns `${API_BASE}/images/${id}/file?token=${localStorage.token}`; every `<img>` in the app goes through it, so the JWT appears in every image URL.

### Which image the UI shows

The backend pre-selects one image for list payloads: collection listings and child lists include only the primary `Poster` (`collectionService.ts:45, 199, 311`), media inside a show tree include the primary of any type (`:364`), credits include the primary `Photo`, and user-collection items include primaries in `Thumbnail/Backdrop/Poster` with no ordering (`userCollectionService.ts:31-35, 67-71`). Detail endpoints (`getCollectionById`, `getMediaById`) include all images. Frontend rules:

- Grids (`LibraryPage`, `MediaGrid`, `SearchPage`, `CastCrewGrid`) render `images[0]`, i.e. whatever the backend filtered to.
- Hero views find `Backdrop`, `Poster` and `Logo` explicitly from the full list; `HeroSection` pins the backdrop while content scrolls (`63d1d10`).
- `UserCollectionPage.getItemImage` orders `Thumbnail > Backdrop > Poster` when the view is a list or the library is `Film`, otherwise `Poster > Backdrop > Thumbnail`, then falls back to the media's parent collection images. `QueuePage` always prefers landscape but uses `media.images[0]` unfiltered for the media's own images, applying the order only to the parent fallback.
- Seasons without their own poster show the parent show's poster: `ChildCollectionGrid` takes a `fallbackImages` prop that `StandardCollectionView` fills with the parent's images, and `ShowHeroView` does the same inline (`db1dafa`).
- `MediaPage` looks for a primary `Still`, then any `Still`, then any primary; since `Still` is never created this always resolves to the Thumbnail or Poster.

### Deletion

`ImageService.deleteImage` unlinks the file and deletes the row. Collection, media and library deletes, the file watcher's `unlink` handling and scan reconciliation all go through `ContentDeletionService`, which resolves every image owned by the affected collections, media and their credits, unlinks each file (removing the now-empty entity directory) and then deletes the rows. Only the identify `deleteMany` still relies on the FK cascade and leaves files on disk.

### Trickplay thumbnails

Scrubbing previews are not `Image` rows. `Media.thumbnails` is a path to a trickplay folder and `GET /api/stream/trickplay/:id` (`stream.ts:466`) serves its metadata; `videoWorker.processThumbnail` is still a `TODO` stub. That belongs to [Streaming & Transcoding](streaming-and-transcoding.md).

## Interactions

- **Depends on:** [Metadata Scraping](metadata-scraping.md) for every URL it downloads (`posterUrl`, `backdropUrl`, `thumbnailUrl`, `logoUrl`, `photoUrl`, `albumArtUrl` in `packages/scraper-types`); [Auth & Users](auth-and-users.md) for `authenticate`, `requireRole` and `AuthService.verifyToken`; [Configuration](configuration.md) for `imagePath` in `tubeca.config.json`.
- **Used by:** [Content Model](content-model.md) and [Libraries & Scanning](libraries-and-scanning.md) responses that embed `images`; [User Collections](user-collections.md) and [Search](search.md) list payloads; [Frontend App](frontend-app.md) pages and components listed above; [Playback](playback.md) for poster art in the player context.
- **Shared data:** reads/writes the `Image` table; reads `Collection`, `Media`, `Person`, `Credit`, `ShowCredit` ids; the image directory on disk; `skipImages`/`imagesOnly` flags on the `collectionScrape` and `metadataScrape` queues; `imagePath` config key. [Deployment](deployment.md) must persist the image directory alongside the SQLite file.

## History

- 2026-09-03 — Download hardening (20 s timeout, 25 MB cap, `image/*` only); `?size=` serving with variants generated on first request; multiple candidates per type with `PUT /api/images/:id/primary`; `POST /api/images/upload` for user artwork and an editable `ImagesDialog`.
- 2026-09-04 — Plugins return the artwork they did not choose (`posterUrls`, `backdropUrls`, `logoUrls`), `GET /api/images/candidates/collection/:id` serves them to the images dialog with a `saved` flag, and nothing is fetched until an editor picks one.

- `41cf2f0` 2025-11-29 Scraper plugins introduced; metadata carries artwork URLs.
- `b3fb3ee` 2025-11-29 `add_image_storage` migration, `ImageService`, `/api/images` routes, workers download artwork, frontend renders it.
- `3404584` 2025-11-30 `ImagesDialog` gallery and refresh-metadata / refresh-images actions.
- `a3f2f55` 2025-11-30 `Person` entity gains `images`; person photos downloaded on view.
- `20251202222947_add_film_details` 2025-12-02 `filmCreditId` added to `Image`.
- `384bcd7` 2025-12-02 CollectionPage split into `ShowHeroView` / `FilmHeroView` / `StandardCollectionView` with tests.
- `d71d4e5` 2025-12-05 `appConfig` gains `getImageStoragePath` alongside HLS cache path.
- `5e379a5` 2025-12-13 List views prefer landscape images (`Thumbnail > Backdrop > Poster`).
- `db1dafa` 2025-12-15 Seasons fall back to the parent show's poster.
- `4dc330d` 2025-12-15 `getImageStoragePath()` honours config when called with no argument.
- `63d1d10` 2025-12-16 Hero backdrop fixed while content scrolls.
- `f679405` 2025-12-19 `res.sendFile` replaces manual stream piping.
- `056b695` 2025-12-20 SVG detected on download; `Content-Type` taken from the DB `format`.
- 2026-09-03 — Library access enforced on all image routes via `requireLibraryAccess`.

- 2026-09-05 `utils/safeFetch.ts`: every download restricted to public http(s) addresses, enforced by the dispatcher's own DNS lookup so redirects and rebinding are covered too. `POST /api/images/download` had accepted any URL an Editor sent, including this server's own loopback.
- 2026-09-05 `services/imageHosts.ts` and `ScraperPlugin.imageHosts`: a download's host must be one an installed scraper claims, or one `images.allowedHosts` adds.

## Known Limitations

- Candidates only come from people: scrapers still supply one image per type, so a second candidate exists only where someone uploaded one or fetched one by URL. There is no gallery of provider alternatives to choose from.
- Resizing happens on request, not on ingest: the first request for a given `?size=` writes the variant next to the original, so the very first viewer of a poster grid pays for it. Only four widths exist (`w200`, `w400`, `w780`, `w1280`) and the original is served for SVGs, for images already narrower than the request, and whenever sharp fails.
- No dedup or hashing: the same person photo is downloaded once per entity directory. A scrape now skips the fetch when the source URL is unchanged, but any download that does happen overwrites in place, bumping `updatedAt` and `Last-Modified`; a provider that moves a URL without changing the bytes still re-downloads.
- Orphaned files: a format change (`poster.jpg` then `poster.png`) and identify's `deleteMany` leave files behind; there is no sweep. (Library deletion, watcher-driven media deletion and scan reconciliation clean up through `ContentDeletionService` since 2026-09-03.)
- No library-level authorisation on `/api/images/:id/file`; any valid token can fetch any image by UUID.
- JWT in the query string of every image URL: it lands in server logs, browser history and any `Referer`, and the `public` cache directive makes the token-bearing URL cacheable by intermediaries. URLs also change whenever the token changes, defeating browser caching across logins.
- **A scraper that declares no `imageHosts` disables the host check for every scraper**, since the
  list is a union and an empty union means "do not check". A third-party plugin without the field
  therefore widens the allowlist to everything public. `images.allowedHosts` is the way to give it
  hosts without changing it.
- Images are served by a Node handler with a DB lookup per request rather than a static file server or reverse proxy.
- An upload is always stored as a `Poster` from the dialog's button; the endpoint accepts any type, but nothing in the UI offers the choice.
- `QueuePage` ignores the landscape preference for a media item's own images (`media.images[0]`), unlike `UserCollectionPage`.
- OpenAPI docs list `[Poster, Backdrop, Banner, Thumb, Logo, Photo]` (`images.ts:127, 176, 269`), which does not match the enum.
- `Still` and `ArtistImage` types, and `filmCreditId` ownership, are dead in practice.
- `imageService` and the upload/set-primary routes are covered; the serving route's headers and `imageAuth` are not.

## Opportunities

- **Choose the type when uploading** (S): the dialog always uploads a `Poster`, though the endpoint takes any type. Artwork chosen from the provider does carry its own type.
- **Candidates are collection-only** (S): a media item has no provider identity of its own (`VideoDetails` has no `scraperId`/`externalId`), so an episode still has nothing to choose from. The episode-level identity opportunity in [Metadata Scraping](metadata-scraping.md) would settle it.
- **Per-scraper host checking** (S): the allowlist is a union, so TMDB artwork could arrive from
  TVDB's host. Keying it on the scraper that actually produced the URL means passing that down from
  `scrapeApply` rather than reading the request body's `scraperId`, which a caller controls.
- **Content-hash dedup and skip-if-unchanged** (S): hash the buffer, store it on `Image`, and skip rewrite when unchanged; optionally share person photos across credits.
- **Orphan cleanup** (S): make identify go through `ContentDeletionService.imagePathsFor`, and add an admin "prune images" job that diffs disk against `Image.path`.
- **Cookie auth for image URLs** (M): a `SameSite` cookie would keep tokens out of URLs entirely; today they carry a short-lived media-scoped token. This would also let us drop `public` from a scoped, short-TTL token (or `SameSite` cookie) and drop `public` from `Cache-Control`.
- **Static serving** (S/M): expose the image directory via `express.static` behind the same auth, or document a reverse-proxy `X-Accel-Redirect` path for production.
- **Fix `QueuePage` selection** (S) and delete the `Still` lookup on `MediaPage` or start producing `Still` images from the episode still URL.
- **Regenerate the OpenAPI enums** from `ImageType` (S).
- **Tests** (M): unit tests for format detection, upsert semantics, and file cleanup in `imageService`; supertest coverage for `imageAuth` and `Content-Type`/cache headers.
