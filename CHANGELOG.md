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
- Scrapers take `language`, `region` and `imageSize` from `tubeca.config.json`, so metadata
  and artwork no longer have to be English and US.
- An admin can pin a specific video encoder in Settings; a choice this machine cannot run is
  ignored in favour of the detected one.
- A library remembers whether you browse it as posters or as a list, and how you sort it.
- A library can be scanned without removing anything: new files are imported and the result says
  how many items are missing, which is safer on a network share that comes and goes.
- Subtitle files sitting next to a video are imported and offered in the player, including the
  language, forced and hearing-impaired markers their filenames carry.
- Search finds a title by its cast, its tags, its description or its original title, not just
  its name, and ranks the closest match first.
- Search results appear as you type, and the search page has a People section.
- Admins can rebuild the search index from the API when it looks stale.
- The library dialog can browse the server's folders instead of asking you to type a path.

### Fixed
- Searching for an accented title works without the accents, and a partly typed word matches.
- The search page's filter options now cover every library rather than whatever happened to be
  on the first page of results.
- Re-encoding a file in place now updates its length and its audio and subtitle tracks, instead
  of leaving the player offering tracks that are no longer there.
- Editing a watched library's path or type rebuilds its watcher, rather than watching the old
  path until the server restarts.
- A symlinked folder inside a library no longer makes a scan walk the same files twice, or loop
  forever when it points at its own parent.
- Seeking no longer waits behind segments being encoded for the position you left: the player's
  segment takes an encoder slot first, and the stale work is abandoned.
- Hardware encoding works on machines whose only accelerator is VAAPI.
- Transcoding settings are checked before they are saved, so a value like a zero-second segment
  is refused instead of producing a library that will not play.
- Changing the segment duration clears the segment cache, which otherwise no longer matched the
  playlists.
- Identifying a show now re-scrapes its seasons and episodes against the show you picked,
  instead of leaving them with the wrong show's descriptions and artwork.
- Seasons are scraped after their show has been matched rather than after a fixed delay, so
  a slow show no longer leaves its seasons with nothing but a folder name.
- Audio items no longer play twice: the page rendered its own element alongside the shared one.
- Playback failures stop after a few recovery attempts and show a retry instead of spinning.
- The last playback position is saved when a tab is closed or hidden.
- Up Next offers the first unwatched episode rather than always the next one.
- Preferred quality is remembered as a height, so it means the same thing on the next title.

### Changed
- Scanning reads the filesystem asynchronously, so a large folder on a slow mount no longer
  stalls the rest of the server, and two libraries can be scanned at once.
- Pages share one data cache, so the library list is fetched once for the header, the sidebar
  and the home page rather than three times, and returning to a page you just left is instant.
- Each page's code is downloaded when you first open it instead of all of it up front.
- Video encoder detection runs just after the server starts answering requests rather than
  during startup, so a machine with several unusable encoders boots without the wait.
- A re-scrape keeps artwork that has not changed at the provider, so a full scan of a large
  library no longer re-downloads every poster, backdrop and cast photo.
- Repeated provider lookups during a scan are answered from a short-lived cache, cutting the
  number of API calls a season or a show's episodes make.
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
