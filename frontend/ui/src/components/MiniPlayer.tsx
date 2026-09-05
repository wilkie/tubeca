import { useState, useRef, useCallback, useEffect, type RefObject } from 'react';
import { Box, Paper } from '@mui/material';
import { usePlayer, type MiniPlayerPosition } from '../context/PlayerContext';
import { VideoControls } from './VideoControls';

interface MiniPlayerProps {
  position: MiniPlayerPosition;
  onPositionChange: (position: MiniPlayerPosition) => void;
  containerRef: RefObject<HTMLDivElement | null>; // Ref for video container
}

const CORNER_POSITIONS: Record<MiniPlayerPosition, React.CSSProperties> = {
  'top-left': { top: 80, left: 16 },
  'top-right': { top: 80, right: 16 },
  'bottom-left': { bottom: 16, left: 16 },
  'bottom-right': { bottom: 16, right: 16 },
};

const MAX_PLAYER_WIDTH = 320;
/** Share of a narrow viewport the player may take; more of it covers the page. */
const NARROW_VIEWPORT_SHARE = 0.55;
const MIN_PLAYER_WIDTH = 180;
const NAV_BAR_HEIGHT = 64;

/**
 * The player's size for a given viewport. 320x180 fits a desktop corner; on a
 * phone that is most of the width, so it shrinks to a share of the screen and
 * keeps its 16:9 shape.
 */
export function miniPlayerSize(viewportWidth: number): { width: number; height: number } {
  const width = Math.round(
    Math.max(MIN_PLAYER_WIDTH, Math.min(MAX_PLAYER_WIDTH, viewportWidth * NARROW_VIEWPORT_SHARE))
  );
  return { width, height: Math.round((width * 9) / 16) };
}

export function MiniPlayer({ position, onPositionChange, containerRef }: MiniPlayerProps) {
  const {
    currentMedia,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    isLoading,
    togglePlay,
    seek,
    seekCommit,
    setVolume,
    toggleMute,
    close,
    registerPointerDownHandler,
  } = usePlayer();

  const paperRef = useRef<HTMLDivElement>(null);
  const [{ width: playerWidth, height: playerHeight }, setSize] = useState(() =>
    miniPlayerSize(typeof window === 'undefined' ? MAX_PLAYER_WIDTH : window.innerWidth)
  );

  useEffect(() => {
    const onResize = () => setSize(miniPlayerSize(window.innerWidth));
    window.addEventListener('resize', onResize);
    // A phone turned on its side changes both the width and which corner is
    // reachable, so re-measure rather than keep a portrait size.
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [showControls, setShowControls] = useState(true);
  const hideControlsTimeout = useRef<number | null>(null);
  const lastPointerTypeRef = useRef<string>('mouse');

  // Get current position based on corner or drag
  const getPositionStyles = useCallback((): React.CSSProperties => {
    if (isDragging) {
      return {
        top: dragPosition.y,
        left: dragPosition.x,
        right: 'auto',
        bottom: 'auto',
      };
    }
    return CORNER_POSITIONS[position];
  }, [isDragging, dragPosition, position]);

  // Calculate nearest corner based on position
  const calculateNearestCorner = useCallback((x: number, y: number): MiniPlayerPosition => {
    const midX = window.innerWidth / 2;
    const midY = window.innerHeight / 2;

    const isLeft = x + playerWidth / 2 < midX;
    const isTop = y + playerHeight / 2 < midY;

    if (isTop && isLeft) return 'top-left';
    if (isTop && !isLeft) return 'top-right';
    if (!isTop && isLeft) return 'bottom-left';
    return 'bottom-right';
  }, [playerWidth, playerHeight]);

  // Drag handlers. Pointer events cover mouse, touch and pen with one path, so
  // the player can be moved with a finger.
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    lastPointerTypeRef.current = e.pointerType;

    // Only start drag if pressing on the drag handle area (top of player)
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('[role="slider"]')) {
      return; // Don't start drag on controls
    }

    const rect = paperRef.current?.getBoundingClientRect();
    if (!rect) return;

    setIsDragging(true);
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    setDragPosition({
      x: rect.left,
      y: rect.top,
    });
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e: PointerEvent) => {
      const newX = Math.max(0, Math.min(window.innerWidth - playerWidth, e.clientX - dragOffset.x));
      const newY = Math.max(NAV_BAR_HEIGHT, Math.min(window.innerHeight - playerHeight, e.clientY - dragOffset.y));
      setDragPosition({ x: newX, y: newY });
    };

    const handlePointerUp = (e: PointerEvent) => {
      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;
      const newCorner = calculateNearestCorner(newX, newY);
      onPositionChange(newCorner);
      setIsDragging(false);
    };

    const handlePointerCancel = () => setIsDragging(false);

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [isDragging, dragOffset, calculateNearestCorner, onPositionChange, playerWidth, playerHeight]);

  // Register the handler for the video container, which is moved into this
  // frame by DOM manipulation rather than rendered here.
  useEffect(() => {
    registerPointerDownHandler(handlePointerDown);
    return () => {
      registerPointerDownHandler(null);
    };
  }, [registerPointerDownHandler, handlePointerDown]);

  // Auto-hide controls
  const showControlsBriefly = useCallback(() => {
    setShowControls(true);
    if (hideControlsTimeout.current) {
      clearTimeout(hideControlsTimeout.current);
    }
    hideControlsTimeout.current = window.setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3000);
  }, [isPlaying]);

  const handleMouseLeave = useCallback(() => {
    if (isPlaying) {
      setShowControls(false);
    }
  }, [isPlaying]);

  // Tap or click on the video. A touch device has no hover, so a tap while the
  // controls are hidden reveals them instead of toggling playback — otherwise
  // reaching the controls means pausing first.
  const handleVideoClick = useCallback(() => {
    if (lastPointerTypeRef.current !== 'mouse' && !showControls) {
      showControlsBriefly();
      return;
    }
    togglePlay();
  }, [togglePlay, showControls, showControlsBriefly]);

  if (!currentMedia) return null;

  return (
    <Paper
      ref={paperRef}
      elevation={8}
      onPointerMove={showControlsBriefly}
      onPointerDown={handlePointerDown}
      onMouseLeave={handleMouseLeave}
      sx={{
        position: 'fixed',
        width: playerWidth,
        zIndex: 9998,
        borderRadius: 2,
        overflow: 'hidden',
        cursor: isDragging ? 'grabbing' : 'grab',
        // The browser must not treat a drag on the player as a page scroll.
        touchAction: 'none',
        transition: isDragging ? 'none' : 'top 0.3s ease, left 0.3s ease, right 0.3s ease, bottom 0.3s ease',
        ...getPositionStyles(),
      }}
    >
      {/* Video container - video element is moved here via DOM manipulation */}
      <Box
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onClick={handleVideoClick}
        sx={{
          width: playerWidth,
          height: playerHeight,
          backgroundColor: '#000',
          position: 'relative',
        }}
      >
        {/* Video element is appended here via useLayoutEffect in PlayerContext */}

        {/* Controls overlay */}
        <VideoControls
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          volume={volume}
          isMuted={isMuted}
          isLoading={isLoading}
          mediaId={currentMedia.id}
          compact={true}
          showFullscreenButton={false}
          showExpandButton={true}
          showCloseButton={true}
          showControls={showControls}
          onPlayPause={togglePlay}
          onSeek={seek}
          onSeekCommit={seekCommit}
          onVolumeChange={setVolume}
          onMuteToggle={toggleMute}
          onClose={close}
        />
      </Box>
    </Paper>
  );
}
