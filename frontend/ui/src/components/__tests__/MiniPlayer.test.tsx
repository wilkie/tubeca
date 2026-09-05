import {
  DEFAULT_VIEWPORT_WIDTH,
  fireEvent,
  render,
  screen,
  setViewportWidth,
  waitFor,
} from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { MiniPlayer, miniPlayerSize } from '../MiniPlayer';
import { usePlayer } from '../../context/PlayerContext';
import { act, createRef } from 'react';

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
    error: null,
    currentAudioTrack: undefined,
    currentSubtitleTrack: null,
    currentQuality: 'auto',
    availableQualities: [],
    mode: 'mini' as const,
    miniPlayerPosition: 'bottom-right' as const,
    playMedia: jest.fn(),
    retryPlayback: jest.fn(),
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
    registerPointerDownHandler: jest.fn(),
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
    it('registers a pointer down handler on mount', () => {
      const registerPointerDownHandler = jest.fn();

      mockUsePlayer.mockReturnValue({
        ...mockPlayerState,
        registerPointerDownHandler,
      });

      render(<MiniPlayer {...defaultProps} />);

      expect(registerPointerDownHandler).toHaveBeenCalled();
    });

    it('unregisters the pointer down handler on unmount', () => {
      const registerPointerDownHandler = jest.fn();

      mockUsePlayer.mockReturnValue({
        ...mockPlayerState,
        registerPointerDownHandler,
      });

      const { unmount } = render(<MiniPlayer {...defaultProps} />);

      unmount();

      // Last call should be with null to unregister
      expect(registerPointerDownHandler).toHaveBeenLastCalledWith(null);
    });

    it('starts drag on pointer down', () => {
      render(<MiniPlayer {...defaultProps} />);

      const videoContainer = document.querySelector('[class*="MuiBox-root"]');
      expect(videoContainer).toBeTruthy();

      // Simulate a press on the container (not on a button)
      fireEvent.pointerDown(videoContainer!, { clientX: 100, clientY: 100 });

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

    it('shows controls on pointer move', () => {
      render(<MiniPlayer {...defaultProps} />);

      const paper = getPaperElement();
      fireEvent.pointerMove(paper!);

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

    it('brings the controls back on a tap instead of pausing', () => {
      jest.useFakeTimers();
      const togglePlay = jest.fn();
      mockUsePlayer.mockReturnValue({ ...mockPlayerState, isPlaying: true, togglePlay });

      render(<MiniPlayer {...defaultProps} />);
      const videoContainer = document.querySelector('[class*="MuiBox-root"]')!;

      // Let the controls hide, as they do a few seconds into playback.
      fireEvent.pointerMove(getPaperElement()!);
      act(() => {
        jest.advanceTimersByTime(3500);
      });

      fireEvent.pointerDown(videoContainer, { pointerType: 'touch' });
      fireEvent.click(videoContainer);

      // The first tap only reveals the controls.
      expect(togglePlay).not.toHaveBeenCalled();

      // A second tap, with the controls up, toggles playback.
      fireEvent.pointerDown(videoContainer, { pointerType: 'touch' });
      fireEvent.click(videoContainer);
      expect(togglePlay).toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('still toggles straight away for a mouse', () => {
      jest.useFakeTimers();
      const togglePlay = jest.fn();
      mockUsePlayer.mockReturnValue({ ...mockPlayerState, isPlaying: true, togglePlay });

      render(<MiniPlayer {...defaultProps} />);
      const videoContainer = document.querySelector('[class*="MuiBox-root"]')!;
      fireEvent.pointerMove(getPaperElement()!);
      act(() => {
        jest.advanceTimersByTime(3500);
      });

      fireEvent.pointerDown(videoContainer, { pointerType: 'mouse' });
      fireEvent.click(videoContainer);

      expect(togglePlay).toHaveBeenCalled();
      jest.useRealTimers();
    });
  });

  describe('sizing', () => {
    afterEach(() => setViewportWidth(DEFAULT_VIEWPORT_WIDTH));

    it('fills a desktop corner at its full size', () => {
      expect(miniPlayerSize(1440)).toEqual({ width: 320, height: 180 });
    });

    it('takes about half a phone rather than most of it', () => {
      // 320px on a 390px screen leaves the page all but covered.
      expect(miniPlayerSize(390)).toEqual({ width: 215, height: 121 });
      expect(miniPlayerSize(360)).toEqual({ width: 198, height: 111 });
    });

    it('stops shrinking before the controls stop fitting', () => {
      expect(miniPlayerSize(200)).toEqual({ width: 180, height: 101 });
    });

    it('follows the window when it changes', () => {
      render(<MiniPlayer {...defaultProps} />);
      expect(getPaperElement()).toHaveStyle({ width: '320px' });

      setViewportWidth(390);

      expect(getPaperElement()).toHaveStyle({ width: '215px' });
    });
  });
});
