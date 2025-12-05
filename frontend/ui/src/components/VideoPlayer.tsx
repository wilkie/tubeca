import { useRef, useState, useEffect } from 'react';
import { Box } from '@mui/material';
import { VideoControls, formatSubtitleTrackLabel } from './VideoControls';
import type { AudioTrackInfo, SubtitleTrackInfo } from './VideoControls';
import type { TrickplayResolution } from '../api/client';

// Re-export types for backward compatibility
export type { AudioTrackInfo, SubtitleTrackInfo } from './VideoControls';

interface VideoPlayerProps {
  src: string;
  title?: string;
  poster?: string;
  autoPlay?: boolean;
  mediaDuration?: number;
  audioTracks?: AudioTrackInfo[];
  currentAudioTrack?: number;
  onAudioTrackChange?: (streamIndex: number) => void;
  onSeek?: (startTime: number, audioTrack?: number) => string;
  subtitleTracks?: SubtitleTrackInfo[];
  currentSubtitleTrack?: number | null;
  onSubtitleTrackChange?: (streamIndex: number | null) => void;
  trickplay?: TrickplayResolution;
  mediaId?: string;
}

export function VideoPlayer({
  src,
  title,
  poster,
  autoPlay = false,
  mediaDuration,
  audioTracks,
  currentAudioTrack,
  onAudioTrackChange,
  onSeek,
  subtitleTracks,
  currentSubtitleTrack,
  onSubtitleTrackChange,
  trickplay,
  mediaId,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(mediaDuration || 0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const hideControlsTimeout = useRef<number | null>(null);
  const [videoSrc, setVideoSrc] = useState(src);
  const seekOffset = useRef(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => setCurrentTime(video.currentTime + seekOffset.current);
    const handleDurationChange = () => {
      if (!mediaDuration && video.duration && isFinite(video.duration)) {
        setDuration(video.duration);
      }
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleWaiting = () => setIsLoading(true);
    const handleCanPlay = () => setIsLoading(false);
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('durationchange', handleDurationChange);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('canplay', handleCanPlay);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('durationchange', handleDurationChange);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('canplay', handleCanPlay);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [mediaDuration]);

  // Handle subtitle track changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.textTracks) return;

    for (let i = 0; i < video.textTracks.length; i++) {
      const track = video.textTracks[i];
      const subtitleTrack = subtitleTracks?.[i];
      if (subtitleTrack) {
        track.mode = subtitleTrack.streamIndex === currentSubtitleTrack ? 'showing' : 'hidden';
      }
    }
  }, [currentSubtitleTrack, subtitleTracks]);

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
  };

  const handleSeek = (newTime: number) => {
    setCurrentTime(newTime);
  };

  const handleSeekCommit = (newTime: number) => {
    const video = videoRef.current;
    if (!video) return;

    if (onSeek) {
      const wasPlaying = isPlaying;
      setIsLoading(true);
      seekOffset.current = newTime;
      const newUrl = onSeek(newTime);
      setVideoSrc(newUrl);
      setCurrentTime(newTime);

      const handleCanPlayOnce = () => {
        video.removeEventListener('canplay', handleCanPlayOnce);
        if (wasPlaying) {
          video.play();
        }
      };
      video.addEventListener('canplay', handleCanPlayOnce);
    } else {
      video.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleVolumeChange = (newVolume: number) => {
    const video = videoRef.current;
    if (!video) return;

    video.volume = newVolume;
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
  };

  const handleMuteToggle = () => {
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
  };

  const handleFullscreenToggle = () => {
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  const handleAudioTrackSelect = (streamIndex: number) => {
    onAudioTrackChange?.(streamIndex);

    const video = videoRef.current;
    if (video && onSeek) {
      const wasPlaying = isPlaying;
      const currentPosition = video.currentTime + seekOffset.current;
      setIsLoading(true);
      seekOffset.current = currentPosition;

      const newUrl = onSeek(currentPosition, streamIndex);
      setVideoSrc(newUrl);

      const handleCanPlayOnce = () => {
        video.removeEventListener('canplay', handleCanPlayOnce);
        if (wasPlaying) {
          video.play();
        }
      };
      video.addEventListener('canplay', handleCanPlayOnce);
    }
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (hideControlsTimeout.current) {
      clearTimeout(hideControlsTimeout.current);
    }
    hideControlsTimeout.current = window.setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3000);
  };

  const handleVideoClick = () => {
    handlePlayPause();
  };

  return (
    <Box
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#000',
        cursor: showControls ? 'default' : 'none',
      }}
    >
      <video
        ref={videoRef}
        src={videoSrc}
        poster={poster}
        autoPlay={autoPlay}
        onClick={handleVideoClick}
        crossOrigin="anonymous"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
        }}
      >
        {subtitleTracks?.map((track) => (
          <track
            key={track.streamIndex}
            kind="subtitles"
            src={track.url}
            srcLang={track.language || 'und'}
            label={formatSubtitleTrackLabel(track)}
            default={track.streamIndex === currentSubtitleTrack}
          />
        ))}
      </video>

      <VideoControls
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        isMuted={isMuted}
        isLoading={isLoading}
        isFullscreen={isFullscreen}
        audioTracks={audioTracks}
        currentAudioTrack={currentAudioTrack}
        subtitleTracks={subtitleTracks}
        currentSubtitleTrack={currentSubtitleTrack}
        trickplay={trickplay}
        mediaId={mediaId}
        title={title}
        showControls={showControls}
        showFullscreenButton={true}
        onPlayPause={handlePlayPause}
        onSeek={handleSeek}
        onSeekCommit={handleSeekCommit}
        onVolumeChange={handleVolumeChange}
        onMuteToggle={handleMuteToggle}
        onAudioTrackChange={handleAudioTrackSelect}
        onSubtitleTrackChange={onSubtitleTrackChange}
        onFullscreenToggle={handleFullscreenToggle}
        containerRef={containerRef}
      />
    </Box>
  );
}
