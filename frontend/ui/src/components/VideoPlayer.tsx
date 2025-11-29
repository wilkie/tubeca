import { useRef, useState, useEffect } from 'react';
import { Box, IconButton, Slider, Typography, CircularProgress } from '@mui/material';
import {
  PlayArrow,
  Pause,
  VolumeUp,
  VolumeOff,
  Fullscreen,
  FullscreenExit,
} from '@mui/icons-material';

interface VideoPlayerProps {
  src: string;
  title?: string;
  mediaDuration?: number; // Duration in seconds from media metadata
  onSeek?: (startTime: number) => string; // Callback to get new URL for seeking (for transcoded streams)
}

function formatTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function VideoPlayer({ src, title, mediaDuration, onSeek }: VideoPlayerProps) {
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
  const seekOffset = useRef(0); // Track offset when using server-side seeking

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => setCurrentTime(video.currentTime + seekOffset.current);
    const handleDurationChange = () => {
      // Only use video element duration if we don't have mediaDuration from the database
      // Transcoded streams often report incorrect duration
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

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
  };

  const handleSeekChange = (_: Event, value: number | number[]) => {
    // Update the displayed time while dragging
    const newTime = Array.isArray(value) ? value[0] : value;
    setCurrentTime(newTime);
  };

  const handleSeekCommit = (_: Event | React.SyntheticEvent, value: number | number[]) => {
    const video = videoRef.current;
    if (!video) return;

    const newTime = Array.isArray(value) ? value[0] : value;

    // If onSeek callback is provided, use server-side seeking (for transcoded streams)
    if (onSeek) {
      const wasPlaying = isPlaying;
      setIsLoading(true);
      seekOffset.current = newTime;
      const newUrl = onSeek(newTime);
      setVideoSrc(newUrl);
      setCurrentTime(newTime);

      // Wait for video to load then play if it was playing before
      const handleCanPlayOnce = () => {
        video.removeEventListener('canplay', handleCanPlayOnce);
        if (wasPlaying) {
          video.play();
        }
      };
      video.addEventListener('canplay', handleCanPlayOnce);
    } else {
      // For native formats, use standard seeking
      video.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleVolumeChange = (_: Event, value: number | number[]) => {
    const video = videoRef.current;
    if (!video) return;

    const newVolume = Array.isArray(value) ? value[0] : value;
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
        onClick={handleVideoClick}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
        }}
      />

      {/* Loading spinner */}
      {isLoading && (
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          <CircularProgress sx={{ color: 'white' }} />
        </Box>
      )}

      {/* Controls overlay */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
          padding: 2,
          opacity: showControls ? 1 : 0,
          transition: 'opacity 0.3s',
        }}
      >
        {/* Title */}
        {title && (
          <Typography variant="subtitle1" sx={{ color: 'white', mb: 1 }}>
            {title}
          </Typography>
        )}

        {/* Progress bar */}
        <Slider
          value={currentTime}
          max={duration || 100}
          onChange={handleSeekChange}
          onChangeCommitted={handleSeekCommit}
          sx={{
            color: 'primary.main',
            '& .MuiSlider-thumb': {
              width: 12,
              height: 12,
            },
          }}
        />

        {/* Controls row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <IconButton onClick={handlePlayPause} sx={{ color: 'white' }}>
            {isPlaying ? <Pause /> : <PlayArrow />}
          </IconButton>

          <Typography variant="body2" sx={{ color: 'white', minWidth: 100 }}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </Typography>

          <Box sx={{ flexGrow: 1 }} />

          <IconButton onClick={handleMuteToggle} sx={{ color: 'white' }}>
            {isMuted ? <VolumeOff /> : <VolumeUp />}
          </IconButton>

          <Slider
            value={isMuted ? 0 : volume}
            max={1}
            step={0.1}
            onChange={handleVolumeChange}
            sx={{
              width: 80,
              color: 'white',
              '& .MuiSlider-thumb': {
                width: 12,
                height: 12,
              },
            }}
          />

          <IconButton onClick={handleFullscreenToggle} sx={{ color: 'white' }}>
            {isFullscreen ? <FullscreenExit /> : <Fullscreen />}
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
}
