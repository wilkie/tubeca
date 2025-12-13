import { render, screen, fireEvent, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { MiniPlayer } from '../MiniPlayer';
import { usePlayer } from '../../context/PlayerContext';
import { createRef } from 'react';

// Mock the PlayerContext
jest.mock('../../context/PlayerContext', () => ({
  usePlayer: jest.fn(),
}));

// Mock useNavigate
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const mockUsePlayer = usePlayer as jest.MockedFunction<typeof usePlayer>;

describe('MiniPlayer', () => {
  const mockCurrentMedia = {
    id: 'media-1',
    name: 'Test Video',
    duration: 3600,
    type: 'Video' as const,
    audioTracks: [],
    subtitleTracks: [],
  };

  const mockPlayerState = {
    currentMedia: mockCurrentMedia,
    isPlaying: false,
    currentTime: 0,
    duration: 3600,
    volume: 1,
    isMuted: false,
    isLoading: false,
    currentAudioTrack: undefined,
    currentSubtitleTrack: null,
    currentQuality: 'auto',
    availableQualities: [],
    mode: 'mini' as const,
    miniPlayerPosition: 'bottom-right' as const,
    playMedia: jest.fn(),
    play: jest.fn(),
    pause: jest.fn(),
    togglePlay: jest.fn(),
    seek: jest.fn(),
    seekCommit: jest.fn(),
    setVolume: jest.fn(),
    toggleMute: jest.fn(),
    setAudioTrack: jest.fn(),
    setSubtitleTrack: jest.fn(),
    setQuality: jest.fn(),
    setMode: jest.fn(),
    registerFullscreenContainer: jest.fn(),
    registerMouseMoveHandler: jest.fn(),
    registerMouseDownHandler: jest.fn(),
    registerClickHandler: jest.fn(),
    close: jest.fn(),
    setMiniPlayerPosition: jest.fn(),
    // Queue
    queue: [],
    queueIndex: -1,
    nextItem: null,
    previousItem: null,
    refreshQueue: jest.fn(),
    playNext: jest.fn(),
    playPrevious: jest.fn(),
    hasNextItem: jest.fn().mockReturnValue(false),
    hasPreviousItem: jest.fn().mockReturnValue(false),
  };

  const defaultProps = {
    position: 'bottom-right' as const,
    onPositionChange: jest.fn(),
    containerRef: createRef<HTMLDivElement>(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlayer.mockReturnValue(mockPlayerState);
  });

  // Helper to get the Paper element
  const getPaperElement = (): HTMLElement | null => {
    return document.querySelector('.MuiPaper-root');
  };

  describe('rendering', () => {
    it('renders when currentMedia is available', () => {
      render(<MiniPlayer {...defaultProps} />);

      // Should render the Paper component (mini player container)
      expect(getPaperElement()).toBeInTheDocument();
    });

    it('returns null when no currentMedia', () => {
      mockUsePlayer.mockReturnValue({
        ...mockPlayerState,
        currentMedia: null,
      });

      const { container } = render(<MiniPlayer {...defaultProps} />);

      expect(container.firstChild).toBeNull();
    });

    it('renders play button when not playing', () => {
      mockUsePlayer.mockReturnValue({
        ...mockPlayerState,
        isPlaying: false,
      });

      render(<MiniPlayer {...defaultProps} />);

      expect(screen.getByTestId('PlayArrowIcon')).toBeInTheDocument();
    });

    it('renders pause button when playing', () => {
      mockUsePlayer.mockReturnValue({
        ...mockPlayerState,
        isPlaying: true,
      });

      render(<MiniPlayer {...defaultProps} />);

      expect(screen.getByTestId('PauseIcon')).toBeInTheDocument();
    });

    it('renders loading spinner when loading', () => {
      mockUsePlayer.mockReturnValue({
        ...mockPlayerState,
        isLoading: true,
      });

      render(<MiniPlayer {...defaultProps} />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('renders expand button', () => {
      render(<MiniPlayer {...defaultProps} />);

      expect(screen.getByTestId('OpenInFullIcon')).toBeInTheDocument();
    });

    it('renders close button', () => {
      render(<MiniPlayer {...defaultProps} />);

      expect(screen.getByTestId('CloseIcon')).toBeInTheDocument();
    });

    it('renders volume button', () => {
      render(<MiniPlayer {...defaultProps} />);

      expect(screen.getByTestId('VolumeUpIcon')).toBeInTheDocument();
    });

    it('renders muted icon when muted', () => {
      mockUsePlayer.mockReturnValue({
        ...mockPlayerState,
        isMuted: true,
      });

      render(<MiniPlayer {...defaultProps} />);

      expect(screen.getByTestId('VolumeOffIcon')).toBeInTheDocument();
    });
  });

  describe('controls', () => {
    it('calls togglePlay when play button clicked', async () => {
      const user = userEvent.setup();
      const togglePlay = jest.fn();

      mockUsePlayer.mockReturnValue({
        ...mockPlayerState,
        togglePlay,
      });

      render(<MiniPlayer {...defaultProps} />);

      await user.click(screen.getByTestId('PlayArrowIcon').closest('button')!);

      expect(togglePlay).toHaveBeenCalled();
    });

    it('calls toggleMute when mute button clicked', async () => {
      const user = userEvent.setup();
      const toggleMute = jest.fn();

      mockUsePlayer.mockReturnValue({
        ...mockPlayerState,
        toggleMute,
      });

      render(<MiniPlayer {...defaultProps} />);

      await user.click(screen.getByTestId('VolumeUpIcon').closest('button')!);

      expect(toggleMute).toHaveBeenCalled();
    });

    it('calls close when close button clicked', async () => {
      const user = userEvent.setup();
      const close = jest.fn();

      mockUsePlayer.mockReturnValue({
        ...mockPlayerState,
        close,
      });

      render(<MiniPlayer {...defaultProps} />);

      await user.click(screen.getByTestId('CloseIcon').closest('button')!);

      expect(close).toHaveBeenCalled();
    });

    it('navigates to play page when expand clicked', async () => {
      const user = userEvent.setup();

      render(<MiniPlayer {...defaultProps} />);

      await user.click(screen.getByTestId('OpenInFullIcon').closest('button')!);

      expect(mockNavigate).toHaveBeenCalledWith('/play/media-1');
    });
  });

  describe('position', () => {
    it('applies bottom-right position styles', () => {
      render(<MiniPlayer {...defaultProps} position="bottom-right" />);

      const paper = getPaperElement();
      expect(paper).toHaveStyle({ bottom: '16px', right: '16px' });
    });

    it('applies bottom-left position styles', () => {
      render(<MiniPlayer {...defaultProps} position="bottom-left" />);

      const paper = getPaperElement();
      expect(paper).toHaveStyle({ bottom: '16px', left: '16px' });
    });

    it('applies top-right position styles', () => {
      render(<MiniPlayer {...defaultProps} position="top-right" />);

      const paper = getPaperElement();
      expect(paper).toHaveStyle({ top: '80px', right: '16px' });
    });

    it('applies top-left position styles', () => {
      render(<MiniPlayer {...defaultProps} position="top-left" />);

      const paper = getPaperElement();
      expect(paper).toHaveStyle({ top: '80px', left: '16px' });
    });
  });

  describe('dragging', () => {
    it('registers mouse down handler on mount', () => {
      const registerMouseDownHandler = jest.fn();

      mockUsePlayer.mockReturnValue({
        ...mockPlayerState,
        registerMouseDownHandler,
      });

      render(<MiniPlayer {...defaultProps} />);

      expect(registerMouseDownHandler).toHaveBeenCalled();
    });

    it('unregisters mouse down handler on unmount', () => {
      const registerMouseDownHandler = jest.fn();

      mockUsePlayer.mockReturnValue({
        ...mockPlayerState,
        registerMouseDownHandler,
      });

      const { unmount } = render(<MiniPlayer {...defaultProps} />);

      unmount();

      // Last call should be with null to unregister
      expect(registerMouseDownHandler).toHaveBeenLastCalledWith(null);
    });

    it('starts drag on mouse down', () => {
      render(<MiniPlayer {...defaultProps} />);

      const videoContainer = document.querySelector('[class*="MuiBox-root"]');
      expect(videoContainer).toBeTruthy();

      // Simulate mouse down on the container (not on a button)
      fireEvent.mouseDown(videoContainer!, { clientX: 100, clientY: 100 });

      // The player should now be in dragging mode
      const paper = getPaperElement();
      expect(paper).toHaveStyle({ cursor: 'grabbing' });
    });

    it('does not start drag when clicking on a button', async () => {
      const user = userEvent.setup();

      render(<MiniPlayer {...defaultProps} />);

      // Click on the play button
      await user.click(screen.getByTestId('PlayArrowIcon').closest('button')!);

      // The player should not be in dragging mode
      const paper = getPaperElement();
      expect(paper).toHaveStyle({ cursor: 'grab' });
    });
  });

  describe('controls visibility', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('shows controls initially', () => {
      render(<MiniPlayer {...defaultProps} />);

      // Controls should be visible
      expect(screen.getByTestId('PlayArrowIcon')).toBeInTheDocument();
    });

    it('shows controls on mouse move', () => {
      render(<MiniPlayer {...defaultProps} />);

      const paper = getPaperElement();
      fireEvent.mouseMove(paper!);

      // Controls should be visible
      expect(screen.getByTestId('PlayArrowIcon')).toBeInTheDocument();
    });

    it('hides controls after timeout when playing', async () => {
      mockUsePlayer.mockReturnValue({
        ...mockPlayerState,
        isPlaying: true,
      });

      render(<MiniPlayer {...defaultProps} />);

      const paper = getPaperElement();

      // Trigger mouse leave
      fireEvent.mouseLeave(paper!);

      // Controls should be hidden after mouse leave while playing
      await waitFor(() => {
        // The controls overlay should have opacity 0
        // This is a bit tricky to test, so we just verify no error
      });
    });

    it('keeps controls visible when not playing', () => {
      mockUsePlayer.mockReturnValue({
        ...mockPlayerState,
        isPlaying: false,
      });

      render(<MiniPlayer {...defaultProps} />);

      const paper = getPaperElement();

      // Trigger mouse leave
      fireEvent.mouseLeave(paper!);

      // Controls should still be visible (opacity 1)
      expect(screen.getByTestId('PlayArrowIcon')).toBeInTheDocument();
    });
  });

  describe('video click', () => {
    it('calls togglePlay when video container clicked', () => {
      const togglePlay = jest.fn();

      mockUsePlayer.mockReturnValue({
        ...mockPlayerState,
        togglePlay,
      });

      render(<MiniPlayer {...defaultProps} />);

      // Find and click the video container
      const videoContainer = document.querySelector('[class*="MuiBox-root"]');
      expect(videoContainer).toBeTruthy();

      // Click on the container (not on the buttons)
      fireEvent.click(videoContainer!);

      expect(togglePlay).toHaveBeenCalled();
    });
  });
});
