import { useRef, useState, useEffect, useCallback } from 'react';
import {
  Box,
  IconButton,
  Slider,
  Typography,
  CircularProgress,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  PlayArrow,
  Pause,
  VolumeUp,
  VolumeOff,
  Fullscreen,
  FullscreenExit,
  Audiotrack,
  Subtitles,
  Check,
} from '@mui/icons-material';
import { apiClient, type TrickplayResolution } from '../api/client';

export interface AudioTrackInfo {
  streamIndex: number;
  language: string | null;
  title: string | null;
  channels: number | null;
  channelLayout: string | null;
  isDefault: boolean;
}

export interface SubtitleTrackInfo {
  streamIndex: number;
  language: string | null;
  title: string | null;
  isDefault: boolean;
  isForced: boolean;
  url: string; // URL to fetch WebVTT subtitle
}

interface VideoPlayerProps {
  src: string;
  title?: string;
  poster?: string; // URL for poster/backdrop image
  autoPlay?: boolean;
  mediaDuration?: number; // Duration in seconds from media metadata
  audioTracks?: AudioTrackInfo[]; // Available audio tracks
  currentAudioTrack?: number; // Current audio track stream index
  onAudioTrackChange?: (streamIndex: number) => void; // Callback when audio track changes
  onSeek?: (startTime: number, audioTrack?: number) => string; // Callback to get new URL for seeking (for transcoded streams)
  subtitleTracks?: SubtitleTrackInfo[]; // Available subtitle tracks
  currentSubtitleTrack?: number | null; // Current subtitle track stream index (null = off)
  onSubtitleTrackChange?: (streamIndex: number | null) => void; // Callback when subtitle track changes
  trickplay?: TrickplayResolution; // Trickplay thumbnail data for preview on hover
  mediaId?: string; // Media ID for fetching trickplay sprites
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

// Language code to display name mapping
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  eng: 'English',
  es: 'Spanish',
  spa: 'Spanish',
  fr: 'French',
  fra: 'French',
  fre: 'French',
  de: 'German',
  deu: 'German',
  ger: 'German',
  it: 'Italian',
  ita: 'Italian',
  pt: 'Portuguese',
  por: 'Portuguese',
  ja: 'Japanese',
  jpn: 'Japanese',
  ko: 'Korean',
  kor: 'Korean',
  zh: 'Chinese',
  zho: 'Chinese',
  chi: 'Chinese',
  ru: 'Russian',
  rus: 'Russian',
  ar: 'Arabic',
  ara: 'Arabic',
  hi: 'Hindi',
  hin: 'Hindi',
  und: 'Unknown',
};

function formatAudioTrackLabel(track: AudioTrackInfo): string {
  const parts: string[] = [];

  // Add language
  if (track.language) {
    const langName = LANGUAGE_NAMES[track.language.toLowerCase()] || track.language.toUpperCase();
    parts.push(langName);
  }

  // Add title if different from language
  if (track.title && (!track.language || !track.title.toLowerCase().includes(track.language.toLowerCase()))) {
    parts.push(track.title);
  }

  // Add channel layout
  if (track.channelLayout) {
    parts.push(track.channelLayout);
  } else if (track.channels) {
    parts.push(`${track.channels}ch`);
  }

  return parts.length > 0 ? parts.join(' - ') : `Track ${track.streamIndex}`;
}

function formatSubtitleTrackLabel(track: SubtitleTrackInfo): string {
  const parts: string[] = [];

  // Add language
  if (track.language) {
    const langName = LANGUAGE_NAMES[track.language.toLowerCase()] || track.language.toUpperCase();
    parts.push(langName);
  }

  // Add title if different from language
  if (track.title && (!track.language || !track.title.toLowerCase().includes(track.language.toLowerCase()))) {
    parts.push(track.title);
  }

  // Add forced indicator
  if (track.isForced) {
    parts.push('(Forced)');
  }

  return parts.length > 0 ? parts.join(' - ') : `Track ${track.streamIndex}`;
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
  const sliderRef = useRef<HTMLDivElement>(null);
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

  // Audio track menu state
  const [audioMenuAnchor, setAudioMenuAnchor] = useState<null | HTMLElement>(null);
  const audioMenuOpen = Boolean(audioMenuAnchor);

  // Trickplay preview state
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewX, setPreviewX] = useState(0);

  // Subtitle track menu state
  const [subtitleMenuAnchor, setSubtitleMenuAnchor] = useState<null | HTMLElement>(null);
  const subtitleMenuOpen = Boolean(subtitleMenuAnchor);

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

  // Handle subtitle track changes - enable/disable text tracks
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.textTracks) return;

    for (let i = 0; i < video.textTracks.length; i++) {
      const track = video.textTracks[i];
      // Find the matching subtitle track by comparing with our subtitleTracks array
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

  // Trickplay preview handlers
  const handleSliderMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!trickplay || !mediaId || !sliderRef.current) return;

      const rect = sliderRef.current.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const percent = Math.max(0, Math.min(1, x / rect.width));
      const time = percent * duration;

      // Clamp position so preview stays within slider bounds
      const previewWidth = trickplay.tileWidth;
      const halfWidth = previewWidth / 2;
      const clampedX = Math.max(halfWidth, Math.min(rect.width - halfWidth, x));

      setPreviewTime(time);
      setPreviewX(clampedX);
      setPreviewVisible(true);
    },
    [trickplay, mediaId, duration]
  );

  const handleSliderMouseLeave = useCallback(() => {
    setPreviewVisible(false);
  }, []);

  // Calculate trickplay sprite and tile position
  const getTrickplayStyle = useCallback(() => {
    if (!trickplay || !mediaId) return null;

    const { interval, columns, tileWidth, tileHeight, tileCount, width } = trickplay;
    const frameIndex = Math.floor(previewTime / interval);
    const spriteIndex = Math.floor(frameIndex / tileCount);
    const tileIndex = frameIndex % tileCount;
    const col = tileIndex % columns;
    const row = Math.floor(tileIndex / columns);

    return {
      backgroundImage: `url(${apiClient.getTrickplaySpriteUrl(mediaId, width, spriteIndex)})`,
      backgroundPosition: `-${col * tileWidth}px -${row * tileHeight}px`,
      width: tileWidth,
      height: tileHeight,
    };
  }, [trickplay, mediaId, previewTime]);

  const handleAudioMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setAudioMenuAnchor(event.currentTarget);
  };

  const handleAudioMenuClose = () => {
    setAudioMenuAnchor(null);
  };

  const handleAudioTrackSelect = (streamIndex: number) => {
    handleAudioMenuClose();

    // Notify parent of the track change
    if (onAudioTrackChange) {
      onAudioTrackChange(streamIndex);
    }

    // Reload video at current position with new audio track
    const video = videoRef.current;
    if (video && onSeek) {
      const wasPlaying = isPlaying;
      const currentPosition = video.currentTime + seekOffset.current;
      setIsLoading(true);
      seekOffset.current = currentPosition;

      // Get URL with new audio track explicitly
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

  const hasMultipleAudioTracks = audioTracks && audioTracks.length > 1;
  const hasSubtitleTracks = subtitleTracks && subtitleTracks.length > 0;

  const handleSubtitleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setSubtitleMenuAnchor(event.currentTarget);
  };

  const handleSubtitleMenuClose = () => {
    setSubtitleMenuAnchor(null);
  };

  const handleSubtitleTrackSelect = (streamIndex: number | null) => {
    handleSubtitleMenuClose();
    if (onSubtitleTrackChange) {
      onSubtitleTrackChange(streamIndex);
    }
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
        {/* Subtitle tracks */}
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

        {/* Progress bar with trickplay preview */}
        <Box
          ref={sliderRef}
          onMouseMove={handleSliderMouseMove}
          onMouseLeave={handleSliderMouseLeave}
          sx={{ position: 'relative' }}
        >
          {/* Trickplay preview tooltip */}
          {trickplay && mediaId && previewVisible && (
            <Box
              data-testid="trickplay-preview"
              data-preview-x={previewX}
              sx={{
                position: 'absolute',
                bottom: 20,
                left: previewX,
                transform: 'translateX(-50%)',
                zIndex: 10,
                pointerEvents: 'none',
              }}
            >
              <Box
                sx={{
                  ...getTrickplayStyle(),
                  borderRadius: 1,
                  boxShadow: 3,
                  overflow: 'hidden',
                }}
              />
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  textAlign: 'center',
                  color: 'white',
                  bgcolor: 'rgba(0,0,0,0.7)',
                  px: 1,
                  py: 0.25,
                  borderRadius: 0.5,
                  mt: 0.5,
                }}
              >
                {formatTime(previewTime)}
              </Typography>
            </Box>
          )}
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
        </Box>

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

          {/* Subtitle track selector */}
          {hasSubtitleTracks && (
            <IconButton
              onClick={handleSubtitleMenuOpen}
              sx={{ color: currentSubtitleTrack !== null ? 'primary.main' : 'white' }}
              aria-label="Select subtitle track"
            >
              <Subtitles />
            </IconButton>
          )}

          {/* Audio track selector */}
          {hasMultipleAudioTracks && (
            <IconButton
              onClick={handleAudioMenuOpen}
              sx={{ color: 'white' }}
              aria-label="Select audio track"
            >
              <Audiotrack />
            </IconButton>
          )}

          <IconButton onClick={handleFullscreenToggle} sx={{ color: 'white' }}>
            {isFullscreen ? <FullscreenExit /> : <Fullscreen />}
          </IconButton>
        </Box>
      </Box>

      {/* Audio track menu - rendered with high z-index to appear above fullscreen video */}
      <Menu
        anchorEl={audioMenuAnchor}
        open={audioMenuOpen}
        onClose={handleAudioMenuClose}
        container={() => containerRef.current}
        anchorOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
        slotProps={{
          paper: {
            sx: {
              bgcolor: 'rgba(0, 0, 0, 0.95)',
              color: 'white',
              minWidth: 200,
            },
          },
        }}
        sx={{
          zIndex: 10001, // Above the fullscreen player overlay (9999) and back button (10000)
        }}
      >
        {audioTracks?.map((track) => (
          <MenuItem
            key={track.streamIndex}
            onClick={() => handleAudioTrackSelect(track.streamIndex)}
            selected={track.streamIndex === currentAudioTrack}
            sx={{
              '&.Mui-selected': {
                bgcolor: 'rgba(255, 255, 255, 0.1)',
              },
              '&:hover': {
                bgcolor: 'rgba(255, 255, 255, 0.2)',
              },
            }}
          >
            {track.streamIndex === currentAudioTrack && (
              <ListItemIcon sx={{ color: 'primary.main', minWidth: 36 }}>
                <Check fontSize="small" />
              </ListItemIcon>
            )}
            <ListItemText
              inset={track.streamIndex !== currentAudioTrack}
              primary={formatAudioTrackLabel(track)}
            />
          </MenuItem>
        ))}
      </Menu>

      {/* Subtitle track menu */}
      <Menu
        anchorEl={subtitleMenuAnchor}
        open={subtitleMenuOpen}
        onClose={handleSubtitleMenuClose}
        container={() => containerRef.current}
        anchorOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
        slotProps={{
          paper: {
            sx: {
              bgcolor: 'rgba(0, 0, 0, 0.95)',
              color: 'white',
              minWidth: 200,
            },
          },
        }}
        sx={{
          zIndex: 10001,
        }}
      >
        {/* Off option */}
        <MenuItem
          onClick={() => handleSubtitleTrackSelect(null)}
          selected={currentSubtitleTrack === null}
          sx={{
            '&.Mui-selected': {
              bgcolor: 'rgba(255, 255, 255, 0.1)',
            },
            '&:hover': {
              bgcolor: 'rgba(255, 255, 255, 0.2)',
            },
          }}
        >
          {currentSubtitleTrack === null && (
            <ListItemIcon sx={{ color: 'primary.main', minWidth: 36 }}>
              <Check fontSize="small" />
            </ListItemIcon>
          )}
          <ListItemText inset={currentSubtitleTrack !== null} primary="Off" />
        </MenuItem>
        {subtitleTracks?.map((track) => (
          <MenuItem
            key={track.streamIndex}
            onClick={() => handleSubtitleTrackSelect(track.streamIndex)}
            selected={track.streamIndex === currentSubtitleTrack}
            sx={{
              '&.Mui-selected': {
                bgcolor: 'rgba(255, 255, 255, 0.1)',
              },
              '&:hover': {
                bgcolor: 'rgba(255, 255, 255, 0.2)',
              },
            }}
          >
            {track.streamIndex === currentSubtitleTrack && (
              <ListItemIcon sx={{ color: 'primary.main', minWidth: 36 }}>
                <Check fontSize="small" />
              </ListItemIcon>
            )}
            <ListItemText
              inset={track.streamIndex !== currentSubtitleTrack}
              primary={formatSubtitleTrackLabel(track)}
            />
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
