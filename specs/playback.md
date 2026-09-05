# Playback Experience (Player, Queue Continuation, Mini Player)

> The frontend half of playback: a single, app-wide `<video>` element owned by `PlayerContext`
> that is physically moved between the full-screen `PlayPage`, a draggable `MiniPlayer`, and an
> off-screen holding div, so playback survives navigation. It drives HLS.js against the backend's
> on-demand HLS endpoints, exposes audio/subtitle/quality menus and a trickplay scrub preview, and
> continues automatically through the user's playback queue or the next episode/season.

## Responsibilities

- Load a media item by id (`playMedia`), fetch its stream/track metadata and trickplay info, and
  start HLS playback in the shared `<video>` element.
- Keep playback state (playing, time, duration, volume, mute, loading, selected tracks, quality) in
  one React context so any page can read or control it.
- Render the full-screen player (`PlayPage`) and the persistent mini player (`MiniPlayer`) over the
  same video element without reloading the stream when switching between them.
- Provide the controls overlay (`VideoControls`) used by both surfaces, including seek bar with
  trickplay thumbnails, audio/subtitle/quality menus, fullscreen, skip previous/next, expand/close.
- Configure HLS.js for on-the-fly transcoding (long timeouts, conservative ABR) and remember the
  last stable quality level in `localStorage` for faster startup next time.
- Compute "next" and "previous" items from the server-side playback queue, falling back to the next
  episode in the season and then the first episode of the next season; show the Up Next popup 30 s
  before the end and auto-play on `ended`.
- Play `Audio`-type media through a native `<audio>` element on `PlayPage`.

## Goals

- **Playback that survives navigation.** The video element is created once in `PlayerProvider`
  and re-parented with `appendChild` rather than re-rendered (3d28f43), so browsing the library
  while something plays in the corner does not restart the stream.
- **Smooth startup on a transcoding backend.** Every HLS.js knob (111d260, 38a5bdc) is tuned for
  the case where segments are produced by FFmpeg as they are requested: 30 s fragment timeouts,
  6 retries, 10 s starvation delay, 70%/50% bandwidth factors, minimal stall nudging.
- **Learn what worked last time.** The saved quality level (fc7c3a8) trades initial quality for
  reliability: start where the previous session was stable, back off on stalls.
- **Binge continuation.** Queue-based and episode-based continuation (993c6cc, a81f85e) so a
  season plays through without user action.
- **One controls component.** `VideoControls` is shared by the full player and the mini player
  via a `compact` flag; menus are rendered inside the player container so they work in fullscreen.

Resume and watched state were added on 2026-09-03, touch input on 2026-09-04, and a phone-shaped
layout on 2026-09-05.

## Components

| File | Role |
|------|------|
| `frontend/ui/src/context/PlayerContext.tsx` | Global player state, HLS.js lifecycle, the shared `<video>` element and its DOM re-parenting, queue/next-item resolution, auto-advance. Renders `MiniPlayer` itself. |
| `frontend/ui/src/pages/PlayPage.tsx` | `/play/:mediaId` route. Registers its container as the fullscreen host, syncs URL with `currentMedia`, controls auto-hide, mounts `VideoControls` and `UpNextPopup`; native `<audio>` path for Audio media. |
| `frontend/ui/src/components/VideoControls.tsx` | Presentational controls overlay: seek/volume sliders, trickplay preview, audio/subtitle/quality menus, fullscreen/expand/close/skip buttons. Also exports `formatTime`, `formatAudioTrackLabel`, `formatSubtitleTrackLabel`. |
| `frontend/ui/src/components/MiniPlayer.tsx` | 320x180 fixed `Paper` snapped to one of four corners, mouse-draggable, hosts the video container plus compact controls. |
| `frontend/ui/src/components/UpNextPopup.tsx` | Countdown card shown in the last 30 s with Start/Hide; dismissal is per next-item id. |
| `frontend/ui/src/components/VideoPlayer.tsx` | Legacy self-contained player (pre-HLS, `start=`-offset seeking). Exported from `components/index.ts` but no page imports it; only its test does. |
| `frontend/ui/src/api/client.ts:562-651` | URL builders: `getVideoStreamUrl`, `getAudioStreamUrl`, `getSubtitleUrl`, `getHlsMasterPlaylistUrl`, `getTrickplaySpriteUrl`; fetchers `getTrickplayInfo`, `getHlsQualities` (unused), `getPlaybackQueue`. |
| `frontend/ui/src/main.tsx:31` | Mounts `PlayerProvider` inside `BrowserRouter`/`AuthProvider` (needed because `VideoControls` calls `useNavigate`). |
| `frontend/ui/src/components/__tests__/{VideoPlayer,VideoControls,MiniPlayer}.test.tsx`, `context/__tests__/PlayerContext.test.tsx`, `pages/__tests__/PlayPage.test.tsx` | Jest/RTL coverage (6a4f5a8, 1a2a410). |

## How It Works

### The single video element and mode switching

`PlayerProvider` renders one absolutely-positioned `<div ref={videoContainerRef}>` containing the
`<video>` (`PlayerContext.tsx:1098-1114`). A `useLayoutEffect` moves that div with `appendChild`
into one of three parents: the element registered by `PlayPage` (`registerFullscreenContainer`),
the `MiniPlayer`'s inner box, or a hidden 1x1 fixed div at (-9999,-9999). Because React never
unmounts the element, HLS.js stays attached across route changes.

`mode` is `'fullscreen' | 'mini' | 'hidden'`. `playMedia` sets it to `fullscreen` if a container
is registered, else `mini`; `PlayPage` unmounting calls `registerFullscreenContainer(null)`, which
flips the mode to `mini`, so navigating away from `/play/...` automatically drops into the corner
player. `close()` destroys HLS, clears `src`, and sets `hidden`.

Since the video lives outside React's tree for the current page, mouse-move, mouse-down and click
handlers are injected through `registerMouseMoveHandler` / `registerMouseDownHandler` /
`registerClickHandler` refs; `PlayPage` and `MiniPlayer` register their own on mount.

### Entry points

- `MediaPage`, `CollectionPage`, `LibraryPage` "Play": `apiClient.setPlaybackQueue([{mediaId}])`
  then `navigate('/play/:id')`; `PlayPage` calls `playMedia` when `currentMedia` is null.
- "Play in mini player" (`FilmHeroView`/`ShowHeroView` menu -> `CollectionPage:258`): sets the
  queue then calls `playMedia` without navigating, so mode resolves to `mini`.
- `QueuePage` and `UserCollectionPage` (playlists): `setPlaybackQueue(items)`, `refreshQueue()`,
  `await playMedia(id)`, then navigate.
- `PlayPage` URL sync (`PlayPage.tsx:74`): if `currentMedia.id !== mediaId` it rewrites the URL
  with `replace: true` rather than reloading, so `playNext` keeps the address bar honest.

### Request flow for a video (`playMedia`, `PlayerContext.tsx:450`)

1. `Promise.all([GET /api/media/:id, GET /api/stream/trickplay/:id])`. Audio and subtitle
   tracks are derived from `media.streams` (`streamType === 'Audio' | 'Subtitle'`); each subtitle
   gets `url = /api/stream/subtitles/:id?token=JWT&streamIndex=N`. Poster is the collection's (or
   parent's) Backdrop via `/api/images/:id/file?token=`. Only `trickplay.resolutions[0]` is kept.
2. Default audio track = first `isDefault` stream, else the first audio stream.
3. `initHls(mediaId, defaultAudioTrack)` (`:179`): destroys any prior `Hls`, builds
   `GET /api/stream/hls/:id/master.m3u8?token=JWT[&audioTrack=N]`.
4. If `Hls.isSupported()`: `new Hls({...})` with `xhrSetup` adding `Authorization: Bearer <token>`
   from `localStorage.token` to every playlist/segment request, then `loadSource` + `attachMedia`.
   The master playlist returned by the backend lists variants as relative
   `<quality>.m3u8?audioTrack=<N|default>` (`backend/src/services/hlsService.ts:188,197`), so all
   subsequent requests are `GET /api/stream/hls/:id/<quality>.m3u8?audioTrack=..` and
   `GET /api/stream/hls/:id/<quality>/<segment>.ts?audioTrack=..`, authenticated by header only.
   Segment production, prefetch and concurrency are the backend's concern; see
   [Streaming and Transcoding](streaming-and-transcoding.md). What the player relies on: requesting
   a variant playlist triggers prefetch of the first `prefetchSegments` (default 2, 0fc5947)
   segments, and each segment request prefetches the next N, so sequential playback rarely waits.
   Since 2026-09-03 a segment the player is waiting for also takes an encoder slot ahead of any
   prefetch, and a seek cancels the prefetches for the position just left, so the first segment
   after a jump no longer queues behind speculative work.
5. On `MANIFEST_PARSED` the level list becomes `availableQualities` (`Auto` prepended; labels from
   the playlist `NAME` attribute) and `video.play()` is attempted (autoplay rejection swallowed).

Each viewing is named: `initHls` mints a UUID and sends it with the master playlist request, and the server repeats it on every URI it hands back, so a seek abandons only that viewer's prefetches. An audio-track change keeps the same name, being the same viewing.
6. Else if `video.canPlayType('application/vnd.apple.mpegurl')` (Safari): `video.src = hlsUrl`,
   with an `error` listener so a rejected playlist or an unplayable file says so. Otherwise
   `playback.errorUnsupported` is shown rather than a black element.

`GET /api/stream/hls/:id/qualities` exists in the client but is never called; qualities come from
the manifest.

### HLS.js configuration (`PlayerContext.tsx:200-251`)

Introduced in 111d260 and then made more conservative in 38a5bdc after software-transcoding
stalls: `startLevel` = saved level or 0, `abrEwmaDefaultEstimate` 1 Mbps, EWMA fast/slow 5/15,
`abrBandWidthFactor` 0.7, `abrBandWidthUpFactor` 0.5, `maxBufferLength` 60 s (max 120 s, 60 MB),
`backBufferLength` 30 s, `fragLoadingTimeOut` 30 s with 6 retries over 60 s, level loading 15 s
with 4 retries, `nudgeOffset` 0.1 / `nudgeMaxRetry` 3, `maxStarvationDelay` and `maxLoadingDelay`
10 s, `lowLatencyMode: false`, `startFragPrefetch: true`, `startPosition: 0`. The same block is
duplicated verbatim in `setAudioTrack` (`:653-690`).

hls.js is declared as `^1.6.15` in `frontend/ui/package.json` and resolved to 1.6.15 in
`pnpm-lock.yaml`; no runtime version check.

### Remembered quality level (fc7c3a8)

`localStorage.tubeca_last_quality_level` stores an HLS *level index*. On `FRAG_BUFFERED` (`:288`)
a counter tracks consecutive fragments at the same level; after `STABLE_FRAGMENT_COUNT = 5` the
index is saved only if it is higher than the stored one. On a non-fatal `BUFFER_STALLED_ERROR`
(`:337`) at or below the saved level, the saved value is decremented (never below 0) and the
counter resets. Next `initHls` reads it as `startLevel`. Every FRAG/LEVEL event also
`console.log`s bandwidth and timing lines, unconditionally, in production builds.

### Seeking and start offsets

Two mechanisms coexist:

- **HLS path** (`seekCommit`, `:579`): if an `Hls` instance exists or native HLS is supported,
  it simply sets `video.currentTime = time` and clears `seekOffset`. The backend's variant
  playlist is a full VOD list, so HLS.js jumps straight to the segment containing `time`; nothing
  about "start" is sent. Slider `onChange` only updates displayed time; `onChangeCommitted` seeks.
- **Legacy `start=` path** (`getVideoStreamUrl(id, start, audioTrack)` -> `/api/stream/video/:id
  ?token=&start=S&audioTrack=N`): used by `PlayerContext` for non-video media and by the unused
  `VideoPlayer.tsx`. Here the element's own `currentTime` restarts at 0 so `seekOffset` is added
  to every `timeupdate` to produce the displayed position, and playback resumes on the next
  `canplay`.

### Audio track and subtitle selection

- `setAudioTrack` (`:631`) records `video.currentTime`, the current level and playing state,
  destroys the `Hls` instance and creates a new one against `master.m3u8?audioTrack=N` with
  `startPosition` = that time and `startLevel` = the previous level (segments for that level may
  already be cached server-side). On `MANIFEST_PARSED` it restores `currentLevel` (or -1 for
  Auto) and resumes. This second instance has only a logging `ERROR` handler: no stall tracking,
  no fatal recovery.
- Subtitles are `<track kind="subtitles" src=/api/stream/subtitles/..>` children of the video,
  one per subtitle stream (WebVTT from the backend). `setSubtitleTrack` only changes state; an
  effect sets `textTracks[i].mode` to `showing`/`hidden` by matching index order.
  `crossOrigin="anonymous"` is set so cross-origin VTT loads.
- The audio menu is hidden unless there are 2+ tracks; the subtitle menu always has an "Off" item.

### Quality selection

`setQuality('auto')` sets `hls.currentLevel = -1`; otherwise it finds the level whose `name` or
`${height}p` matches and sets `currentLevel` (an immediate switch that flushes the buffer, as
opposed to `nextLevel`). The quality button is only shown with more than one option and is tinted
when not on Auto. Selecting a quality does not affect the remembered level.

### Trickplay preview (`VideoControls.tsx:321-361`)

On pointer move over the slider box (mouse, touch or pen — a finger dragged along the bar scrubs
with a preview, since a touch screen never hovers), the fraction is mapped to `previewTime`; the
preview is cleared on pointer leave, up or cancel, and the box sets `touch-action: none` so the
drag does not scroll the page instead. The tooltip's
`left` is clamped to `[tileWidth/2, sliderWidth - tileWidth/2]` (1a2a410) so it never overflows.
`getTrickplayStyle` computes `frameIndex = floor(time / interval)`, sprite sheet index
`floor(frameIndex / tileCount)`, and `background-position` from column/row, pointing at
`GET /api/stream/trickplay/:id/:width/:index?token=`. Sheets load lazily on hover, one request
per sheet. Not shown in `compact` mode.

### Controls, keyboard, fullscreen

- Controls auto-hide after 3 s of no mouse movement while playing (`PlayPage`, `MiniPlayer`, and
  legacy `VideoPlayer` each implement this independently); the cursor is hidden with them.
- `PlayPage.tsx:117-133` listens for Arrow keys, Space, Enter, Escape, `f`, `m` on `document`
  **only to re-show the controls**. None of them act: there is no play/pause, seek, volume, mute
  or fullscreen shortcut. Only the MUI sliders respond to keys when focused.
- Fullscreen uses `containerRef.current.requestFullscreen()` on `PlayPage`'s fixed container
  (z-index 9999); menus pass `container={containerRef}` so MUI portals render inside the
  fullscreen element. Note `isFullscreen` is never passed by `PlayPage`, so the icon never flips
  to "exit fullscreen" there.

### Mini player (3d28f43)

`MiniPlayer` reads everything from `usePlayer()`. Position is one of four corners persisted in
`localStorage.tubeca_miniplayer_position`. Dragging starts on mouse-down anywhere except buttons
and sliders, follows the pointer clamped to the viewport (top >= 64 px nav bar), and on mouse-up
snaps to the nearest corner by centre point (`MiniPlayer.tsx:62`). Compact controls show
play/pause, mute, expand (`navigate('/play/:id')`) and close. Because the video is re-parented
into it, the drag handler must be registered with the context so mouse-downs on the video itself
start a drag.

### Queue continuation and Up Next (993c6cc, a81f85e)

`refreshQueue` (`:803`) fetches `GET /api/user-collections/queue` (the system "Queue" user
collection). An effect (`:816-948`) runs whenever `currentMedia` or `queue` changes:

1. `queueIndex` = position of the current media in the queue; `previousItem` = queue[index-1].
2. `nextItem` = queue[index+1] (`type: 'queue'`) if it exists.
3. Otherwise, if the media is an episode (`videoDetails.season`/`episode` set and has a
   `collectionId`), `GET /api/collections/:seasonId`, sort media by episode number, then ask
   `GET /api/watch/batch` about the episodes after this one and offer the first that is not
   completed (`type: 'episode'`). If the rest of the season is already watched it falls back to
   the immediate next episode, so Up Next always leads somewhere.
4. If it was the last episode, `GET /api/collections/:showId`, sort child seasons by
   `localeCompare(..., { numeric: true })` on **name**, `GET` the next season and take its first
   episode.
5. Else `nextItem = null`.

The effect is cancel-guarded but issues up to three sequential collection fetches per media
change. `playNext`/`playPrevious` call `playMedia`; a separate `ended` listener (`:972`) auto-plays
`nextItem`. `UpNextPopup` appears when `ceil(duration - currentTime) <= 30`, counts down, and
remembers dismissal by `nextItem.id` so it re-appears for the following item. Skip buttons appear
in `VideoControls` when `hasNextItem()` / `hasPreviousItem()`.

### Audio media

`PlayPage.tsx:224` renders `<audio controls autoPlay src=/api/stream/audio/:id?token=>` for
`type === 'Audio'`. However `playMedia` has already set the shared video element's `src` to
`/api/stream/video/:id?token=&start=0&audioTrack=N` and called `play()`, and because the audio
branch never attaches `containerRef`, mode resolves to `mini`. In practice two elements play
concurrently and the mini player appears alongside the native `<audio>`.

### Watch progress / resume

Positions are persisted server-side in `WatchProgress` (one row per user and media; see
[Content Model](content-model.md)) through `/api/watch/*`:

1. `playMedia` fetches `GET /api/watch/:mediaId` alongside the media. The saved position is
   used only if it is not `completed`, is at least 30 s in, and ends more than 10 s before the
   end; otherwise playback starts at 0. For HLS.js it becomes the `startPosition` config; for
   native HLS (Safari) and the audio `<audio src>` path it is applied as `currentTime` on
   `loadedmetadata`.
2. While playing, the `timeupdate` handler calls `reportProgress`, which is throttled to one
   `PUT /api/watch/:mediaId` every 10 s of wall-clock time. `pause`, `close` and switching to
   another item report immediately; `ended` calls `POST /api/watch/:mediaId/complete`. A
   `pagehide` or a switch to a hidden tab flushes the last position with `keepalive`, so closing
   the tab mid-episode does not lose it.
3. The server derives `completed` from the position: at or past 90% of the duration counts as
   watched, and a later report below that (a rewatch) clears it.

`HomePage` shows a Continue Watching strip (`ContinueWatchingRow`) from
`GET /api/watch/continue`: in-progress items in accessible libraries, newest first, each with a
progress bar and time left; clicking navigates to `/play/:id`, where the resume rule above
applies. Only the quality level index and mini-player corner remain in `localStorage`.

### Controls, errors and the operating system

`PlayPage` handles keys on `document` unless the event came from a text field or a
contenteditable element: space and `k` toggle playback, the left/right arrows and `j`/`l` seek
ten seconds (thirty with shift, clamped to the media's length), the up/down arrows move the
volume by five points, `m` mutes and `f` toggles fullscreen. Every handled key calls
`preventDefault` (space and the arrows would otherwise scroll) and reveals the controls.

Fatal HLS errors are retried at most `MAX_FATAL_RECOVERIES` (3) times, counted per load and
reset by `playMedia`. Past that the instance is destroyed and `error` is set to an i18n key,
which `PlayPage` renders as an alert with a Try again action wired to `retryPlayback()`; the
spinner is cleared so the player no longer sits loading for ever.

Preferred quality is stored as a **height** (`tubeca_last_quality_height`), not a level index,
because ladders differ between titles. hls.js is constructed with `autoStartLoad: false`; on
`MANIFEST_PARSED` the highest rung no taller than the remembered height becomes `startLevel`
and `startLoad(startPosition)` begins loading. A buffer stall lowers the remembered height to
the next rung down.

`navigator.mediaSession` carries the title and poster, play/pause/seek handlers, a `nexttrack`
handler while an Up Next item exists, and a `playbackState` that follows `isPlaying`, so OS
media keys and lock screens work.

Audio items play through the **same** shared element as video (`getAudioStreamUrl`), and
`PlayPage`'s audio branch registers its container like the video branch so the element is
portaled in; it renders `VideoControls` without the fullscreen button. Until 2026-09-03 the page
also rendered its own `<audio>` element, so audio played twice and a mini player appeared
alongside.

### Watched state on cards and lists

`useWatchState({ mediaIds, collectionIds })` (`frontend/ui/src/hooks/useWatchState.ts`) loads
`GET /api/watch/batch?mediaIds=` (progress rows keyed by media id) and
`GET /api/watch/collections?ids=` (per-collection roll-ups over the whole subtree: `total`,
`watched`, `inProgress`, and `resume` for the most recently played unfinished item), chunking at
200 ids, and exposes `setWatched(mediaId, watched)` which calls `POST /:id/complete` or `DELETE
/:id`, patches the local row and re-fetches the roll-ups. `WatchBadge` renders the state as a
card overlay: a green check for watched media or fully watched collections, an "N left" pill once
a collection has any watched or started items, and a thin progress bar for partly watched media
and single-item collections (films). `WatchedToggleButton` is the mark watched/unwatched control.
They are wired into `MediaGrid` (episode cards: badge plus an overlay toggle),
`ChildCollectionGrid` and `ShowHeroView` (season cards), `LibraryPage` (film and show cards in
both grid and list views), `SearchPage`, `FavoritesPage`, `WatchLaterPage`, `QueuePage` and
`UserCollectionPage` (badges only — these lists mix media and collections, so each row asks for
whichever badge fits), `FilmHeroView` and `MediaPage` (a labelled toggle beside Play).
`SortableMediaListItem` takes `watchProgress`/`watchSummary` and draws the badge over its
thumbnail, which is how the queue and playlist rows carry it.
Collections in libraries the user cannot access are omitted from the summaries endpoint.

## Interactions

- **Depends on:** [Streaming and Transcoding](streaming-and-transcoding.md) for
  `/api/stream/hls/*`, `/api/stream/video`, `/api/stream/audio`, `/api/stream/subtitles`,
  `/api/stream/trickplay/*` and the `streamAuth` middleware that accepts `?token=`;
  [Content Model](content-model.md) for `Media.streams`, `videoDetails.season/episode`, and
  season/show hierarchy used for continuation; [User Collections](user-collections.md) for the
  Queue system collection (`getPlaybackQueue`, `setPlaybackQueue`, `addToPlaybackQueue`);
  [Images](images.md) for the Backdrop poster; [Auth and Users](auth-and-users.md) for the JWT
  read directly from `localStorage.token`; [Configuration](configuration.md) for
  `prefetchSegments` / `maxConcurrentTranscodes` that shape startup latency.
- **Used by:** [Frontend App](frontend-app.md) (provider mounted in `main.tsx`; `MediaPage`,
  `CollectionPage`, `LibraryPage`, `QueuePage`, `UserCollectionPage`, hero views call
  `navigate('/play/..')` or `playMedia`). Nothing on the backend depends on the player.
- **Shared data:** reads `Media`, `MediaStream`, `Collection` (season/show), `UserCollection`
  (Queue) via the API; writes nothing server-side. Browser storage keys:
  `tubeca_last_quality_level`, `tubeca_miniplayer_position`, `token` (read only).

## History

- `dd02263` 2025-11-28 Basic media streaming: first `VideoPlayer` with `/stream/video` and `start=` seeking.
- `78254a5` 2025-11-30 Stream probing; audio track switching via `audioTrack=` reload.
- `2c4999c` 2025-11-30 Subtitle tracks as `<track>` WebVTT children.
- `ac951c2` 2025-12-02 Trickplay frame fixes and audio-desync-on-seek fix.
- `1a2a410` 2025-12-02 Clamp trickplay preview at slider edges; `VideoPlayer` tests.
- `3d28f43` 2025-12-04 Persistent mini player: `PlayerContext`, DOM re-parented video, `VideoControls` extracted, "Play in mini player".
- `d71d4e5` 2025-12-05 HLS streaming with HLS.js and quality menu; `PlayPage` moves onto the context.
- `6a4f5a8` 2025-12-05 Tests for `VideoControls`, `MiniPlayer`, `PlayerContext`.
- `993c6cc` 2025-12-07 Up Next popup, queue state, `playNext`, auto-advance, URL sync.
- `a81f85e` 2025-12-07 Continue into the first episode of the next season.
- `62dafea` 2025-12-13 Shared playlist component, play button, `playPrevious`/skip-previous.
- `111d260` 2025-12-16 HLS.js tuned for throughput (5 Mbps estimate, bigger buffers, retries).
- `38a5bdc` 2025-12-17 Re-tuned for software transcoding: start lowest, conservative ABR, no aggressive nudge, 30 s timeouts; backend initial prefetch.
- `fc7c3a8` 2025-12-17 Remember last stable quality level in `localStorage`.
- `0fc5947` 2025-12-19 `maxConcurrentTranscodes` semaphore; prefetch count follows `prefetchSegments` (no forced minimum of 3).
- 2026-09-03 Resume on play, throttled progress reporting, mark-watched on `ended`, and the Continue Watching strip on `HomePage` (`ContinueWatchingRow`); `PlayerContext` tests cover the resume rule and reporting.
- 2026-09-03 Watched badges and progress bars on library, season and episode cards; mark watched/unwatched on cards, film hero and media page; batch progress and collection summary endpoints.
- 2026-09-03 Playback batch: real keyboard shortcuts, bounded fatal-error recovery with a visible retry, progress flushed on tab close, Up Next skips watched episodes, quality remembered by height, audio plays through the shared element, Media Session integration.
- 2026-09-04 A failed progress report is retried on a backoff instead of being dropped, and search results show watched badges.
- 2026-09-04 Watched badges extended to favourites, watch later, the queue and user collections.
- 2026-09-04 `POST`/`DELETE /api/watch/collections/:id` mark or forget a whole subtree; "Mark all watched" on the collection menu.
- 2026-09-05 The player fits a phone: `MiniPlayer` scales with the viewport (55% of the width, 180-320px, 16:9) and the full controls drop the volume slider and move the time under the progress bar below `sm`.
- 2026-09-04 Player converted from mouse events to pointer events: touch drag of the mini player, scrub previews, tap-to-reveal controls.

## Known Limitations

- **A user collection's own card carries no roll-up.** As of 2026-09-04 every list a viewer
  builds — search, favourites, watch later, the queue and user collections — badges the films,
  episodes and library collections in it, but a row pointing at *another user collection*
  (`itemUserCollection`) still shows nothing, because summaries are computed over library
  collection subtrees rather than arbitrary item sets.
- **A report sent as the page closes cannot be retried.** An ordinary failed `PUT /api/watch` now
  retries on a backoff until it lands (2026-09-04), but the `keepalive` report on `pagehide` has
  no page left to retry from, so a viewer who closes a tab exactly when the network drops still
  loses that position. Nothing is written to local storage to recover it later.
- **The player's chrome adapts, its menus do not.** Below `sm` the control row sheds its volume
  slider and moves the time under the progress bar, and `MiniPlayer` scales with the viewport, but
  the quality, audio and subtitle menus are still desktop `Menu`s anchored to small buttons rather
  than sheets, and the mini player's four corners are the same four corners whatever the screen.

- **Safari's native HLS path worked only as far as the master playlist** until 2026-09-04: the
  variant and segment URIs carried no token, and a `<video>` element cannot be given headers, so
  every request after the first was rejected and playback stopped without a word. The playlists
  now repeat the token, and the native path reports an error rather than staying black.
- **Season ordering by name** in next-season continuation (`:896`) breaks for non-"Season N"
  naming or specials; `seasonDetails` is not available on the child summaries.
- **Continuation cost:** up to three collection fetches on every media change, even when the
  Up Next popup will never be shown (e.g. mini player).
- **Duplicated HLS config** (~50 lines) between `initHls` and `setAudioTrack`; stability
  tracking and fatal recovery are only wired in the first.
- **Verbose production logging:** every fragment/level event logs to the console.
- **Hard-coded English** in `VideoControls` ("Off", "Auto", "Track N", "Skip to next",
  aria-labels, the `LANGUAGE_NAMES` map) while `player.skipNext/expand/close` i18n keys exist and
  are unused. Play/pause, mute, fullscreen, expand and close buttons have no `aria-label`.
- `isFullscreen` is never passed from `PlayPage`, so its fullscreen icon never toggles.
- `VideoPlayer.tsx` is dead code kept alive by its test and the barrel export; the trickplay
  clamping tests exercise it rather than `VideoControls`.
- Tests: `PlayerContext.test.tsx` mocks `hls.js` and now covers the queue, the next-item and
  next-season resolver and `ended` auto-advance alongside the state setters; `setAudioTrack`
  recreation, `seekCommit` on HLS and the DOM re-parenting are still untested.
  `VideoControls.test.tsx` covers only the two negative trickplay cases.

## Opportunities

- **Offer "mark all watched" from a season card too** (S). The action lives on the collection
  page's overflow menu, so catching up on one season of a show open at the show level still means
  opening the season first.


- **Next-episode from Continue Watching** (S): when a completed episode has a successor, show
  the successor in the strip instead of dropping the show.



- **Extract `createHls(config, events)`** (S): one config object and one event wiring for
  `initHls` and `setAudioTrack`, so stability tracking and recovery apply to audio switches too.
  Prefer `hls.audioTrack`-style switching later if the backend exposes alternate audio renditions.

- **Bottom sheets for the player's menus on a phone** (S): quality, audio and subtitle selection
  are `Menu`s sized for a pointer. Touch input landed 2026-09-04 and the layout 2026-09-05.
- **Cheaper continuation** (S): skip next-episode resolution until `duration - currentTime < 60`
  or when in mini mode; sort seasons by `seasonDetails.seasonNumber` once the summary carries it.
- **Gate HLS debug logging** (S) behind `import.meta.env.DEV` or `debug: true`.
- **i18n and a11y pass on `VideoControls`** (S): use the existing `player.*` keys, add
  `aria-label`s to every icon button, and translate "Off"/"Auto"/language names.
- **Delete `VideoPlayer.tsx`** (S) and move the clamping tests onto `VideoControls`.
- **Tests** (S): `PlayerContext` tests for `setAudioTrack` recreation, `seekCommit` on HLS and the
  DOM re-parenting between the mini and fullscreen containers; the rest of this part is covered.
