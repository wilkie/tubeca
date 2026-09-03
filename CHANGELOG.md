# Changelog

All notable changes to Tubeca are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are git tags (`v1.2.3`).

## [Unreleased]

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
