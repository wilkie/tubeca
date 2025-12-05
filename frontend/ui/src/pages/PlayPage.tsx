import { useEffect, useRef, useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, CircularProgress, IconButton, Typography } from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import { usePlayer } from '../context/PlayerContext';
import { VideoControls } from '../components/VideoControls';
import { apiClient } from '../api/client';

export function PlayPage() {
  const { t } = useTranslation();
  const { mediaId } = useParams<{ mediaId: string }>();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [showControls, setShowControls] = useState(true);
  const hideControlsTimeout = useRef<number | null>(null);
  const isPlayingRef = useRef(false);

  const {
    currentMedia,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    isLoading,
    currentAudioTrack,
    currentSubtitleTrack,
    playMedia,
    togglePlay,
    seek,
    seekCommit,
    setVolume,
    toggleMute,
    setAudioTrack,
    setSubtitleTrack,
    registerFullscreenContainer,
    registerMouseMoveHandler,
  } = usePlayer();

  // Register this container for fullscreen mode
  useEffect(() => {
    if (containerRef.current) {
      registerFullscreenContainer(containerRef.current);
    }
    return () => {
      registerFullscreenContainer(null);
    };
  }, [registerFullscreenContainer]);

  // Load media if not already loaded or different media
  useEffect(() => {
    if (!mediaId) return;

    // Only load if no media or different media
    if (!currentMedia || currentMedia.id !== mediaId) {
      playMedia(mediaId);
    }
  }, [mediaId, currentMedia, playMedia]);

  // Keep ref in sync with isPlaying state
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const handleBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  // Show controls and reset hide timeout
  const showControlsWithTimeout = useCallback(() => {
    setShowControls(true);
    if (hideControlsTimeout.current) {
      clearTimeout(hideControlsTimeout.current);
    }
    hideControlsTimeout.current = window.setTimeout(() => {
      // Use ref to get current playing state, not stale closure value
      if (isPlayingRef.current) {
        setShowControls(false);
      }
    }, 3000);
  }, []);

  const handleMouseMove = useCallback(() => {
    showControlsWithTimeout();
  }, [showControlsWithTimeout]);

  const handleMouseLeave = useCallback(() => {
    if (isPlayingRef.current) {
      setShowControls(false);
    }
  }, []);

  // Handle keyboard events to show controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Navigation keys that should show controls
      const navigationKeys = [
        'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
        ' ', 'Space', 'Enter', 'Escape',
        'f', 'F', 'm', 'M', // fullscreen, mute
      ];

      if (navigationKeys.includes(e.key)) {
        showControlsWithTimeout();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showControlsWithTimeout]);

  // Register mouse move handler for video element (portaled, so needs separate handler)
  useEffect(() => {
    registerMouseMoveHandler(showControlsWithTimeout);
    return () => {
      registerMouseMoveHandler(null);
    };
  }, [registerMouseMoveHandler, showControlsWithTimeout]);

  // Start hide timeout when component mounts with controls visible
  useEffect(() => {
    // Initial timer to hide controls
    hideControlsTimeout.current = window.setTimeout(() => {
      if (isPlayingRef.current) {
        setShowControls(false);
      }
    }, 3000);

    return () => {
      if (hideControlsTimeout.current) {
        clearTimeout(hideControlsTimeout.current);
      }
    };
  }, []);

  const handleFullscreenToggle = useCallback(() => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  const handleVideoClick = useCallback(() => {
    togglePlay();
  }, [togglePlay]);

  // Loading state - show while fetching media
  if (isLoading && !currentMedia) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          backgroundColor: '#000',
        }}
      >
        <CircularProgress sx={{ color: 'white' }} />
      </Box>
    );
  }

  // Error state - no media loaded
  if (!currentMedia && !isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          backgroundColor: '#000',
          color: 'white',
        }}
      >
        <Typography variant="h6" gutterBottom>
          {t('media.notFound')}
        </Typography>
        <IconButton onClick={handleBack} sx={{ color: 'white' }}>
          <ArrowBack />
        </IconButton>
      </Box>
    );
  }

  // Audio media - use native audio player
  if (currentMedia?.type === 'Audio') {
    const streamUrl = apiClient.getAudioStreamUrl(currentMedia.id);
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          backgroundColor: '#000',
          color: 'white',
        }}
      >
        <IconButton
          onClick={handleBack}
          sx={{
            position: 'absolute',
            top: 16,
            left: 16,
            color: 'white',
            backgroundColor: 'rgba(0,0,0,0.5)',
            '&:hover': {
              backgroundColor: 'rgba(0,0,0,0.7)',
            },
          }}
        >
          <ArrowBack />
        </IconButton>
        <Typography variant="h5" gutterBottom>
          {currentMedia.name}
        </Typography>
        <audio controls autoPlay src={streamUrl} style={{ width: '80%', maxWidth: 600 }}>
          {t('media.audioNotSupported')}
        </audio>
      </Box>
    );
  }

  // Video media - use player context
  return (
    <Box
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleVideoClick}
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#000',
        zIndex: 9999,
        cursor: showControls ? 'default' : 'none',
      }}
    >
      {/* Back button overlay */}
      <IconButton
        onClick={(e) => {
          e.stopPropagation();
          handleBack();
        }}
        sx={{
          position: 'absolute',
          top: 16,
          left: 16,
          zIndex: 10000,
          color: 'white',
          backgroundColor: 'rgba(0,0,0,0.5)',
          opacity: showControls ? 1 : 0,
          transition: 'opacity 0.3s',
          '&:hover': {
            backgroundColor: 'rgba(0,0,0,0.7)',
          },
        }}
      >
        <ArrowBack />
      </IconButton>

      {/* Video element is portaled here by PlayerProvider */}
      {/* The video element fills this container */}

      {/* Controls overlay */}
      {currentMedia && (
        <VideoControls
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          volume={volume}
          isMuted={isMuted}
          isLoading={isLoading}
          audioTracks={currentMedia.audioTracks}
          currentAudioTrack={currentAudioTrack}
          subtitleTracks={currentMedia.subtitleTracks}
          currentSubtitleTrack={currentSubtitleTrack}
          trickplay={currentMedia.trickplay}
          mediaId={currentMedia.id}
          title={currentMedia.name}
          showControls={showControls}
          showFullscreenButton={true}
          onPlayPause={togglePlay}
          onSeek={seek}
          onSeekCommit={seekCommit}
          onVolumeChange={setVolume}
          onMuteToggle={toggleMute}
          onAudioTrackChange={setAudioTrack}
          onSubtitleTrackChange={setSubtitleTrack}
          onFullscreenToggle={handleFullscreenToggle}
          containerRef={containerRef}
        />
      )}
    </Box>
  );
}
