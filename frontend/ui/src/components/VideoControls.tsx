import { useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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
  OpenInFull,
  Close,
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
  url: string;
}

export interface VideoControlsProps {
  // Playback state
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isLoading: boolean;
  isFullscreen?: boolean;

  // Track info
  audioTracks?: AudioTrackInfo[];
  currentAudioTrack?: number;
  subtitleTracks?: SubtitleTrackInfo[];
  currentSubtitleTrack?: number | null;

  // Trickplay
  trickplay?: TrickplayResolution;
  mediaId?: string;

  // Display options
  title?: string;
  compact?: boolean; // For mini-player: simplified layout
  showFullscreenButton?: boolean;
  showExpandButton?: boolean; // For mini-player: navigate to PlayPage
  showCloseButton?: boolean; // For mini-player: stop playback
  showControls?: boolean; // Whether controls are visible

  // Callbacks
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  onSeekCommit: (time: number) => void;
  onVolumeChange: (volume: number) => void;
  onMuteToggle: () => void;
  onAudioTrackChange?: (streamIndex: number) => void;
  onSubtitleTrackChange?: (streamIndex: number | null) => void;
  onFullscreenToggle?: () => void;
  onClose?: () => void;

  // Container ref for menus
  containerRef?: React.RefObject<HTMLElement | null>;
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

export function formatTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatAudioTrackLabel(track: AudioTrackInfo): string {
  const parts: string[] = [];

  if (track.language) {
    const langName = LANGUAGE_NAMES[track.language.toLowerCase()] || track.language.toUpperCase();
    parts.push(langName);
  }

  if (track.title && (!track.language || !track.title.toLowerCase().includes(track.language.toLowerCase()))) {
    parts.push(track.title);
  }

  if (track.channelLayout) {
    parts.push(track.channelLayout);
  } else if (track.channels) {
    parts.push(`${track.channels}ch`);
  }

  return parts.length > 0 ? parts.join(' - ') : `Track ${track.streamIndex}`;
}

export function formatSubtitleTrackLabel(track: SubtitleTrackInfo): string {
  const parts: string[] = [];

  if (track.language) {
    const langName = LANGUAGE_NAMES[track.language.toLowerCase()] || track.language.toUpperCase();
    parts.push(langName);
  }

  if (track.title && (!track.language || !track.title.toLowerCase().includes(track.language.toLowerCase()))) {
    parts.push(track.title);
  }

  if (track.isForced) {
    parts.push('(Forced)');
  }

  return parts.length > 0 ? parts.join(' - ') : `Track ${track.streamIndex}`;
}

export function VideoControls({
  isPlaying,
  currentTime,
  duration,
  volume,
  isMuted,
  isLoading,
  isFullscreen = false,
  audioTracks,
  currentAudioTrack,
  subtitleTracks,
  currentSubtitleTrack,
  trickplay,
  mediaId,
  title,
  compact = false,
  showFullscreenButton = true,
  showExpandButton = false,
  showCloseButton = false,
  showControls = true,
  onPlayPause,
  onSeek,
  onSeekCommit,
  onVolumeChange,
  onMuteToggle,
  onAudioTrackChange,
  onSubtitleTrackChange,
  onFullscreenToggle,
  onClose,
  containerRef,
}: VideoControlsProps) {
  const navigate = useNavigate();
  const sliderRef = useRef<HTMLDivElement>(null);

  // Audio track menu state
  const [audioMenuAnchor, setAudioMenuAnchor] = useState<null | HTMLElement>(null);
  const audioMenuOpen = Boolean(audioMenuAnchor);

  // Subtitle track menu state
  const [subtitleMenuAnchor, setSubtitleMenuAnchor] = useState<null | HTMLElement>(null);
  const subtitleMenuOpen = Boolean(subtitleMenuAnchor);

  // Trickplay preview state
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewX, setPreviewX] = useState(0);

  const hasMultipleAudioTracks = audioTracks && audioTracks.length > 1;
  const hasSubtitleTracks = subtitleTracks && subtitleTracks.length > 0;

  // Container getter for menus (avoids accessing ref during render)
  const getContainer = useCallback(() => containerRef?.current ?? null, [containerRef]);

  // Handlers
  const handleSeekChange = (_: Event, value: number | number[]) => {
    const newTime = Array.isArray(value) ? value[0] : value;
    onSeek(newTime);
  };

  const handleSeekCommit = (_: Event | React.SyntheticEvent, value: number | number[]) => {
    const newTime = Array.isArray(value) ? value[0] : value;
    onSeekCommit(newTime);
  };

  const handleVolumeChange = (_: Event, value: number | number[]) => {
    const newVolume = Array.isArray(value) ? value[0] : value;
    onVolumeChange(newVolume);
  };

  const handleAudioMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setAudioMenuAnchor(event.currentTarget);
  };

  const handleAudioMenuClose = () => {
    setAudioMenuAnchor(null);
  };

  const handleAudioTrackSelect = (streamIndex: number) => {
    handleAudioMenuClose();
    onAudioTrackChange?.(streamIndex);
  };

  const handleSubtitleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setSubtitleMenuAnchor(event.currentTarget);
  };

  const handleSubtitleMenuClose = () => {
    setSubtitleMenuAnchor(null);
  };

  const handleSubtitleTrackSelect = (streamIndex: number | null) => {
    handleSubtitleMenuClose();
    onSubtitleTrackChange?.(streamIndex);
  };

  const handleExpand = () => {
    if (mediaId) {
      navigate(`/play/${mediaId}`);
    }
  };

  // Trickplay preview handlers
  const handleSliderMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!trickplay || !mediaId || !sliderRef.current) return;

      const rect = sliderRef.current.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const percent = Math.max(0, Math.min(1, x / rect.width));
      const time = percent * duration;

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

  return (
    <>
      {/* Loading spinner */}
      {isLoading && (
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 5,
          }}
        >
          <CircularProgress sx={{ color: 'white' }} size={compact ? 32 : 48} />
        </Box>
      )}

      {/* Controls overlay */}
      <Box
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 10, // Above video element
          background: compact ? 'rgba(0,0,0,0.8)' : 'linear-gradient(transparent, rgba(0,0,0,0.8))',
          padding: compact ? 1 : 2,
          opacity: showControls ? 1 : 0,
          transition: 'opacity 0.3s',
        }}
      >
        {/* Title - not shown in compact mode */}
        {title && !compact && (
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
          {/* Trickplay preview tooltip - not shown in compact mode */}
          {trickplay && mediaId && previewVisible && !compact && (
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
            size={compact ? 'small' : 'medium'}
            sx={{
              color: 'primary.main',
              '& .MuiSlider-thumb': {
                width: compact ? 8 : 12,
                height: compact ? 8 : 12,
              },
            }}
          />
        </Box>

        {/* Controls row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: compact ? 0.5 : 1 }}>
          <IconButton onClick={onPlayPause} sx={{ color: 'white' }} size={compact ? 'small' : 'medium'}>
            {isPlaying ? <Pause fontSize={compact ? 'small' : 'medium'} /> : <PlayArrow fontSize={compact ? 'small' : 'medium'} />}
          </IconButton>

          {!compact && (
            <Typography variant="body2" sx={{ color: 'white', minWidth: 100 }}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </Typography>
          )}

          <Box sx={{ flexGrow: 1 }} />

          {/* Volume controls */}
          <IconButton onClick={onMuteToggle} sx={{ color: 'white' }} size={compact ? 'small' : 'medium'}>
            {isMuted ? <VolumeOff fontSize={compact ? 'small' : 'medium'} /> : <VolumeUp fontSize={compact ? 'small' : 'medium'} />}
          </IconButton>

          {!compact && (
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
          )}

          {/* Subtitle track selector - not in compact mode */}
          {hasSubtitleTracks && !compact && (
            <IconButton
              onClick={handleSubtitleMenuOpen}
              sx={{ color: currentSubtitleTrack !== null ? 'primary.main' : 'white' }}
              aria-label="Select subtitle track"
            >
              <Subtitles />
            </IconButton>
          )}

          {/* Audio track selector - not in compact mode */}
          {hasMultipleAudioTracks && !compact && (
            <IconButton
              onClick={handleAudioMenuOpen}
              sx={{ color: 'white' }}
              aria-label="Select audio track"
            >
              <Audiotrack />
            </IconButton>
          )}

          {/* Fullscreen button */}
          {showFullscreenButton && onFullscreenToggle && !compact && (
            <IconButton onClick={onFullscreenToggle} sx={{ color: 'white' }}>
              {isFullscreen ? <FullscreenExit /> : <Fullscreen />}
            </IconButton>
          )}

          {/* Expand button (for mini-player) */}
          {showExpandButton && (
            <IconButton onClick={handleExpand} sx={{ color: 'white' }} size={compact ? 'small' : 'medium'}>
              <OpenInFull fontSize={compact ? 'small' : 'medium'} />
            </IconButton>
          )}

          {/* Close button (for mini-player) */}
          {showCloseButton && onClose && (
            <IconButton onClick={onClose} sx={{ color: 'white' }} size={compact ? 'small' : 'medium'}>
              <Close fontSize={compact ? 'small' : 'medium'} />
            </IconButton>
          )}
        </Box>
      </Box>

      {/* Audio track menu */}
      <Menu
        anchorEl={audioMenuAnchor}
        open={audioMenuOpen}
        onClose={handleAudioMenuClose}
        container={getContainer}
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
        container={getContainer}
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
    </>
  );
}
