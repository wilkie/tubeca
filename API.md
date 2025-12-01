# Tubeca API Documentation

Base URL: `http://localhost:3000/api`

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
    "groups": [],
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

### PATCH /users/:id/groups

Update a user's groups. **Requires Admin role.**

**Request Body:**
```json
{
  "groupIds": ["string"]
}
```

### PATCH /users/:id/role

Update a user's role. **Requires Admin role.**

**Request Body:**
```json
{
  "role": "Admin|Editor|Viewer"
}
```

---

## Settings Endpoints

### GET /settings

Get system settings.

**Response:**
```json
{
  "settings": {
    "id": "string",
    "instanceName": "string"
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

Get all libraries.

**Response:**
```json
{
  "libraries": [
    {
      "id": "string",
      "name": "string",
      "path": "string",
      "libraryType": "Television|Film|Music"
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
  "groupIds": ["string"] // optional
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
  "groupIds": ["string"]
}
```

### DELETE /libraries/:id

Delete a library. **Requires Admin role.**

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

Cancel a library scan. **Requires Admin role.**

---

## Collection Endpoints

All collection endpoints require authentication.

### GET /collections/library/:libraryId

Get all collections for a library.

**Response:**
```json
{
  "collections": [...]
}
```

### GET /collections/:id

Get a single collection with full details.

### POST /collections

Create a collection. **Requires Editor role.**

**Request Body:**
```json
{
  "name": "string",
  "libraryId": "string",
  "parentId": "string" // optional
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
    "videoDetails": {...},
    "audioDetails": {...},
    "collection": {...}
  }
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
- `type` - Filter by image type (Poster, Backdrop, etc.)

### GET /images/collection/:collectionId

Get all images for a collection.

### POST /images/download

Download and save an image from URL. **Requires Editor role.**

**Request Body:**
```json
{
  "url": "string",
  "imageType": "Poster|Backdrop|Banner|Thumb|Logo|Photo",
  "mediaId": "string",
  "collectionId": "string",
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

### GET /stream/subtitles/:id

Extract and stream subtitles as WebVTT.

**Query Parameters:**
- `token` - Auth token
- `streamIndex` (required) - Subtitle stream index

**Response:** WebVTT subtitle file (text/vtt)

### GET /stream/audio/:id

Stream an audio file.

**Query Parameters:**
- `token` - Auth token

**Response:** Audio stream with appropriate content type

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
