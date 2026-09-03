# Changelog

All notable changes to Tubeca are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are git tags (`v1.2.3`).

## [Unreleased]

### Added
- Image and stream URLs carry a four-hour, media-scoped token instead of the session token,
  so a shared or logged URL cannot be used to drive the API.
- Password changes, role changes and deletions end existing sessions immediately.
- Any signed-in user can change their own password.
- Login and setup are rate limited; the last Admin cannot be deleted or demoted.
- The app signs out centrally when the server rejects a session, instead of erroring on
  every request until reload.
- Keyboard shortcuts in the player: space/k play-pause, arrows and j/l seek, arrows for
  volume, m mute, f fullscreen; OS media controls via the Media Session API.

### Fixed
- Audio items no longer play twice: the page rendered its own element alongside the shared one.
- Playback failures stop after a few recovery attempts and show a retry instead of spinning.
- The last playback position is saved when a tab is closed or hidden.
- Up Next offers the first unwatched episode rather than always the next one.
- Preferred quality is remembered as a height, so it means the same thing on the next title.

### Changed
- Library sorting by release date, rating and runtime is applied by the database, so
  paging through a sorted library no longer shows a locally-sorted, globally wrong order.
- The Docker image and the Arch package ship only the backend's production dependencies,
  bundle, Prisma files and a prebuilt `openapi.json`; sources and dev tooling no longer ship.
- Person filmographies and user-collection items are scoped to the viewer's libraries.
- Renamed or moved files keep their metadata and watch progress.
- Watched state is shown on library, season and episode cards with a mark-watched control.

## [1.0.0] - 2026-09-03

First tagged release. Covers the initial build-out (November and December 2025) and the
September 2026 hardening described in `specs/overview.md`.

### Added
- Libraries (Television, Film) with folder scanning, a file watcher, and rename/move detection
  that preserves metadata and watch progress.
- Metadata from TMDB and TVDB via scraper plugins, with scored candidate matching, an Identify
  dialog, and per-item scrape status shown in the UI.
- HLS streaming with on-the-fly transcoding, an adaptive bitrate ladder, hardware-encoder
  detection, trickplay previews, subtitles, audio-track switching, and a size-limited segment
  cache.
- Playback with resume, watched state on cards and lists, a Continue Watching strip, an Up
  Next flow, a persistent mini player, and a playback queue.
- Per-user favorites, watch later, and custom playlists and sets.
- Global search with keyword and rating filters, quick search, and sortable library views.
- Users, roles (Admin, Editor, Viewer), groups, and per-library access enforced on every
  content, image, and stream route.
- One bundled backend binary with `TUBECA_ROLE` (`api`, `worker`, `all`) that also serves the
  web UI; systemd units, an Arch package, a Docker image, a compose file, and CI.
- `specs/` describing each part of the system.

### Removed
- The Music library type is hidden until it can be implemented properly.
- The stub video-processing queue and the unauthenticated `/api/jobs/*` endpoints.

[Unreleased]: https://github.com/wilkie/tubeca/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/wilkie/tubeca/releases/tag/v1.0.0
