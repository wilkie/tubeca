# Changelog

All notable changes to Tubeca are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are git tags (`v1.2.3`).

## [Unreleased]

### Added
- Hover-scrub previews can be generated for a video rather than only imported from a folder
  something else made. An editor asks for them per item; a library that wants them for everything
  it imports can set `trickplay.auto`, bearing in mind each one decodes the whole file.
- TVDB can now match films, not only shows: a film search asks for films, and a film's own record
  supplies its description, runtime, certificate, cast and artwork.
- The images dialog now shows the other artwork the provider has for a title — usually a dozen
  posters, backdrops and logos rather than the one a scrape picked — and downloads one only when
  you choose it.
- A search box in the header, so searching no longer means going to the search page first.
- A library remembers which content ratings you hid and which keywords you filtered by, the way
  it already remembered posters-or-list and the sort.
- A daily database backup, `tubeca-backup.timer`, keeping the last seven copies and catching up
  if the machine was off; upgrades already made one, this covers the days in between.
- `REDIS_DB` selects which Redis database the queues use, so a second server on the same machine
  no longer takes jobs meant for the first.
- TVDB can now identify and scrape a show and its seasons, not only episodes; its requests time
  out after ten seconds and are retried when the fault looks temporary, and its logos resolve
  (the artwork id being asked for was a season banner, which a show never has). A show scraped
  from TVDB no longer arrives with a rating of several million: that number is how many people
  have it in a list, not a score out of ten.
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
- Editors can upload their own artwork and choose which image a title uses.
- Installing or upgrading copies the database first, keeping the last five copies, and says so
  when a migration fails instead of finishing quietly.
- Poster grids and list rows are served images sized for them rather than the provider's
  originals, which for a backdrop can be several megabytes.
- The library dialog can browse the server's folders instead of asking you to type a path.

### Fixed
- Playback works in Safari and on iOS. The playlists named their variants and segments without a
  token, and Safari plays HLS itself rather than through hls.js, so every request after the first
  was rejected and the player sat there black and silent.
- Subtitle tracks that are images rather than text are no longer offered: choosing one produced
  nothing and said nothing. Text tracks are now extracted once instead of re-reading the whole
  film every time the menu is opened.
- A title a provider has deleted is now recorded as unmatched instead of being retried three
  times and left as a failure, and a season whose scrape hit a timeout is retried instead of
  being written off as unmatched. The two cases had been the other way round.
- 98 pieces of interface text were not actually translatable: the code asked for a key that was
  not in the translation file and fell back to the English written beside it. They are now real
  entries, and a test keeps it that way.
- The installer for distributions without a package backed up a database file it had never
  written — it looked for `tubeca.db` while writing `prod.db` — so an upgrade migrated without a
  copy to fall back on.
- Screen readers can now name the favourite, watch later and add buttons on a card, the play
  button on a queue row or a list row, and the filter and identify-search buttons; they were
  unlabelled icons.
- The quick-search counter, the play tooltip and the collection-type chip are translated rather
  than hard-coded English.
- Typing a new collection name in the multi-select bar no longer loses letters: the menu around
  the field was treating them as type-ahead and jumping to a collection instead.
- Reordering a collection can no longer move items that belong to somebody else's, and a
  reorder that only covers part of a list no longer leaves items sharing a position.
- The playback queue only accepts media items, and checks they exist, instead of accepting
  anything and silently dropping it on the next reorder.
- Favourites, Watch Later and the queue cannot be renamed, deleted or added to through the
  generic collection routes, and two requests at once can no longer create two of them.
- Deleting a collection or a media item that is not there answers "not found" rather than
  reporting a server error.
- Identifying a title removes the old artwork files, instead of leaving them on disk.
- A season's episodes are listed in episode order rather than alphabetically, so episode 10
  no longer sorts before episode 2.
- Artwork downloads give up after twenty seconds, refuse anything that is not an image, and
  refuse anything over 25 MB, so one bad URL can no longer stall a scrape.
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
- Both scrapers share one pooled connection and DNS cache, so TVDB gets the treatment TMDB had for
  network mounts where name lookups are slow. TVDB also keeps the top twenty credits of a title
  rather than all sixty, as TMDB does.
- The database now lives in `/var/lib/tubeca/tubeca.db` rather than inside the installed program
  files, where a package upgrade could replace it. An upgrade moves an existing one across,
  write-ahead log included, after taking a copy of it.
- Video starts sooner. A segment that has to be encoded is now sent as it is produced instead of
  after it finishes, which on a machine without hardware encoding is the difference between
  waiting a fraction of a second and waiting for six seconds of video to encode.
- The app downloads about half as much before it can show you anything: the video engine is
  fetched the first time you play something rather than on the way to the login form.
- Coming back to a library or a search you had scrolled through shows what you were looking at
  instead of reloading from the top.
- The services now tell systemd when they are ready and keep reporting that they can still
  reach the database and Redis, so a stuck process is restarted rather than sitting there.
- Crash logs point at the source rather than the bundle.
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
