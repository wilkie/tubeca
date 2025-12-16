import { createContext, useContext, useState, useRef, useCallback, useEffect, useLayoutEffect, type ReactNode } from 'react';
import Hls from 'hls.js';
import { apiClient, type Media, type TrickplayResolution, type UserCollectionItem } from '../api/client';
import type { AudioTrackInfo, SubtitleTrackInfo } from '../components/VideoControls';
import { MiniPlayer } from '../components/MiniPlayer';

// Types
export type MiniPlayerPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface QualityOption {
  name: string;
  label: string;
  bandwidth: number;
}

export interface CurrentMedia {
  id: string;
  name: string;
  duration: number;
  type: 'Video' | 'Audio';
  audioTracks: AudioTrackInfo[];
  subtitleTracks: SubtitleTrackInfo[];
  trickplay?: TrickplayResolution;
  poster?: string;
  // For episode detection
  collectionId?: string;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  isEpisode?: boolean;
}

interface PlayerContextState {
  currentMedia: CurrentMedia | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isLoading: boolean;
  currentAudioTrack: number | undefined;
  currentSubtitleTrack: number | null;
  currentQuality: string;
  availableQualities: QualityOption[];
  mode: 'fullscreen' | 'mini' | 'hidden';
  miniPlayerPosition: MiniPlayerPosition;
  // Queue and next/previous item
  queue: UserCollectionItem[];
  queueIndex: number;
  nextItem: NextItemInfo | null;
  previousItem: NextItemInfo | null;
}

// Next item can be from queue or next episode
export interface NextItemInfo {
  id: string;
  name: string;
  type: 'queue' | 'episode';
  // For episodes
  seasonNumber?: number | null;
  episodeNumber?: number | null;
}

interface PlayerContextActions {
  playMedia: (mediaId: string) => Promise<void>;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  seekCommit: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setAudioTrack: (streamIndex: number) => void;
  setSubtitleTrack: (streamIndex: number | null) => void;
  setQuality: (quality: string) => void;
  setMode: (mode: 'fullscreen' | 'mini' | 'hidden') => void;
  registerFullscreenContainer: (element: HTMLElement | null) => void;
  registerMouseMoveHandler: (handler: (() => void) | null) => void;
  registerMouseDownHandler: (handler: ((e: React.MouseEvent) => void) | null) => void;
  registerClickHandler: (handler: (() => void) | null) => void;
  close: () => void;
  setMiniPlayerPosition: (position: MiniPlayerPosition) => void;
  // Queue actions
  refreshQueue: () => Promise<void>;
  playNext: () => Promise<void>;
  playPrevious: () => Promise<void>;
  hasNextItem: () => boolean;
  hasPreviousItem: () => boolean;
}

type PlayerContextValue = PlayerContextState & PlayerContextActions;

const PlayerContext = createContext<PlayerContextValue | null>(null);

const POSITION_STORAGE_KEY = 'tubeca_miniplayer_position';

function loadPosition(): MiniPlayerPosition {
  try {
    const stored = localStorage.getItem(POSITION_STORAGE_KEY);
    if (stored && ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(stored)) {
      return stored as MiniPlayerPosition;
    }
  } catch {
    // Ignore localStorage errors
  }
  return 'bottom-right';
}

function savePosition(position: MiniPlayerPosition) {
  try {
    localStorage.setItem(POSITION_STORAGE_KEY, position);
  } catch {
    // Ignore localStorage errors
  }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  // State
  const [currentMedia, setCurrentMedia] = useState<CurrentMedia | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentAudioTrack, setCurrentAudioTrack] = useState<number | undefined>(undefined);
  const [currentSubtitleTrack, setCurrentSubtitleTrack] = useState<number | null>(null);
  const [currentQuality, setCurrentQuality] = useState<string>('auto');
  const [availableQualities, setAvailableQualities] = useState<QualityOption[]>([]);
  const [mode, setModeState] = useState<'fullscreen' | 'mini' | 'hidden'>('hidden');
  const [miniPlayerPosition, setMiniPlayerPositionState] = useState<MiniPlayerPosition>(loadPosition);
  const [fullscreenContainer, setFullscreenContainer] = useState<HTMLElement | null>(null);

  // Queue state
  const [queue, setQueue] = useState<UserCollectionItem[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [nextItem, setNextItem] = useState<NextItemInfo | null>(null);
  const [previousItem, setPreviousItem] = useState<NextItemInfo | null>(null);
  const prevCurrentMediaIdRef = useRef<string | null>(null);

  // Reset queue state when currentMedia becomes null (ref pattern to avoid setState in effect)
  const currentMediaId = currentMedia?.id ?? null;
  if (currentMediaId !== prevCurrentMediaIdRef.current) {
    prevCurrentMediaIdRef.current = currentMediaId;
    if (currentMedia === null) {
      setQueueIndex(-1);
      setNextItem(null);
      setPreviousItem(null);
    }
  }

  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const seekOffset = useRef(0);
  const videoHandlersRef = useRef<{
    timeupdate: () => void;
    play: () => void;
    pause: () => void;
    waiting: () => void;
    canplay: () => void;
    playing: () => void;
    ended: () => void;
  } | null>(null);

  // Destroy existing HLS instance
  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  // Initialize HLS playback
  const initHls = useCallback((mediaId: string, audioTrack?: number) => {
    const video = videoRef.current;
    if (!video) return;

    destroyHls();

    const hlsUrl = apiClient.getHlsMasterPlaylistUrl(mediaId, audioTrack);

    if (Hls.isSupported()) {
      // Get auth token for HLS requests
      const token = localStorage.getItem('token');

      const hls = new Hls({
        startPosition: 0,
        debug: false,
        // Start at auto (-1) to let ABR choose based on bandwidth estimate
        startLevel: -1,
        // Higher initial bandwidth estimate (5 Mbps) for faster quality ramp-up
        abrEwmaDefaultEstimate: 5000000,
        // ABR tuning for faster switching
        abrEwmaFastLive: 3.0,        // Fast EWMA half-life for live (seconds)
        abrEwmaSlowLive: 9.0,        // Slow EWMA half-life for live
        abrEwmaFastVoD: 3.0,         // Fast EWMA half-life for VOD
        abrEwmaSlowVoD: 9.0,         // Slow EWMA half-life for VOD
        abrBandWidthFactor: 0.95,    // Use 95% of estimated bandwidth
        abrBandWidthUpFactor: 0.7,   // Be more aggressive switching up (70%)
        // Buffer settings for smoother playback
        maxBufferLength: 60,         // Max buffer ahead (seconds)
        maxMaxBufferLength: 120,     // Absolute max buffer
        maxBufferSize: 60 * 1000 * 1000, // 60MB max buffer size
        maxBufferHole: 0.5,          // Tolerate 0.5s gaps in buffer
        // Faster loading
        fragLoadingTimeOut: 20000,   // Fragment load timeout (20s)
        fragLoadingMaxRetry: 6,      // Retry up to 6 times
        fragLoadingRetryDelay: 500,  // Start with 500ms retry delay
        fragLoadingMaxRetryTimeout: 30000, // Max 30s total retry time
        // Level loading (playlists)
        levelLoadingTimeOut: 10000,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 500,
        // Back buffer to allow smooth rewind
        backBufferLength: 30,
        // Low latency mode for on-demand transcoding
        lowLatencyMode: false,
        // Add Authorization header to all HLS requests
        xhrSetup: (xhr) => {
          if (token) {
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          }
        },
      });

      hls.loadSource(hlsUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        // Extract available qualities from manifest
        const qualities: QualityOption[] = data.levels.map((level) => ({
          name: level.name || `${level.height}p`,
          label: level.name || `${level.height}p (${Math.round(level.bitrate / 1000)} kbps)`,
          bandwidth: level.bitrate,
        }));

        // Add auto option at the beginning
        qualities.unshift({
          name: 'auto',
          label: 'Auto',
          bandwidth: 0,
        });

        setAvailableQualities(qualities);
        setCurrentQuality('auto');

        video.play().catch(() => {
          // Autoplay might be blocked
        });
      });

      // Log when ABR switches quality levels
      hls.on(Hls.Events.LEVEL_SWITCHING, (_event, data) => {
        const level = hls.levels[data.level];
        console.log(`[HLS] Switching to level ${data.level}: ${level?.height}p (${Math.round((level?.bitrate || 0) / 1000)} kbps)`);
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        const level = hls.levels[data.level];
        console.log(`[HLS] Switched to level ${data.level}: ${level?.height}p`);
      });

      // Log buffer and bandwidth stats periodically
      hls.on(Hls.Events.FRAG_BUFFERED, (_event, data) => {
        const stats = data.stats;
        const bwEstimate = hls.bandwidthEstimate;
        const level = hls.levels[data.frag.level];
        console.log(
          `[HLS] Fragment ${data.frag.sn} buffered (${level?.height}p) - ` +
          `BW estimate: ${Math.round(bwEstimate / 1000)} kbps, ` +
          `Load: ${Math.round(stats.loading.end - stats.loading.start)}ms, ` +
          `Parse: ${Math.round(stats.parsing.end - stats.parsing.start)}ms`
        );
      });

      // Log when fragment loading starts
      hls.on(Hls.Events.FRAG_LOADING, (_event, data) => {
        const level = hls.levels[data.frag.level];
        console.log(`[HLS] Loading fragment ${data.frag.sn} (${level?.height}p)`);
      });

      // Log when buffer is flushing (e.g., on seek)
      hls.on(Hls.Events.BUFFER_FLUSHING, () => {
        console.log('[HLS] Buffer flushing');
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        // Log buffer stalls and other non-fatal errors that affect playback
        if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
          console.warn('[HLS] Buffer stalled - playback may pause');
        } else if (data.details === Hls.ErrorDetails.BUFFER_NUDGE_ON_STALL) {
          console.warn('[HLS] Buffer nudge on stall - attempting recovery');
        }

        if (data.fatal) {
          console.error('HLS fatal error:', data.type, data.details);
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              // Try to recover network error
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              // Try to recover media error
              hls.recoverMediaError();
              break;
            default:
              destroyHls();
              break;
          }
        }
      });

      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari)
      video.src = hlsUrl;
      video.addEventListener('loadedmetadata', () => {
        video.play().catch(() => {
          // Autoplay might be blocked
        });
      });
    }
  }, [destroyHls]);

  // Get stream URL (legacy fallback for non-video media)
  const getStreamUrl = useCallback((startTime?: number, audioTrack?: number) => {
    if (!currentMedia) return '';
    return apiClient.getVideoStreamUrl(currentMedia.id, startTime, audioTrack);
  }, [currentMedia]);

  // Video event handlers - use callback ref to ensure listeners are attached
  const videoCallbackRef = useCallback((video: HTMLVideoElement | null) => {
    // Clean up old video element if there was one
    if (videoRef.current && videoHandlersRef.current) {
      const oldVideo = videoRef.current;
      const handlers = videoHandlersRef.current;
      oldVideo.removeEventListener('timeupdate', handlers.timeupdate);
      oldVideo.removeEventListener('play', handlers.play);
      oldVideo.removeEventListener('pause', handlers.pause);
      oldVideo.removeEventListener('waiting', handlers.waiting);
      oldVideo.removeEventListener('canplay', handlers.canplay);
      oldVideo.removeEventListener('playing', handlers.playing);
      oldVideo.removeEventListener('ended', handlers.ended);
      videoHandlersRef.current = null;
    }

    videoRef.current = video;

    if (!video) return;

    // Create and store handlers
    const handlers = {
      timeupdate: () => setCurrentTime(video.currentTime + seekOffset.current),
      play: () => setIsPlaying(true),
      pause: () => setIsPlaying(false),
      waiting: () => setIsLoading(true),
      canplay: () => setIsLoading(false),
      playing: () => setIsLoading(false),
      ended: () => setIsPlaying(false),
    };
    videoHandlersRef.current = handlers;

    // Attach event listeners to new video element
    video.addEventListener('timeupdate', handlers.timeupdate);
    video.addEventListener('play', handlers.play);
    video.addEventListener('pause', handlers.pause);
    video.addEventListener('waiting', handlers.waiting);
    video.addEventListener('canplay', handlers.canplay);
    video.addEventListener('playing', handlers.playing);
    video.addEventListener('ended', handlers.ended);
  }, []);

  // Sync subtitle track mode
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.textTracks || !currentMedia) return;

    for (let i = 0; i < video.textTracks.length; i++) {
      const track = video.textTracks[i];
      const subtitleTrack = currentMedia.subtitleTracks[i];
      if (subtitleTrack) {
        track.mode = subtitleTrack.streamIndex === currentSubtitleTrack ? 'showing' : 'hidden';
      }
    }
  }, [currentSubtitleTrack, currentMedia]);

  // Actions
  const playMedia = useCallback(async (mediaId: string) => {
    setIsLoading(true);
    setCurrentTime(0);
    seekOffset.current = 0;

    try {
      // Fetch media data
      const [mediaResult, trickplayResult] = await Promise.all([
        apiClient.getMedia(mediaId),
        apiClient.getTrickplayInfo(mediaId),
      ]);

      if (mediaResult.error || !mediaResult.data) {
        console.error('Failed to load media:', mediaResult.error);
        setIsLoading(false);
        return;
      }

      const media = mediaResult.data.media;

      // Extract audio tracks
      const audioTracks: AudioTrackInfo[] = media.streams
        ?.filter((s) => s.streamType === 'Audio')
        .map((s) => ({
          streamIndex: s.streamIndex,
          language: s.language,
          title: s.title,
          channels: s.channels,
          channelLayout: s.channelLayout,
          isDefault: s.isDefault,
        })) || [];

      // Extract subtitle tracks
      const subtitleTracks: SubtitleTrackInfo[] = media.streams
        ?.filter((s) => s.streamType === 'Subtitle')
        .map((s) => ({
          streamIndex: s.streamIndex,
          language: s.language,
          title: s.title,
          isDefault: s.isDefault,
          isForced: s.isForced,
          url: apiClient.getSubtitleUrl(mediaId, s.streamIndex),
        })) || [];

      // Get default audio track
      const defaultAudioTrack = audioTracks.find((t) => t.isDefault) || audioTracks[0];

      // Get poster image from collection
      let poster: string | undefined;
      const collection = media.collection as Media['collection'] & {
        parent?: { images?: { id: string; imageType: string }[] };
      };
      const backdropImage =
        collection?.images?.find((img) => img.imageType === 'Backdrop') ||
        collection?.parent?.images?.find((img) => img.imageType === 'Backdrop');
      if (backdropImage) {
        poster = apiClient.getImageUrl(backdropImage.id);
      }

      // Check if this is an episode (has season/episode numbers and belongs to a collection)
      const isEpisode = !!(
        media.videoDetails?.season != null &&
        media.videoDetails?.episode != null &&
        media.collectionId
      );

      const currentMediaData: CurrentMedia = {
        id: media.id,
        name: media.name,
        duration: media.duration,
        type: media.type,
        audioTracks,
        subtitleTracks,
        trickplay: trickplayResult.data?.trickplay?.resolutions?.[0],
        poster,
        // Episode info
        collectionId: media.collectionId || undefined,
        seasonNumber: media.videoDetails?.season,
        episodeNumber: media.videoDetails?.episode,
        isEpisode,
      };

      setCurrentMedia(currentMediaData);
      setDuration(media.duration);
      setCurrentAudioTrack(defaultAudioTrack?.streamIndex);
      setCurrentSubtitleTrack(null);

      // Set video source using HLS.js for video content
      if (media.type === 'Video') {
        initHls(mediaId, defaultAudioTrack?.streamIndex);
      } else {
        // For audio, use direct streaming
        const video = videoRef.current;
        if (video) {
          video.src = apiClient.getVideoStreamUrl(mediaId, 0, defaultAudioTrack?.streamIndex);
          video.load();
          video.play().catch(() => {
            // Autoplay might be blocked
          });
        }
      }

      setModeState(fullscreenContainer ? 'fullscreen' : 'mini');
    } catch (error) {
      console.error('Failed to load media:', error);
      setIsLoading(false);
    }
  }, [fullscreenContainer, initHls]);

  const play = useCallback(() => {
    videoRef.current?.play();
  }, []);

  const pause = useCallback(() => {
    videoRef.current?.pause();
  }, []);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  const seek = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  const seekCommit = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video || !currentMedia) return;

    // With HLS.js, we can use native video seeking - it handles segment fetching
    if (hlsRef.current || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.currentTime = time;
      seekOffset.current = 0; // No offset needed with HLS
      setCurrentTime(time);
    } else {
      // Fallback for non-HLS streams (audio, etc.)
      const wasPlaying = isPlaying;
      setIsLoading(true);
      seekOffset.current = time;
      video.src = getStreamUrl(time, currentAudioTrack);
      video.load();
      setCurrentTime(time);

      const handleCanPlayOnce = () => {
        video.removeEventListener('canplay', handleCanPlayOnce);
        setIsLoading(false);
        if (wasPlaying) {
          video.play();
        }
      };
      video.addEventListener('canplay', handleCanPlayOnce);
    }
  }, [currentMedia, isPlaying, currentAudioTrack, getStreamUrl]);

  const setVolume = useCallback((newVolume: number) => {
    const video = videoRef.current;
    if (video) {
      video.volume = newVolume;
    }
    setVolumeState(newVolume);
    setIsMuted(newVolume === 0);
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isMuted) {
      video.volume = volume || 1;
      video.muted = false;
      setIsMuted(false);
    } else {
      video.muted = true;
      setIsMuted(true);
    }
  }, [isMuted, volume]);

  const setAudioTrack = useCallback((streamIndex: number) => {
    const video = videoRef.current;
    if (!video || !currentMedia) return;

    const wasPlaying = isPlaying;
    const currentPosition = video.currentTime + seekOffset.current;
    setCurrentAudioTrack(streamIndex);
    setIsLoading(true);

    // For HLS streams, reload with new audio track
    if (hlsRef.current || currentMedia.type === 'Video') {
      // Store position and current quality level before destroying HLS
      const seekPosition = currentPosition;
      const currentLevel = hlsRef.current?.currentLevel ?? -1;
      destroyHls();

      const hlsUrl = apiClient.getHlsMasterPlaylistUrl(currentMedia.id, streamIndex);

      if (Hls.isSupported()) {
        // Get auth token for HLS requests
        const token = localStorage.getItem('token');

        const hls = new Hls({
          startPosition: seekPosition,
          debug: false,
          // Use same level as before the switch
          startLevel: currentLevel >= 0 ? currentLevel : -1,
          abrEwmaDefaultEstimate: 5000000,
          abrEwmaFastLive: 3.0,
          abrEwmaSlowLive: 9.0,
          abrEwmaFastVoD: 3.0,
          abrEwmaSlowVoD: 9.0,
          abrBandWidthFactor: 0.95,
          abrBandWidthUpFactor: 0.7,
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          maxBufferSize: 60 * 1000 * 1000,
          maxBufferHole: 0.5,
          fragLoadingTimeOut: 20000,
          fragLoadingMaxRetry: 6,
          fragLoadingRetryDelay: 500,
          fragLoadingMaxRetryTimeout: 30000,
          levelLoadingTimeOut: 10000,
          levelLoadingMaxRetry: 4,
          levelLoadingRetryDelay: 500,
          backBufferLength: 30,
          lowLatencyMode: false,
          // Add Authorization header to all HLS requests
          xhrSetup: (xhr) => {
            if (token) {
              xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            }
          },
        });

        hls.loadSource(hlsUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          // Restore the quality setting
          if (currentQuality === 'auto') {
            hls.currentLevel = -1;
          } else if (currentLevel >= 0) {
            hls.currentLevel = currentLevel;
          }
          setIsLoading(false);
          if (wasPlaying) {
            video.play().catch(() => {});
          }
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            console.error('HLS error on audio track switch:', data.type, data.details);
          }
        });

        hlsRef.current = hls;
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hlsUrl;
        video.currentTime = seekPosition;
        video.addEventListener('canplay', () => {
          setIsLoading(false);
          if (wasPlaying) {
            video.play().catch(() => {});
          }
        }, { once: true });
      }
    } else {
      // Fallback for non-HLS streams
      seekOffset.current = currentPosition;
      video.src = getStreamUrl(currentPosition, streamIndex);
      video.load();

      const handleCanPlayOnce = () => {
        video.removeEventListener('canplay', handleCanPlayOnce);
        setIsLoading(false);
        if (wasPlaying) {
          video.play();
        }
      };
      video.addEventListener('canplay', handleCanPlayOnce);
    }
  }, [currentMedia, isPlaying, currentQuality, getStreamUrl, destroyHls]);

  const setSubtitleTrack = useCallback((streamIndex: number | null) => {
    setCurrentSubtitleTrack(streamIndex);
  }, []);

  const setQuality = useCallback((quality: string) => {
    if (!hlsRef.current) return;

    setCurrentQuality(quality);

    if (quality === 'auto') {
      // Enable automatic quality selection
      hlsRef.current.currentLevel = -1;
    } else {
      // Find the level index matching the quality name
      const levelIndex = hlsRef.current.levels.findIndex(
        (level) => level.name === quality || `${level.height}p` === quality
      );
      if (levelIndex >= 0) {
        hlsRef.current.currentLevel = levelIndex;
      }
    }
  }, []);

  const setMode = useCallback((newMode: 'fullscreen' | 'mini' | 'hidden') => {
    setModeState(newMode);
  }, []);

  const registerFullscreenContainer = useCallback((element: HTMLElement | null) => {
    setFullscreenContainer(element);
    if (element && currentMedia) {
      setModeState('fullscreen');
    } else if (!element && currentMedia) {
      setModeState('mini');
    }
  }, [currentMedia]);

  const close = useCallback(() => {
    // Clean up HLS instance
    destroyHls();

    const video = videoRef.current;
    if (video) {
      video.pause();
      video.src = '';
    }
    setCurrentMedia(null);
    setModeState('hidden');
    setCurrentTime(0);
    setAvailableQualities([]);
    setCurrentQuality('auto');
    seekOffset.current = 0;
  }, [destroyHls]);

  const setMiniPlayerPosition = useCallback((position: MiniPlayerPosition) => {
    setMiniPlayerPositionState(position);
    savePosition(position);
  }, []);

  // Queue functions
  const refreshQueue = useCallback(async () => {
    try {
      const result = await apiClient.getPlaybackQueue();
      if (result.data?.userCollection?.items) {
        setQueue(result.data.userCollection.items);
      }
    } catch (error) {
      console.error('Failed to fetch playback queue:', error);
    }
  }, []);

  // Update queue index and next/previous items when currentMedia or queue changes
  useEffect(() => {
    // Skip if no current media (reset is handled by ref pattern above)
    if (!currentMedia) return;

    let cancelled = false;

    async function updateNextAndPreviousItems() {
      // Find current media in queue
      const index = queue.findIndex((item) => item.media?.id === currentMedia?.id);
      setQueueIndex(index);

      // Check for previous item in queue
      if (index > 0) {
        const prev = queue[index - 1];
        if (prev.media && !cancelled) {
          setPreviousItem({
            id: prev.media.id,
            name: prev.media.name,
            type: 'queue',
            seasonNumber: prev.media.videoDetails?.season,
            episodeNumber: prev.media.videoDetails?.episode,
          });
        }
      } else if (!cancelled) {
        setPreviousItem(null);
      }

      // Check queue for next item
      if (index >= 0 && index < queue.length - 1) {
        const next = queue[index + 1];
        if (next.media && !cancelled) {
          setNextItem({
            id: next.media.id,
            name: next.media.name,
            type: 'queue',
            seasonNumber: next.media.videoDetails?.season,
            episodeNumber: next.media.videoDetails?.episode,
          });
          return;
        }
      }

      // If no queue item, check for next episode
      if (currentMedia?.isEpisode && currentMedia.collectionId) {
        try {
          const seasonResult = await apiClient.getCollection(currentMedia.collectionId);
          if (cancelled) return;

          const seasonCollection = seasonResult.data?.collection;
          const seasonMedia = seasonCollection?.media || [];
          // Sort by episode number
          const sortedEpisodes = [...seasonMedia].sort((a, b) => {
            const aEp = a.videoDetails?.episode ?? 0;
            const bEp = b.videoDetails?.episode ?? 0;
            return aEp - bEp;
          });

          // Find current episode and get next
          const currentEpIndex = sortedEpisodes.findIndex((ep) => ep.id === currentMedia.id);
          if (currentEpIndex >= 0 && currentEpIndex < sortedEpisodes.length - 1) {
            // Next episode in same season
            const nextEp = sortedEpisodes[currentEpIndex + 1];
            if (!cancelled) {
              setNextItem({
                id: nextEp.id,
                name: nextEp.name,
                type: 'episode',
                seasonNumber: nextEp.videoDetails?.season,
                episodeNumber: nextEp.videoDetails?.episode,
              });
              return;
            }
          } else if (currentEpIndex === sortedEpisodes.length - 1 && seasonCollection?.parentId) {
            // Last episode of season - check for next season
            const showResult = await apiClient.getCollection(seasonCollection.parentId);
            if (cancelled) return;

            const showCollection = showResult.data?.collection;
            const seasons = showCollection?.children || [];

            // Sort seasons by season number and find the next one
            const sortedSeasons = [...seasons].sort((a, b) => {
              // SeasonDetails not available on CollectionSummary, need to fetch each season
              // For now, use name sorting as a fallback (Season 1, Season 2, etc.)
              return a.name.localeCompare(b.name, undefined, { numeric: true });
            });

            const currentSeasonIndex = sortedSeasons.findIndex((s) => s.id === currentMedia.collectionId);
            if (currentSeasonIndex >= 0 && currentSeasonIndex < sortedSeasons.length - 1) {
              // Fetch the next season to get its first episode
              const nextSeasonId = sortedSeasons[currentSeasonIndex + 1].id;
              const nextSeasonResult = await apiClient.getCollection(nextSeasonId);
              if (cancelled) return;

              const nextSeasonMedia = nextSeasonResult.data?.collection?.media || [];
              const nextSeasonNumber = nextSeasonResult.data?.collection?.seasonDetails?.seasonNumber;
              // Sort episodes and get the first one
              const sortedNextEpisodes = [...nextSeasonMedia].sort((a, b) => {
                const aEp = a.videoDetails?.episode ?? 0;
                const bEp = b.videoDetails?.episode ?? 0;
                return aEp - bEp;
              });

              if (sortedNextEpisodes.length > 0 && !cancelled) {
                const firstEp = sortedNextEpisodes[0];
                setNextItem({
                  id: firstEp.id,
                  name: firstEp.name,
                  type: 'episode',
                  seasonNumber: nextSeasonNumber ?? firstEp.videoDetails?.season,
                  episodeNumber: firstEp.videoDetails?.episode,
                });
                return;
              }
            }
          }
        } catch (error) {
          console.error('Failed to fetch next episode:', error);
        }
      }

      // No next item available
      if (!cancelled) {
        setNextItem(null);
      }
    }

    updateNextAndPreviousItems();

    return () => {
      cancelled = true;
    };
  }, [currentMedia, queue]);

  const hasNextItem = useCallback(() => {
    return nextItem !== null;
  }, [nextItem]);

  const hasPreviousItem = useCallback(() => {
    return previousItem !== null;
  }, [previousItem]);

  const playNext = useCallback(async () => {
    if (!nextItem) return;
    await playMedia(nextItem.id);
  }, [nextItem, playMedia]);

  const playPrevious = useCallback(async () => {
    if (!previousItem) return;
    await playMedia(previousItem.id);
  }, [previousItem, playMedia]);

  // Auto-play next item when current media ends
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleEnded = () => {
      if (nextItem) {
        playMedia(nextItem.id);
      }
    };

    video.addEventListener('ended', handleEnded);
    return () => {
      video.removeEventListener('ended', handleEnded);
    };
  }, [nextItem, playMedia]);

  // Mouse move handler for video element
  const mouseMoveHandlerRef = useRef<(() => void) | null>(null);

  const registerMouseMoveHandler = useCallback((handler: (() => void) | null) => {
    mouseMoveHandlerRef.current = handler;
  }, []);

  const handleVideoMouseMove = useCallback(() => {
    mouseMoveHandlerRef.current?.();
  }, []);

  // Mouse down handler for video element (needed for drag in mini player)
  const mouseDownHandlerRef = useRef<((e: React.MouseEvent) => void) | null>(null);

  const registerMouseDownHandler = useCallback((handler: ((e: React.MouseEvent) => void) | null) => {
    mouseDownHandlerRef.current = handler;
  }, []);

  const handleVideoMouseDown = useCallback((e: React.MouseEvent) => {
    mouseDownHandlerRef.current?.(e);
  }, []);

  // Click handler for video element (for play/pause toggle)
  const clickHandlerRef = useRef<(() => void) | null>(null);

  const registerClickHandler = useCallback((handler: (() => void) | null) => {
    clickHandlerRef.current = handler;
  }, []);

  const handleVideoClick = useCallback(() => {
    clickHandlerRef.current?.();
  }, []);

  // Video element - always rendered in same location to prevent reload on mode switch
  const videoElement = (
    <video
      ref={videoCallbackRef}
      poster={currentMedia?.poster}
      crossOrigin="anonymous"
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        backgroundColor: '#000',
      }}
    >
      {currentMedia?.subtitleTracks.map((track) => (
        <track
          key={track.streamIndex}
          kind="subtitles"
          src={track.url}
          srcLang={track.language || 'und'}
          label={track.title || track.language || `Track ${track.streamIndex}`}
          default={track.streamIndex === currentSubtitleTrack}
        />
      ))}
    </video>
  );

  const contextValue: PlayerContextValue = {
    currentMedia,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    isLoading,
    currentAudioTrack,
    currentSubtitleTrack,
    currentQuality,
    availableQualities,
    mode,
    miniPlayerPosition,
    playMedia,
    play,
    pause,
    togglePlay,
    seek,
    seekCommit,
    setVolume,
    toggleMute,
    setAudioTrack,
    setSubtitleTrack,
    setQuality,
    setMode,
    registerFullscreenContainer,
    registerMouseMoveHandler,
    registerMouseDownHandler,
    registerClickHandler,
    close,
    setMiniPlayerPosition,
    // Queue
    queue,
    queueIndex,
    nextItem,
    previousItem,
    refreshQueue,
    playNext,
    playPrevious,
    hasNextItem,
    hasPreviousItem,
  };

  // Refs for DOM-based video container movement
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const miniPlayerContainerRef = useRef<HTMLDivElement>(null);
  const hiddenContainerRef = useRef<HTMLDivElement>(null);

  // Determine display mode
  const isFullscreen = fullscreenContainer !== null && currentMedia !== null;
  const isMini = !isFullscreen && mode === 'mini' && currentMedia !== null;

  // Move video container to appropriate parent using DOM manipulation
  // This prevents React from unmounting/remounting the video element
  useLayoutEffect(() => {
    const videoContainer = videoContainerRef.current;
    if (!videoContainer) return;

    let targetParent: HTMLElement | null = null;

    if (isFullscreen && fullscreenContainer) {
      targetParent = fullscreenContainer;
    } else if (isMini && miniPlayerContainerRef.current) {
      targetParent = miniPlayerContainerRef.current;
    } else if (hiddenContainerRef.current) {
      targetParent = hiddenContainerRef.current;
    }

    if (targetParent && videoContainer.parentElement !== targetParent) {
      targetParent.appendChild(videoContainer);
    }
  }, [isFullscreen, isMini, fullscreenContainer]);

  return (
    <PlayerContext.Provider value={contextValue}>
      {children}
      {/* Video container - always exists, moved via DOM manipulation */}
      <div
        ref={videoContainerRef}
        onClick={handleVideoClick}
        onMouseDown={handleVideoMouseDown}
        onMouseMove={handleVideoMouseMove}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 1,
        }}
      >
        {videoElement}
      </div>
      {/* Mini player wrapper - provides the frame, video is moved into it */}
      {isMini && (
        <MiniPlayer
          position={miniPlayerPosition}
          onPositionChange={setMiniPlayerPosition}
          containerRef={miniPlayerContainerRef}
        />
      )}
      {/* Hidden container for when video should be offscreen */}
      <div
        ref={hiddenContainerRef}
        style={{
          position: 'fixed',
          top: -9999,
          left: -9999,
          width: 1,
          height: 1,
          overflow: 'hidden',
        }}
      />
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error('usePlayer must be used within a PlayerProvider');
  }
  return context;
}
