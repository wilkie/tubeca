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

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "message": "Tubeca API is running",
  "database": "connected"
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

### POST /libraries/:id/scan

Start a library scan. **Requires Admin role.**

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
  "result": {},
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

## Image Endpoints

### GET /images/:id/file

Serve an image file. Supports query parameter authentication for `<img>` elements.

**Query Parameters:**
- `token` - Auth token (alternative to Authorization header)

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

Download and save an image from URL. **Requires Editor role.**

**Request Body:**
```json
{
  "url": "string",
  "imageType": "Poster|Backdrop|Banner|Thumb|Logo|Photo",
  "mediaId": "string",
  "collectionId": "string",
  "personId": "string",
  "isPrimary": true,
  "scraperId": "tmdb"
}
```

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

## Jobs Endpoints

Background job management endpoints.

### POST /jobs/transcode

Queue a transcode job.

**Request Body:**
```json
{
  "mediaId": "string",
  "inputPath": "string",
  "outputPath": "string",
  "resolution": "1080p|720p|480p",
  "format": "mp4|webm"
}
```

**Response:**
```json
{
  "jobId": "string",
  "message": "Transcode job queued"
}
```

### POST /jobs/thumbnail

Queue a thumbnail generation job.

**Request Body:**
```json
{
  "mediaId": "string",
  "videoPath": "string",
  "thumbnailPath": "string",
  "timestamp": 30
}
```

**Response:**
```json
{
  "jobId": "string",
  "message": "Thumbnail job queued"
}
```

### POST /jobs/analyze

Queue a media analysis job.

**Request Body:**
```json
{
  "mediaId": "string",
  "filePath": "string"
}
```

**Response:**
```json
{
  "jobId": "string",
  "message": "Analyze job queued"
}
```

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
