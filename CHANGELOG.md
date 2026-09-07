# Changelog

All notable changes to Tubeca are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are git tags (`v1.2.3`).

## [Unreleased]

### Added
- Hover-scrub previews can be generated for a video rather than only imported from a folder
  something else made. An editor asks for them per item; a library that wants them for everything
  it imports can set `trickplay.auto`, bearing in mind each one decodes the whole file. Generated
  previews record their own spacing, so changing `trickplay.interval` shows the right frame rather
  than one from the wrong moment.
- TVDB can now match films, not only shows: a film search asks for films, and a film's own record
  supplies its description, runtime, certificate, cast and artwork.
- The images dialog now shows the other artwork the provider has for a title — usually a dozen
  posters, backdrops and logos rather than the one a scrape picked — and downloads one only when
  you choose it.
- A metadata status page per library, reached from the icon beside the library's filters, which
  badges how many items have none. It lists what did not match and why — with the season or show
  each item sits under, so two files called "Pilot" can be told apart — and filters by outcome.
  Until now the only way to find the handful of failures in a library of thirty thousand files was
  to open them one at a time.
- "Mark all watched" and "Mark all unwatched" on a season or show, instead of clicking through
  twenty-two episodes to record what you already saw elsewhere.
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

### Removed
- An unused video player component that predated the current one and had not been rendered by any
  page for months. Nothing changes for a viewer; the hover-preview tests it carried moved to the
  controls that actually implement them.

### Changed
- The Original quality is now served as fragmented MP4 rather than MPEG-TS. Playing a file as it
  is no longer means repacking every byte on the way out.

### Added
- Admins can re-read season and episode numbers for a library that was imported before the parser
  understood its naming, and re-queue the metadata for what it fixes: `POST` to
  `/api/libraries/<id>/repair-episodes`, with `?dryRun=true` to see what it would do first.
- A group can be made view-only. Until now an Editor could edit every library they could see; a
  group with "members can change these libraries" turned off lets them watch without being able to
  rename, delete, re-scrape or re-artwork anything in it. Existing groups keep the run of their
  libraries, as before.
- An admin can find and remove image files nothing points at any more — left behind when a provider
  changes format, or by deletions in older versions. `GET /api/images/orphans` lists them with
  their total size; `DELETE` removes them. Cached resized copies are recognised and kept.
- HEVC and AV1 files can be played as they are, on a browser that can decode them. On the library
  this was measured against that is 2,496 files out of 30,014 — 8.3%, essentially all of it HEVC —
  which until now was re-encoded on every play even on hardware that would have played the file
  untouched. Files needing the picture transcoded fall from 26% to 18%. Each quality now says what it contains, so a browser that cannot
  decode it quietly picks a transcode instead of failing.

### Security
- The server no longer makes requests to itself or the network around it on a caller's say-so.
  Saving an image from a URL — and any artwork URL a metadata provider returns — accepted whatever
  address it was given, including `localhost`, private ranges and a cloud host's metadata service,
  which let anyone who could edit the library probe what was listening there. Only public http and
  https addresses are fetched now, checked where the connection is actually opened so that
  redirects and DNS tricks are covered too.
- Artwork is only downloaded from hosts the installed metadata scrapers say their images come from,
  so a provider that has been compromised — or has simply changed — cannot have arbitrary files
  saved into the library as posters. `images.allowedHosts` in `tubeca.config.json` adds to that
  list for anyone running a scraper that does not declare its own.

### Changed
- Segments are now cut at each file's own keyframes instead of on a fixed six-second grid. A
  file's keyframes are read once, in the background, the first time somebody plays it; until then
  it plays on the grid as before, and a file whose keyframes cannot be read stays there.

### Fixed
- Original quality no longer skips forward past the start of a segment. Segments were cut on a
  grid, but a copied segment can only begin at a keyframe, so its content started at the next one
  — on one episode a segment labelled as beginning at 30.0s actually began at 34.91s, leaving
  nearly five seconds of the episode out and playing the rest late.
- Playing a file at Original quality no longer drifts out of sync or jumps backwards. Each segment
  was being built from up to a keyframe earlier than the point it claimed to start at — on one
  episode, ten and a half seconds of video labelled as six — so the picture ran late, segments
  overlapped, and the audio and video came apart. Introduced on 2026-09-05 and fixed the next day;
  cached segments from those two days are discarded.
- Watched-progress roll-ups no longer fail on a large library. Opening a library page asks how much
  of every show has been watched, and the question named every episode at once — more than the
  database will accept in one query.
- Deleting a large library, or scanning in more than about a thousand files at once, no longer
  crashes the server. Both build a list of every row involved and hand it to the database in one
  go, which SQLite refuses past 999 items — and the database layer answers that by panicking rather
  than reporting an error. Those lists are now sent in batches.
- Television episodes named `14 - Karen Peralta.mkv` inside a `Season 3` folder are matched again.
  The filename parser only understood `S03E14`-style names and never looked at the folder, so two
  in five episodes had no season or episode number — and without those, the scraper cannot ask for
  an episode and falls back to searching for a show called "14 - Karen Peralta", which never
  matches. Three-digit episode numbers (`s01e118`) and names like `Ace Attorney S2 - 22` were also
  being missed.
- Artwork that has not changed is no longer rewritten. Providers re-issue image URLs without
  changing the picture behind them, and every re-scrape was overwriting the identical file — which
  changes its timestamp and makes every browser and proxy fetch it again for nothing.


- Original quality no longer skips. Each six-second segment held about four seconds of picture,
  because the seek was placed where FFmpeg counted the part it threw away against the length asked
  for, so playback jumped forward at every segment boundary.
- Dialogs fit a phone. Choosing artwork, picking a folder, identifying a show, editing a library or
  a user — all of them opened as a desktop-sized box on a 390-pixel screen, with their content cut
  off at the edges. They now take the whole screen below 600 pixels wide. The short "are you sure?"
  confirmations still open as a box, where a full screen would be worse.
- The rest of the app follows the player onto a phone: the library tabs move into the drawer where
  they no longer overflow the bar, a show's hero is as tall as it needs to be rather than a full
  screen of artwork with the episodes below the fold, and list rows are tighter. Pages also stop
  scrolling sideways on a narrow screen — every hero reached eight pixels past each edge.
- The player speaks the interface language. Every label and menu entry in the video controls was
  English regardless of locale, and audio and subtitle tracks were named from a list of nineteen
  languages; they now come from the browser's own language data, so a French viewer sees
  "allemand" and a language outside that list of nineteen gets a name at all.
- Every button in the video controls tells a screen reader what it does, and the ones that change
  meaning — play/pause, mute, fullscreen — say what pressing them will do.
- The player fits a phone. The floating mini player scales with the screen instead of sitting at a
  fixed 320 pixels wide — which on a phone covered most of the page — and the full player's control
  row drops the volume slider and moves the time under the progress bar, so the buttons stop
  crowding each other.
- The player works by touch. The mini player can be dragged with a finger, dragging along the
  progress bar shows the preview frames a mouse got on hover, and a tap brings the controls back
  instead of pausing — before this, a touch device could start something playing and then not
  move, scrub or reveal the player again.
- Losing your place is harder: a progress update the server refuses is now retried rather than
  discarded, so a moment of bad network no longer means starting the episode again.
- Search results show whether you have watched something, which is where an episode is most often
  seen away from its season.
- Favourites, watch later, the playback queue and your own collections show it too, so a list you
  saved months ago no longer has to be checked one item at a time.
- Two people watching the same file no longer interfere with each other: a seek used to cancel
  everyone's speculative work on that file, so two viewers a few minutes apart spent their time
  undoing each other and re-encoding what they had just thrown away.
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
- A machine with a GPU now decodes on it as well as encoding on it, for the files that genuinely
  have to be converted: about a third of the processor time per segment, leaving the rest for
  everyone else watching.
- A file whose picture the browser can play but whose sound it cannot — nearly half of a typical
  library, anything with AC-3, E-AC-3 or DTS audio — is no longer re-encoded in full. The picture
  is passed through untouched and only the sound is converted, which on a 1080p episode is about a
  thirtieth of the work and the difference between keeping up and falling behind.
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
