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
  and re-parented with `appendChild` rather than re-rendered (70b750e), so browsing the library
  while something plays in the corner does not restart the stream.
- **Smooth startup on a transcoding backend.** Every HLS.js knob (3e30738, 665d354) is tuned for
  the case where segments are produced by FFmpeg as they are requested: 30 s fragment timeouts,
  6 retries, 10 s starvation delay, 70%/50% bandwidth factors, minimal stall nudging.
- **Learn what worked last time.** The saved quality level (31fe94d) trades initial quality for
  reliability: start where the previous session was stable, back off on stalls.
- **Binge continuation.** Queue-based and episode-based continuation (5d28769, 7d2b8da) so a
  season plays through without user action.
- **One controls component.** `VideoControls` is shared by the full player and the mini player
  via a `compact` flag; menus are rendered inside the player container so they work in fullscreen.

What the code does *not* optimise for: resuming where you left off, watched state, mobile/touch,
or keyboard control of playback (see Known Limitations).

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
| `frontend/ui/src/components/__tests__/{VideoPlayer,VideoControls,MiniPlayer}.test.tsx`, `context/__tests__/PlayerContext.test.tsx`, `pages/__tests__/PlayPage.test.tsx` | Jest/RTL coverage (a34d24e, 365da36). |

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
   a variant playlist triggers prefetch of the first `prefetchSegments` (default 2, 6e311ec)
   segments, and each segment request prefetches the next N, so sequential playback rarely waits.
5. On `MANIFEST_PARSED` the level list becomes `availableQualities` (`Auto` prepended; labels from
   the playlist `NAME` attribute) and `video.play()` is attempted (autoplay rejection swallowed).
6. Else if `video.canPlayType('application/vnd.apple.mpegurl')` (Safari): `video.src = hlsUrl`.
   Otherwise nothing is loaded and no error is surfaced.

`GET /api/stream/hls/:id/qualities` exists in the client but is never called; qualities come from
the manifest.

### HLS.js configuration (`PlayerContext.tsx:200-251`)

Introduced in 3e30738 and then made more conservative in 665d354 after software-transcoding
stalls: `startLevel` = saved level or 0, `abrEwmaDefaultEstimate` 1 Mbps, EWMA fast/slow 5/15,
`abrBandWidthFactor` 0.7, `abrBandWidthUpFactor` 0.5, `maxBufferLength` 60 s (max 120 s, 60 MB),
`backBufferLength` 30 s, `fragLoadingTimeOut` 30 s with 6 retries over 60 s, level loading 15 s
with 4 retries, `nudgeOffset` 0.1 / `nudgeMaxRetry` 3, `maxStarvationDelay` and `maxLoadingDelay`
10 s, `lowLatencyMode: false`, `startFragPrefetch: true`, `startPosition: 0`. The same block is
duplicated verbatim in `setAudioTrack` (`:653-690`).

hls.js is declared as `^1.6.15` in `frontend/ui/package.json` and resolved to 1.6.15 in
`pnpm-lock.yaml`; no runtime version check.

### Remembered quality level (31fe94d)

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

On mouse move over the slider box, the hover fraction is mapped to `previewTime`; the tooltip's
`left` is clamped to `[tileWidth/2, sliderWidth - tileWidth/2]` (365da36) so it never overflows.
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

### Mini player (70b750e)

`MiniPlayer` reads everything from `usePlayer()`. Position is one of four corners persisted in
`localStorage.tubeca_miniplayer_position`. Dragging starts on mouse-down anywhere except buttons
and sliders, follows the pointer clamped to the viewport (top >= 64 px nav bar), and on mouse-up
snaps to the nearest corner by centre point (`MiniPlayer.tsx:62`). Compact controls show
play/pause, mute, expand (`navigate('/play/:id')`) and close. Because the video is re-parented
into it, the drag handler must be registered with the context so mouse-downs on the video itself
start a drag.

### Queue continuation and Up Next (5d28769, 7d2b8da)

`refreshQueue` (`:803`) fetches `GET /api/user-collections/queue` (the system "Queue" user
collection). An effect (`:816-948`) runs whenever `currentMedia` or `queue` changes:

1. `queueIndex` = position of the current media in the queue; `previousItem` = queue[index-1].
2. `nextItem` = queue[index+1] (`type: 'queue'`) if it exists.
3. Otherwise, if the media is an episode (`videoDetails.season`/`episode` set and has a
   `collectionId`), `GET /api/collections/:seasonId`, sort media by episode number, take the next
   one (`type: 'episode'`).
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

Nothing is persisted. There is no Prisma model, route or `localStorage` key for playback
position or watched state; `startPosition` is hard-coded to 0 and `playMedia` resets
`currentTime`. The only persisted player data are the quality level index and the mini-player
corner.

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
- `aaeb5ea` 2025-11-30 Stream probing; audio track switching via `audioTrack=` reload.
- `f6331e4` 2025-11-30 Subtitle tracks as `<track>` WebVTT children.
- `1af4a83` 2025-12-02 Trickplay frame fixes and audio-desync-on-seek fix.
- `365da36` 2025-12-02 Clamp trickplay preview at slider edges; `VideoPlayer` tests.
- `70b750e` 2025-12-04 Persistent mini player: `PlayerContext`, DOM re-parented video, `VideoControls` extracted, "Play in mini player".
- `6888f86` 2025-12-05 HLS streaming with HLS.js and quality menu; `PlayPage` moves onto the context.
- `a34d24e` 2025-12-05 Tests for `VideoControls`, `MiniPlayer`, `PlayerContext`.
- `5d28769` 2025-12-07 Up Next popup, queue state, `playNext`, auto-advance, URL sync.
- `7d2b8da` 2025-12-07 Continue into the first episode of the next season.
- `5cbbd47` 2025-12-13 Shared playlist component, play button, `playPrevious`/skip-previous.
- `3e30738` 2025-12-16 HLS.js tuned for throughput (5 Mbps estimate, bigger buffers, retries).
- `665d354` 2025-12-17 Re-tuned for software transcoding: start lowest, conservative ABR, no aggressive nudge, 30 s timeouts; backend initial prefetch.
- `31fe94d` 2025-12-17 Remember last stable quality level in `localStorage`.
- `6e311ec` 2025-12-19 `maxConcurrentTranscodes` semaphore; prefetch count follows `prefetchSegments` (no forced minimum of 3).

## Known Limitations

- **No resume, no watched state, no "continue watching".** Every play starts at 0; nothing is
  reported to the server. Reloading `/play/:id` restarts the item.
- **No real keyboard shortcuts.** Space/arrows/`f`/`m` only reveal the controls (`PlayPage.tsx:117`).
- **No touch handling.** Drag, hover trickplay, and auto-hide are mouse-event only; `MiniPlayer`
  cannot be moved on touch devices and the preview never appears.
- **Audio media double-plays** (see "Audio media" above): shared video element and page `<audio>`
  both start, plus an unexpected mini player.
- **Safari native HLS path is effectively unauthenticated.** The master URL carries `?token=`, but
  variant/segment URIs generated by `hlsService` carry only `audioTrack`, and Safari cannot set
  headers, so variant loads should 401 on non-HLS.js browsers. Untested in the repo.
- **Error recovery is unbounded and silent.** Fatal `NETWORK_ERROR` -> `hls.startLoad()` and
  `MEDIA_ERROR` -> `recoverMediaError()` retry forever; other fatal errors destroy the instance
  with no UI. The spinner (`isLoading`) can stay on indefinitely; `PlayPage` only shows
  `media.notFound` when the metadata fetch fails. The audio-switch `Hls` instance has no recovery.
- **Saved quality level is an index, not a name.** Level order/length depends on the media's
  ladder (`original` + presets), so a level saved from a 1080p source may be out of range or mean
  a different quality for a 480p source.
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
- Tests: `PlayerContext.test.tsx` mocks `hls.js` and only asserts state setters and localStorage;
  `playMedia`, `initHls` events, quality persistence, `setAudioTrack`, `seekCommit` on HLS, the
  next-item/next-season resolver, `ended` auto-advance and the DOM re-parenting are untested.
  `UpNextPopup` has no test. `VideoControls.test.tsx` covers only the two negative trickplay cases.

## Opportunities

- **Persist playback position and watched state** (M/L): add a `WatchProgress` model keyed by
  user+media, throttle-report `currentTime` from the `timeupdate` handler, and use it as
  `startPosition`/`video.currentTime` on load; enables Continue Watching rows and "resume" on
  `MediaPage`. Natural given the single context already owns `currentTime`.
- **Real keyboard shortcuts** (S): extend `PlayPage`'s keydown handler to call `togglePlay`,
  `seekCommit(±10)`, `setVolume`, `toggleMute`, `handleFullscreenToggle`; ignore when focus is in
  an input.
- **Fix Audio media playback** (S): either make `playMedia` skip loading the shared element for
  Audio, or drop `PlayPage`'s `<audio>` and drive the shared element through `VideoControls`
  (which would also give audio the mini player, queue and Up Next for free).
- **Surface playback errors** (S/M): bound the fatal-retry loops, set an `error` state in the
  context, and show a retry/back UI in `PlayPage`/`MiniPlayer`; reset `isLoading` on failure.
- **Extract `createHls(config, events)`** (S): one config object and one event wiring for
  `initHls` and `setAudioTrack`, so stability tracking and recovery apply to audio switches too.
  Prefer `hls.audioTrack`-style switching later if the backend exposes alternate audio renditions.
- **Store quality preference by name/height rather than index** (S): save `levels[i].height` and
  resolve `startLevel` after `MANIFEST_PARSED` (or via `hls.startLevel` once levels are known).
- **Token in master-playlist variant URIs or proper Safari path** (S): have `hlsService` propagate
  `token` into variant/segment URIs when present, or drop the native path and require HLS.js.
- **Touch support** (M): pointer events for drag and a tap-to-toggle-controls model; show
  trickplay while scrubbing via `onChange` on touch.
- **Cheaper continuation** (S): skip next-episode resolution until `duration - currentTime < 60`
  or when in mini mode; sort seasons by `seasonDetails.seasonNumber` once the summary carries it.
- **Gate HLS debug logging** (S) behind `import.meta.env.DEV` or `debug: true`.
- **i18n and a11y pass on `VideoControls`** (S): use the existing `player.*` keys, add
  `aria-label`s to every icon button, and translate "Off"/"Auto"/language names.
- **Delete `VideoPlayer.tsx`** (S) and move the clamping tests onto `VideoControls`.
- **Tests** (M): `PlayerContext` tests for `playMedia` request flow (media + trickplay), HLS event
  handling incl. quality persistence and stall back-off, `setAudioTrack` recreation, the
  queue/episode/season resolver, and `ended` auto-advance; a `UpNextPopup` test for the 30 s window
  and per-item dismissal.
- **Media Session API** (S): expose title/poster and play/pause/next to OS media controls, which
  the mini player model makes cheap.
