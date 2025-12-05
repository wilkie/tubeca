import { createContext, useContext, useState, useRef, useCallback, useEffect, useLayoutEffect, type ReactNode } from 'react';
import { apiClient, type Media, type TrickplayResolution } from '../api/client';
import type { AudioTrackInfo, SubtitleTrackInfo } from '../components/VideoControls';
import { MiniPlayer } from '../components/MiniPlayer';

// Types
export type MiniPlayerPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface CurrentMedia {
  id: string;
  name: string;
  duration: number;
  type: 'Video' | 'Audio';
  audioTracks: AudioTrackInfo[];
  subtitleTracks: SubtitleTrackInfo[];
  trickplay?: TrickplayResolution;
  poster?: string;
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
  mode: 'fullscreen' | 'mini' | 'hidden';
  miniPlayerPosition: MiniPlayerPosition;
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
  setMode: (mode: 'fullscreen' | 'mini' | 'hidden') => void;
  registerFullscreenContainer: (element: HTMLElement | null) => void;
  registerMouseMoveHandler: (handler: (() => void) | null) => void;
  registerMouseDownHandler: (handler: ((e: React.MouseEvent) => void) | null) => void;
  close: () => void;
  setMiniPlayerPosition: (position: MiniPlayerPosition) => void;
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
  const [mode, setModeState] = useState<'fullscreen' | 'mini' | 'hidden'>('hidden');
  const [miniPlayerPosition, setMiniPlayerPositionState] = useState<MiniPlayerPosition>(loadPosition);
  const [fullscreenContainer, setFullscreenContainer] = useState<HTMLElement | null>(null);

  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
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

  // Get stream URL
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

      const currentMediaData: CurrentMedia = {
        id: media.id,
        name: media.name,
        duration: media.duration,
        type: media.type,
        audioTracks,
        subtitleTracks,
        trickplay: trickplayResult.data?.trickplay?.resolutions?.[0],
        poster,
      };

      setCurrentMedia(currentMediaData);
      setDuration(media.duration);
      setCurrentAudioTrack(defaultAudioTrack?.streamIndex);
      setCurrentSubtitleTrack(null);

      // Set video source and play
      const video = videoRef.current;
      if (video) {
        video.src = apiClient.getVideoStreamUrl(mediaId, 0, defaultAudioTrack?.streamIndex);
        video.load();
        video.play().catch(() => {
          // Autoplay might be blocked
        });
      }

      setModeState(fullscreenContainer ? 'fullscreen' : 'mini');
    } catch (error) {
      console.error('Failed to load media:', error);
      setIsLoading(false);
    }
  }, [fullscreenContainer]);

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

    setCurrentAudioTrack(streamIndex);

    const wasPlaying = isPlaying;
    const currentPosition = video.currentTime + seekOffset.current;
    setIsLoading(true);
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
  }, [currentMedia, isPlaying, getStreamUrl]);

  const setSubtitleTrack = useCallback((streamIndex: number | null) => {
    setCurrentSubtitleTrack(streamIndex);
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
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.src = '';
    }
    setCurrentMedia(null);
    setModeState('hidden');
    setCurrentTime(0);
    seekOffset.current = 0;
  }, []);

  const setMiniPlayerPosition = useCallback((position: MiniPlayerPosition) => {
    setMiniPlayerPositionState(position);
    savePosition(position);
  }, []);

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
    setMode,
    registerFullscreenContainer,
    registerMouseMoveHandler,
    registerMouseDownHandler,
    close,
    setMiniPlayerPosition,
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
