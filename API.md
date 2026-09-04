# Tubeca API Documentation

Base URL: `http://localhost:3000/api`

Interactive documentation available at `http://localhost:3000/api-docs` when the server is running.

## Authentication

Most endpoints require authentication via JWT token. Include the token in the `Authorization` header:

```
Authorization: Bearer <token>
```

For streaming and image endpoints that use browser elements (`<video>`, `<audio>`, `<img>`), authentication can also be passed via query parameter:

```
?token=<token>
```

### Roles

- **Admin** - Full access to all endpoints
- **Editor** - Can modify content (create/update/delete media, collections, etc.)
- **Viewer** - Read-only access

---

## Health

### GET /health

Whether this process can still do its job. Answers 200 when it can and 503 when it cannot, so it
can be used as a probe. `redis` is only reported by a process that runs workers: an API-only
process that cannot reach Redis can still serve and stream.

**Response:**
```json
{
  "status": "ok",
  "message": "Tubeca API is running",
  "database": "connected",
  "redis": "connected",
  "role": "api"
}
```

---

## Auth Endpoints

### POST /auth/login

Login with username and password.

**Request Body:**
```json
{
  "name": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "token": "string",
  "user": {
    "id": "string",
    "name": "string",
    "role": "Admin|Editor|Viewer"
  }
}
```

### GET /auth/setup

Check if initial setup is required.

**Response:**
```json
{
  "needsSetup": true
}
```

### POST /auth/setup

Create the initial admin user (only works when no users exist).

**Request Body:**
```json
{
  "name": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "token": "string",
  "user": {
    "id": "string",
    "name": "string",
    "role": "Admin"
  }
}
```

---

## User Endpoints

All user endpoints require authentication.

### GET /users/me

Get the current authenticated user.

**Response:**
```json
{
  "user": {
    "id": "string",
    "name": "string",
    "role": "Admin|Editor|Viewer",
    "groups": [
      {
        "id": "string",
        "name": "string"
      }
    ],
    "createdAt": "datetime"
  }
}
```

### GET /users

Get all users. **Requires Admin role.**

**Response:**
```json
{
  "users": [...]
}
```

### POST /users

Create a new user. **Requires Admin role.**

**Request Body:**
```json
{
  "name": "string",
  "password": "string",
  "role": "Admin|Editor|Viewer"
}
```

### PATCH /users/:id

Update a user. **Requires Admin role.**

**Request Body:**
```json
{
  "name": "string",
  "password": "string"
}
```

### DELETE /users/:id

Delete a user. **Requires Admin role.**

### PATCH /users/:id/role

Update a user's role. **Requires Admin role.**

**Request Body:**
```json
{
  "role": "Admin|Editor|Viewer"
}
```

### PATCH /users/:id/groups

Update a user's group memberships. **Requires Admin role.**

**Request Body:**
```json
{
  "groupIds": ["string"]
}
```

---

## Group Endpoints

All group endpoints require Admin role.

### GET /groups

Get all groups.

**Response:**
```json
{
  "groups": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "createdAt": "datetime",
      "updatedAt": "datetime"
    }
  ]
}
```

### POST /groups

Create a new group.

**Request Body:**
```json
{
  "name": "string",
  "description": "string"
}
```

### PATCH /groups/:id

Update a group.

**Request Body:**
```json
{
  "name": "string",
  "description": "string"
}
```

### DELETE /groups/:id

Delete a group.

---

## Settings Endpoints

### GET /settings

Get system settings.

**Response:**
```json
{
  "settings": {
    "id": "string",
    "instanceName": "string",
    "createdAt": "datetime",
    "updatedAt": "datetime"
  }
}
```

### PATCH /settings

Update system settings.

**Request Body:**
```json
{
  "instanceName": "string"
}
```

### GET /settings/transcoding

Get transcoding settings plus the encoders and presets this server offers. Admin only.

**Response:**
```json
{
  "settings": {
    "enableHardwareAccel": true,
    "preferredEncoder": null,
    "preset": "veryfast",
    "enableLowLatency": true,
    "threadCount": 0,
    "maxConcurrentTranscodes": 2,
    "segmentDuration": 6,
    "prefetchSegments": 2,
    "bitrate1080p": 8000,
    "bitrate720p": 5000,
    "bitrate480p": 2500,
    "bitrate360p": 1000,
    "detectedEncoder": { "name": "string", "encoder": "string", "type": "hardware|software" },
    "activeEncoder": { "name": "string", "encoder": "string", "type": "hardware|software" },
    "availablePresets": ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"],
    "availableEncoders": [{ "name": "string", "encoder": "string", "type": "hardware|software" }]
  }
}
```

### PUT /settings/transcoding

Update transcoding settings. Admin only. Every field is optional; those sent are validated and
those omitted are left unchanged.

| Field | Accepted values |
|-------|-----------------|
| `enableHardwareAccel`, `enableLowLatency` | boolean |
| `preferredEncoder` | `null` or an `encoder` id from `availableEncoders` |
| `preset` | one of `availablePresets` |
| `threadCount` | whole number, 0-64 (0 means auto) |
| `maxConcurrentTranscodes` | whole number, 1-16 |
| `segmentDuration` | whole number, 1-30 seconds |
| `prefetchSegments` | whole number, 0-10 |
| `bitrate1080p`, `bitrate720p`, `bitrate480p`, `bitrate360p` | whole number, 100-100000 kbps |

Changing `segmentDuration` purges every cached HLS segment, because playlists are computed from it.

**Error Response (400):**
```json
{
  "error": "Invalid transcoding settings",
  "details": [{ "field": "segmentDuration", "message": "must be a whole number between 1 and 30 seconds" }]
}
```

---

## Library Endpoints

All library endpoints require authentication.

### GET /libraries

Get all libraries accessible to the current user.

**Response:**
```json
{
  "libraries": [
    {
      "id": "string",
      "name": "string",
      "path": "string",
      "libraryType": "Television|Film|Music",
      "watchForChanges": false,
      "createdAt": "datetime",
      "updatedAt": "datetime"
    }
  ]
}
```

### GET /libraries/:id

Get a single library.

### POST /libraries

Create a new library. **Requires Admin role.**

**Request Body:**
```json
{
  "name": "string",
  "path": "string",
  "libraryType": "Television|Film|Music",
  "watchForChanges": false,
  "groupIds": ["string"]
}
```

### PATCH /libraries/:id

Update a library. **Requires Admin role.**

**Request Body:**
```json
{
  "name": "string",
  "path": "string",
  "libraryType": "Television|Film|Music",
  "watchForChanges": false,
  "groupIds": ["string"]
}
```

### DELETE /libraries/:id

Delete a library and all its content. **Requires Admin role.**

### GET /libraries/browse

List the sub-directories of a path on the server, for the library path picker. **Requires Admin
role.** Without `path`, the filesystem root is listed. Folders only; dot-directories are hidden.

**Query Parameters:**
- `path` - absolute path to list

**Response:**
```json
{
  "path": "/media",
  "parent": "/",
  "directories": [{ "name": "Films", "path": "/media/Films" }]
}
```

### POST /libraries/:id/scan

Start a library scan. **Requires Admin role.**

**Request Body:** (both optional)
```json
{
  "fullScan": false,
  "dryRunRemovals": false
}
```

`fullScan` re-queues metadata scrapes for items that already existed. `dryRunRemovals` imports as
usual but deletes nothing; the job result then reports `mediaWouldRemove` and
`collectionsWouldRemove` instead of `mediaRemoved` and `collectionsRemoved`.

**Response:**
```json
{
  "message": "Scan started",
  "jobId": "string"
}
```

### GET /libraries/:id/scan

Get scan status for a library.

**Response:**
```json
{
  "status": "idle|waiting|active|completed|failed",
  "scanning": true,
  "progress": 50,
  "result": {
    "filesFound": 0,
    "filesProcessed": 0,
    "collectionsCreated": 0,
    "mediaCreated": 0,
    "mediaMoved": 0,
    "mediaRemoved": 0,
    "collectionsRemoved": 0,
    "mediaWouldRemove": 0,
    "collectionsWouldRemove": 0,
    "errors": []
  },
  "failedReason": "string"
}
```

### DELETE /libraries/:id/scan

Cancel a running library scan. **Requires Admin role.**

---

## Collection Endpoints

All collection endpoints require authentication.

### GET /collections/library/:libraryId

Get all root collections for a library.

**Response:**
```json
{
  "collections": [...]
}
```

### GET /collections/:id

Get a single collection with full details including children, media, and images.

**Response:**
```json
{
  "collection": {
    "id": "string",
    "name": "string",
    "sortName": "string",
    "collectionType": "Show|Season|Film|Artist|Album|Folder",
    "libraryId": "string",
    "parentId": "string|null",
    "images": [...],
    "children": [...],
    "media": [...],
    "showDetails": {...},
    "seasonDetails": {...},
    "filmDetails": {...},
    "artistDetails": {...},
    "albumDetails": {...},
    "keywords": [...]
  }
}
```

### POST /collections

Create a collection. **Requires Editor role.**

**Request Body:**
```json
{
  "name": "string",
  "collectionType": "Show|Season|Film|Artist|Album|Folder",
  "libraryId": "string",
  "parentId": "string"
}
```

### PATCH /collections/:id

Update a collection. **Requires Editor role.**

### DELETE /collections/:id

Delete a collection. **Requires Editor role.**

### POST /collections/:id/refresh-metadata

Refresh metadata for a collection from scrapers. **Requires Editor role.**

**Response:**
```json
{
  "message": "Metadata refresh queued",
  "jobId": "string"
}
```

### POST /collections/:id/refresh-images

Refresh images for a collection from scrapers. **Requires Editor role.**

---

## Media Endpoints

All media endpoints require authentication.

### GET /media

Get all media items.

**Response:**
```json
{
  "media": [...]
}
```

### GET /media/videos

Get all video media items.

**Response:**
```json
{
  "videos": [...]
}
```

### GET /media/audio

Get all audio media items.

**Response:**
```json
{
  "audio": [...]
}
```

### GET /media/:id

Get a single media item with full details including streams.

**Response:**
```json
{
  "media": {
    "id": "string",
    "name": "string",
    "path": "string",
    "type": "Video|Audio",
    "duration": 3600,
    "size": 1234567890,
    "streams": [
      {
        "streamIndex": 0,
        "streamType": "Video|Audio|Subtitle",
        "codec": "h264",
        "language": "eng",
        "title": "English",
        "channels": 6,
        "channelLayout": "5.1",
        "isDefault": true,
        "isForced": false
      }
    ],
    "videoDetails": {
      "episode": 1,
      "description": "string",
      "releaseDate": "date"
    },
    "audioDetails": {
      "track": 1,
      "disc": 1
    },
    "collection": {...},
    "images": [...]
  }
}
```

### POST /media/video

Create a new video entry. **Requires Editor role.**

**Request Body:**
```json
{
  "path": "string",
  "duration": 3600,
  "name": "string"
}
```

### POST /media/audio

Create a new audio entry. **Requires Editor role.**

**Request Body:**
```json
{
  "path": "string",
  "duration": 180,
  "name": "string"
}
```

### DELETE /media/:id

Delete a media item. **Requires Editor role.**

### POST /media/:id/refresh-metadata

Refresh metadata for a media item. **Requires Editor role.**

**Request Body (optional):**
```json
{
  "scraperId": "tmdb",
  "externalId": "12345"
}
```

### POST /media/:id/refresh-images

Refresh images for a media item. **Requires Editor role.**

### GET /media/scrapers/list

Get list of available metadata scrapers.

**Response:**
```json
{
  "scrapers": [
    {
      "id": "tmdb",
      "name": "The Movie Database",
      "mediaTypes": ["video"]
    }
  ]
}
```

### GET /media/scrapers/queue-status

Get metadata scrape queue status. **Requires Admin role.**

### GET /media/scrapers/search

Search for metadata using scrapers.

**Query Parameters:**
- `query` (required) - Search query
- `type` - "video" or "audio"
- `scraperId` - Specific scraper to use

---

## Person Endpoints

All person endpoints require authentication.

### GET /persons/:id

Get a person by ID with filmography. Auto-fetches metadata if biography is missing but external IDs exist.

**Response:**
```json
{
  "person": {
    "id": "string",
    "name": "string",
    "biography": "string",
    "birthDate": "date",
    "deathDate": "date",
    "birthPlace": "string",
    "tmdbId": 12345,
    "tvdbId": 67890,
    "images": [...],
    "filmography": {
      "shows": [...],
      "films": [...],
      "episodes": [...]
    }
  }
}
```

### GET /persons/search

Search for persons by name.

**Query Parameters:**
- `q` (required) - Search query

### POST /persons/:id/refresh

Refresh person metadata from scrapers. **Requires Editor role.**

---

## Search Endpoints

### GET /search

Search every library the caller can see. Matching runs against a full-text index over titles,
alternative titles, descriptions, keywords and cast, ranked best first. With no query, returns
everything, paginated.

**Query Parameters:**
- `q` - search text; the last word is matched as a prefix
- `page` - page number, default 1
- `limit` - results per list per page, default 50, maximum 100
- `keywordIds` - comma-separated keyword ids; a result must carry all of them
- `excludedRatings` - comma-separated content ratings to leave out

**Response:**
```json
{
  "collections": [],
  "media": [],
  "totalCollections": 0,
  "totalMedia": 0,
  "page": 1,
  "hasMore": false
}
```

### GET /search/facets

Filter options across every accessible library, for the search page's filter panel.

**Response:**
```json
{
  "keywords": [{ "id": "string", "name": "heist" }],
  "contentRatings": ["PG", "R"]
}
```

### POST /search/reindex

Rebuild the full-text index from the database. **Requires Admin role.** The index is maintained
by the scan and scrape workers and built automatically on first boot; this is for after a
restore.

**Response:**
```json
{ "collections": 0, "media": 0 }
```

---

## Image Endpoints

### GET /images/:id/file

Serve an image file. Supports query parameter authentication for `<img>` elements.

**Query Parameters:**
- `token` - Auth token (alternative to Authorization header)
- `size` - `w200`, `w400`, `w780` or `w1280` to serve a width-bounded copy, generated on first
  request. The original is served for an unknown size, for an SVG, or when the image is already
  narrower.

### GET /images/:id

Get image metadata.

### GET /images/media/:mediaId

Get all images for a media item.

**Query Parameters:**
- `type` - Filter by image type (Poster, Backdrop, Banner, Thumb, Logo, Photo)

### GET /images/collection/:collectionId

Get all images for a collection.

**Query Parameters:**
- `type` - Filter by image type

### GET /images/person/:personId

Get all images for a person.

### POST /images/download

Download and save an image from a URL, as an additional candidate. **Requires Editor role.**
Recorded with `scraperId` `manual` unless one is given.

**Request Body:**
```json
{
  "url": "string",
  "imageType": "Poster|Backdrop|Logo|Thumbnail|Still|Photo|AlbumArt|ArtistImage",
  "mediaId": "string",
  "collectionId": "string",
  "personId": "string",
  "isPrimary": true,
  "scraperId": "tmdb"
}
```

### POST /images/upload

Upload artwork as an additional candidate. **Requires Editor role.** The body is the raw image
bytes and `Content-Type` names the format (`image/png`, `image/jpeg`, `image/webp`, `image/gif`,
`image/svg+xml`). Stored with `scraperId` `manual`, so a metadata refresh does not discard it.

**Query Parameters:**
- `imageType` (required)
- `collectionId` / `mediaId` / `personId` - one is required
- `isPrimary` - `true` to use it immediately

### PUT /images/:id/primary

Choose which image of its type an entity uses. **Requires Editor role.** The other candidates
keep their rows, so the choice is reversible.

### DELETE /images/:id

Delete an image. **Requires Editor role.**

---

## Streaming Endpoints

All streaming endpoints require authentication (via header or query parameter).

### GET /stream/video/:id

Stream a video file. Transcodes non-native formats to MP4 using FFmpeg.

**Query Parameters:**
- `token` - Auth token
- `start` - Start time in seconds (for seeking in transcoded streams)
- `audioTrack` - Audio stream index to use

**Response:** Video stream (video/mp4 or original format)

**Notes:**
- Native formats (MP4, WebM) support HTTP range requests
- Non-native formats are transcoded on-the-fly
- Selecting an audio track forces transcoding

### GET /stream/audio/:id

Stream an audio file.

**Query Parameters:**
- `token` - Auth token

**Response:** Audio stream with appropriate content type

### GET /stream/subtitles/:id

Extract and stream subtitles as WebVTT.

**Query Parameters:**
- `token` - Auth token
- `streamIndex` (required) - Subtitle stream index

**Response:** WebVTT subtitle file (text/vtt)

### GET /stream/trickplay/:id

Get trickplay sprite sheet information for a video.

**Query Parameters:**
- `token` - Auth token

**Response:**
```json
{
  "trickplay": {
    "available": true,
    "resolutions": [
      {
        "width": 320,
        "tileWidth": 160,
        "tileHeight": 90,
        "columns": 5,
        "rows": 5,
        "tileCount": 25,
        "interval": 10,
        "spriteCount": 10
      }
    ]
  }
}
```

### GET /stream/trickplay/:id/:width/:index

Get a trickplay sprite sheet image.

**Path Parameters:**
- `id` - Media ID
- `width` - Resolution width (e.g., 320)
- `index` - Sprite sheet index (0-based)

**Query Parameters:**
- `token` - Auth token

**Response:** JPEG image containing grid of video thumbnails

---

## User Collections Endpoints

User-created collections for organizing content (playlists, watchlists, etc.). All endpoints require authentication.

### GET /user-collections

Get all collections owned by the current user.

**Response:**
```json
{
  "userCollections": [
    {
      "id": "string",
      "name": "string",
      "description": "string|null",
      "isPublic": false,
      "isSystem": false,
      "systemType": null,
      "userId": "string",
      "createdAt": "datetime",
      "updatedAt": "datetime",
      "_count": {
        "items": 5
      }
    }
  ]
}
```

### GET /user-collections/public

Get all public collections from other users.

**Response:**
```json
{
  "userCollections": [...]
}
```

### GET /user-collections/:id

Get a single collection with items (must be owner or public).

**Response:**
```json
{
  "userCollection": {
    "id": "string",
    "name": "string",
    "description": "string|null",
    "isPublic": false,
    "items": [
      {
        "id": "string",
        "order": 0,
        "addedAt": "datetime",
        "collection": {...},
        "media": {...}
      }
    ],
    "user": {
      "id": "string",
      "name": "string"
    }
  }
}
```

### POST /user-collections

Create a new user collection.

**Request Body:**
```json
{
  "name": "string",
  "description": "string",
  "isPublic": false
}
```

**Response:**
```json
{
  "userCollection": {...}
}
```

### PATCH /user-collections/:id

Update a collection (owner only).

**Request Body:**
```json
{
  "name": "string",
  "description": "string",
  "isPublic": false
}
```

### DELETE /user-collections/:id

Delete a collection (owner only).

### POST /user-collections/:id/items

Add an item to a collection (owner only).

**Request Body:**
```json
{
  "collectionId": "string",
  "mediaId": "string"
}
```

Note: Provide either `collectionId` (for shows, films, albums) or `mediaId` (for episodes, tracks), not both.

**Response:**
```json
{
  "item": {
    "id": "string",
    "order": 0,
    "addedAt": "datetime"
  }
}
```

### DELETE /user-collections/:id/items/:itemId

Remove an item from a collection (owner only).

### PATCH /user-collections/:id/items/reorder

Reorder items in a collection (owner only).

**Request Body:**
```json
{
  "itemIds": ["string", "string", ...]
}
```

---

## Favorites Endpoints

System collection for user favorites. All endpoints require authentication.

### GET /user-collections/favorites

Get the user's Favorites collection with all items.

**Response:**
```json
{
  "userCollection": {
    "id": "string",
    "name": "Favorites",
    "isSystem": true,
    "systemType": "Favorites",
    "items": [...]
  }
}
```

### GET /user-collections/favorites/check

Check if items are in the user's Favorites.

**Query Parameters:**
- `collectionIds` - Comma-separated collection IDs to check
- `mediaIds` - Comma-separated media IDs to check

**Response:**
```json
{
  "collectionIds": ["id1", "id2"],
  "mediaIds": ["id3"]
}
```

### POST /user-collections/favorites/toggle

Add or remove an item from favorites.

**Request Body:**
```json
{
  "collectionId": "string",
  "mediaId": "string"
}
```

Note: Provide either `collectionId` or `mediaId`, not both.

**Response:**
```json
{
  "favorited": true
}
```

---

## Watch Later Endpoints

System collection for watch queue. All endpoints require authentication.

### GET /user-collections/watch-later

Get the user's Watch Later collection with all items.

**Response:**
```json
{
  "userCollection": {
    "id": "string",
    "name": "Watch Later",
    "isSystem": true,
    "systemType": "WatchLater",
    "items": [...]
  }
}
```

### GET /user-collections/watch-later/check

Check if items are in the user's Watch Later.

**Query Parameters:**
- `collectionIds` - Comma-separated collection IDs to check
- `mediaIds` - Comma-separated media IDs to check

**Response:**
```json
{
  "collectionIds": ["id1", "id2"],
  "mediaIds": ["id3"]
}
```

### POST /user-collections/watch-later/toggle

Add or remove an item from watch later.

**Request Body:**
```json
{
  "collectionId": "string",
  "mediaId": "string"
}
```

Note: Provide either `collectionId` or `mediaId`, not both.

**Response:**
```json
{
  "inWatchLater": true
}
```

---

## Watch Progress Endpoints

Per-user playback positions. All routes require authentication and enforce library access on the
media item (inaccessible media answers 404).

### GET /watch/continue

Media the current user has started but not finished, most recently played first. Optional
`?limit=` (default 20, max 100). Only items in libraries the user can see are returned.

**Response:**
```json
{
  "items": [
    {
      "progress": { "id": "string", "mediaId": "string", "position": 600, "duration": 1200, "completed": false, "updatedAt": "datetime" },
      "media": { "id": "string", "name": "string", "collection": { "...": "..." }, "videoDetails": { "season": 1, "episode": 1 } }
    }
  ]
}
```

### POST /auth/media-token

Returns a short-lived token for image and stream URLs, which carry their token in the query
string. Scoped to those routes: it is refused for every other API call. Requires a session.

**Response:**
```json
{ "token": "string", "expiresAt": "datetime" }
```

---

### GET /watch/batch

Progress for up to 200 media items: `?mediaIds=a,b,c`. Never-played ids are absent.

**Response:**
```json
{ "progress": { "a": { "position": 600, "duration": 1200, "completed": false } } }
```

### GET /watch/collections

Watched/total roll-ups for up to 200 collections over their whole subtree: `?ids=a,b`.
Collections in libraries the user cannot access are omitted. `resume` is the most recently
played unfinished item, when any.

**Response:**
```json
{ "summaries": { "a": { "total": 10, "watched": 3, "inProgress": 1, "resume": { "mediaId": "m", "position": 400, "duration": 1000 } } } }
```

### GET /watch/:mediaId

Saved progress for one item, or `null` when never played.

**Response:**
```json
{ "progress": { "position": 600, "duration": 1200, "completed": false } }
```

### PUT /watch/:mediaId

Report a playback position. `completed` is derived server-side (at or past 90% of the duration).

**Request Body:**
```json
{ "position": 600, "duration": 1200 }
```

### POST /watch/:mediaId/complete

Mark the item as watched.

### DELETE /watch/:mediaId

Clear progress and watched state. Returns 204.

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "error": "Error message"
}
```

Common HTTP status codes:
- `400` - Bad request (invalid input)
- `401` - Unauthorized (missing or invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not found
- `409` - Conflict (e.g., scan already in progress)
- `500` - Server error
