import { render, screen, waitFor, fireEvent, act } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { PlayPage } from '../PlayPage';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    getMedia: jest.fn(),
    getVideoStreamUrl: jest.fn((id, start, audio) => `http://localhost/api/stream/${id}?start=${start || 0}&audio=${audio || 0}`),
    getAudioStreamUrl: jest.fn((id) => `http://localhost/api/audio/${id}`),
    getSubtitleUrl: jest.fn((id, idx) => `http://localhost/api/subtitles/${id}/${idx}`),
    getImageUrl: jest.fn((id) => `http://localhost/api/images/${id}`),
    getTrickplayInfo: jest.fn(() => Promise.resolve({ data: { trickplay: { available: false, resolutions: [] } } })),
  },
}));

// Mock VideoControls component
jest.mock('../../components/VideoControls', () => ({
  VideoControls: jest.fn(({ title, onPlayPause }) => (
    <div data-testid="video-controls" data-title={title}>
      <button onClick={onPlayPause} data-testid="play-pause">Play/Pause</button>
    </div>
  )),
}));

// Mock useParams
let mockMediaId: string | undefined = 'media-123';
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ mediaId: mockMediaId }),
  useNavigate: () => mockNavigate,
}));

const mockNavigate = jest.fn();

// Mock player context state and actions
const mockPlayMedia = jest.fn();
const mockTogglePlay = jest.fn();
const mockSeek = jest.fn();
const mockSeekCommit = jest.fn();
const mockSetVolume = jest.fn();
const mockToggleMute = jest.fn();
const mockSetAudioTrack = jest.fn();
const mockSetSubtitleTrack = jest.fn();
const mockRegisterFullscreenContainer = jest.fn();
const mockRegisterMouseMoveHandler = jest.fn();
const mockRegisterPointerDownHandler = jest.fn();
const mockRegisterClickHandler = jest.fn();
const mockRetryPlayback = jest.fn();

let mockPlayerState = {
  currentMedia: null as null | {
    id: string;
    name: string;
    duration: number;
    type: 'Video' | 'Audio';
    audioTracks: { streamIndex: number; language?: string; title?: string; isDefault: boolean }[];
    subtitleTracks: { streamIndex: number; language?: string; title?: string; isDefault: boolean; url: string }[];
    trickplay?: { width: number; height: number };
  },
  isPlaying: false,
  currentTime: 0,
  duration: 7200,
  volume: 1,
  isMuted: false,
  isLoading: false,
  currentAudioTrack: 1,
  currentSubtitleTrack: null,
  mode: 'hidden' as 'fullscreen' | 'mini' | 'hidden',
  miniPlayerPosition: 'bottom-right' as const,
  // Queue state
  queue: [],
  queueIndex: -1,
  nextItem: null,
  previousItem: null,
  error: null as string | null,
};

// Mock PlayerContext
jest.mock('../../context/PlayerContext', () => ({
  usePlayer: () => ({
    ...mockPlayerState,
    playMedia: mockPlayMedia,
    retryPlayback: mockRetryPlayback,
    play: jest.fn(),
    pause: jest.fn(),
    togglePlay: mockTogglePlay,
    seek: mockSeek,
    seekCommit: mockSeekCommit,
    setVolume: mockSetVolume,
    toggleMute: mockToggleMute,
    setAudioTrack: mockSetAudioTrack,
    setSubtitleTrack: mockSetSubtitleTrack,
    setMode: jest.fn(),
    registerFullscreenContainer: mockRegisterFullscreenContainer,
    registerMouseMoveHandler: mockRegisterMouseMoveHandler,
    registerPointerDownHandler: mockRegisterPointerDownHandler,
    registerClickHandler: mockRegisterClickHandler,
    close: jest.fn(),
    setMiniPlayerPosition: jest.fn(),
    // Queue functions
    refreshQueue: jest.fn(),
    playNext: jest.fn(),
    playPrevious: jest.fn(),
    hasNextItem: jest.fn().mockReturnValue(false),
    hasPreviousItem: jest.fn().mockReturnValue(false),
  }),
  PlayerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock video media data
const mockVideoMediaContext = {
  id: 'media-123',
  name: 'Test Movie',
  duration: 7200,
  type: 'Video' as const,
  audioTracks: [
    { streamIndex: 1, language: 'eng', title: 'English', isDefault: true, channels: 2, channelLayout: 'stereo' },
    { streamIndex: 2, language: 'spa', title: 'Spanish', isDefault: false, channels: 2, channelLayout: 'stereo' },
  ],
  subtitleTracks: [
    { streamIndex: 3, language: 'eng', title: 'English', isDefault: true, isForced: false, url: 'http://localhost/api/subtitles/media-123/3' },
  ],
  trickplay: undefined,
};

// Mock audio media data
const mockAudioMediaContext = {
  id: 'audio-123',
  name: 'Test Song',
  duration: 180,
  type: 'Audio' as const,
  audioTracks: [],
  subtitleTracks: [],
};

describe('PlayPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMediaId = 'media-123';
    mockPlayerState = {
      currentMedia: null,
      isPlaying: false,
      currentTime: 0,
      duration: 7200,
      volume: 1,
      isMuted: false,
      isLoading: false,
      currentAudioTrack: 1,
      currentSubtitleTrack: null,
      mode: 'hidden',
      miniPlayerPosition: 'bottom-right',
      queue: [],
      queueIndex: -1,
      nextItem: null,
      previousItem: null,
      error: null,
    };
  });

  describe('loading state', () => {
    it('shows loading spinner while fetching media', () => {
      mockPlayerState.isLoading = true;
      mockPlayerState.currentMedia = null;

      render(<PlayPage />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('hides loading spinner after media loads', async () => {
      mockPlayerState.isLoading = false;
      mockPlayerState.currentMedia = mockVideoMediaContext;

      render(<PlayPage />);

      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
  });

  describe('error handling', () => {
    it('shows media not found message when no media and not loading', async () => {
      mockPlayerState.isLoading = false;
      mockPlayerState.currentMedia = null;

      render(<PlayPage />);

      await waitFor(() => {
        expect(screen.getByText('Media not found')).toBeInTheDocument();
      });
    });

    it('shows back button on error', async () => {
      mockPlayerState.isLoading = false;
      mockPlayerState.currentMedia = null;

      render(<PlayPage />);

      await waitFor(() => {
        expect(screen.getByTestId('ArrowBackIcon')).toBeInTheDocument();
      });
    });

    it('navigates back when back button clicked on error', async () => {
      const user = userEvent.setup();
      mockPlayerState.isLoading = false;
      mockPlayerState.currentMedia = null;

      render(<PlayPage />);

      await waitFor(() => {
        expect(screen.getByTestId('ArrowBackIcon')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('ArrowBackIcon').closest('button')!);

      expect(mockNavigate).toHaveBeenCalledWith(-1);
    });
  });

  describe('video playback', () => {
    beforeEach(() => {
      mockPlayerState.currentMedia = mockVideoMediaContext;
    });

    it('renders VideoControls for video media', async () => {
      render(<PlayPage />);

      await waitFor(() => {
        expect(screen.getByTestId('video-controls')).toBeInTheDocument();
      });
    });

    it('renders back button overlay', async () => {
      render(<PlayPage />);

      await waitFor(() => {
        expect(screen.getByTestId('video-controls')).toBeInTheDocument();
      });

      expect(screen.getByTestId('ArrowBackIcon')).toBeInTheDocument();
    });

    it('navigates back when back button clicked', async () => {
      const user = userEvent.setup();

      render(<PlayPage />);

      await waitFor(() => {
        expect(screen.getByTestId('video-controls')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('ArrowBackIcon').closest('button')!);

      expect(mockNavigate).toHaveBeenCalledWith(-1);
    });

    it('calls playMedia when mediaId changes', () => {
      mockPlayerState.currentMedia = null;

      render(<PlayPage />);

      expect(mockPlayMedia).toHaveBeenCalledWith('media-123');
    });

    it('registers fullscreen container on mount', () => {
      render(<PlayPage />);

      expect(mockRegisterFullscreenContainer).toHaveBeenCalled();
    });
  });

  describe('audio playback', () => {
    beforeEach(() => {
      mockPlayerState.currentMedia = mockAudioMediaContext;
    });

    it('does not render its own audio element (the shared player element is used)', async () => {
      render(<PlayPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Song')).toBeInTheDocument();
      });
      // Two elements playing the same stream would double up the audio.
      expect(document.querySelector('audio')).not.toBeInTheDocument();
    });

    it('shows media name for audio', async () => {
      render(<PlayPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Song')).toBeInTheDocument();
      });
    });

    it('registers its container so the shared player element is shown here', async () => {
      render(<PlayPage />);

      await waitFor(() => {
        expect(mockRegisterFullscreenContainer).toHaveBeenCalledWith(expect.any(HTMLElement));
      });
    });

    it('offers transport controls for audio', async () => {
      render(<PlayPage />);

      expect(await screen.findByTestId('video-controls')).toBeInTheDocument();
    });
  });

  describe('controls', () => {
    beforeEach(() => {
      mockPlayerState.currentMedia = mockVideoMediaContext;
    });

    it('calls togglePlay when play/pause button clicked', async () => {
      const user = userEvent.setup();

      render(<PlayPage />);

      await waitFor(() => {
        expect(screen.getByTestId('video-controls')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('play-pause'));

      expect(mockTogglePlay).toHaveBeenCalled();
    });

    it('brings the controls back on the first tap rather than pausing', async () => {
      jest.useFakeTimers();
      mockPlayerState.isPlaying = true;
      render(<PlayPage />);
      await act(async () => {
        // The page hides its controls a few seconds in.
        jest.advanceTimersByTime(3500);
      });

      const pointerDown = mockRegisterPointerDownHandler.mock.calls
        .map(([handler]) => handler)
        .filter(Boolean)
        .pop() as (e: { pointerType: string }) => void;
      const click = mockRegisterClickHandler.mock.calls
        .map(([handler]) => handler)
        .filter(Boolean)
        .pop() as () => void;

      act(() => {
        pointerDown({ pointerType: 'touch' });
        click();
      });
      expect(mockTogglePlay).not.toHaveBeenCalled();

      act(() => {
        pointerDown({ pointerType: 'touch' });
        click();
      });
      expect(mockTogglePlay).toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('toggles on the first click from a mouse', async () => {
      jest.useFakeTimers();
      mockPlayerState.isPlaying = true;
      render(<PlayPage />);
      await act(async () => {
        jest.advanceTimersByTime(3500);
      });

      const click = mockRegisterClickHandler.mock.calls
        .map(([handler]) => handler)
        .filter(Boolean)
        .pop() as () => void;
      act(() => {
        click();
      });

      expect(mockTogglePlay).toHaveBeenCalled();
      jest.useRealTimers();
    });
  });

  describe('no mediaId', () => {
    it('does not call playMedia when mediaId is undefined', () => {
      mockMediaId = undefined;

      render(<PlayPage />);

      expect(mockPlayMedia).not.toHaveBeenCalled();
    });
  });

  describe('keyboard shortcuts', () => {
    beforeEach(() => {
      mockPlayerState.currentMedia = mockVideoMediaContext;
      mockPlayerState.currentTime = 100;
      mockPlayerState.duration = 7200;
      mockPlayerState.volume = 0.5;
    });

    const press = (key: string, init: KeyboardEventInit = {}) => {
      fireEvent.keyDown(document, { key, ...init });
    };

    it('toggles playback with space and k', async () => {
      render(<PlayPage />);
      await waitFor(() => expect(screen.getByTestId('video-controls')).toBeInTheDocument());

      press(' ');
      press('k');
      expect(mockTogglePlay).toHaveBeenCalledTimes(2);
    });

    it('seeks with the arrows and j/l, further with shift', async () => {
      render(<PlayPage />);
      await waitFor(() => expect(screen.getByTestId('video-controls')).toBeInTheDocument());

      press('ArrowRight');
      expect(mockSeekCommit).toHaveBeenLastCalledWith(110);
      press('ArrowLeft');
      expect(mockSeekCommit).toHaveBeenLastCalledWith(90);
      press('l', { shiftKey: true });
      expect(mockSeekCommit).toHaveBeenLastCalledWith(130);
    });

    it('does not seek past the start or the end', async () => {
      mockPlayerState.currentTime = 5;
      mockPlayerState.duration = 20;
      render(<PlayPage />);
      await waitFor(() => expect(screen.getByTestId('video-controls')).toBeInTheDocument());

      press('ArrowLeft');
      expect(mockSeekCommit).toHaveBeenLastCalledWith(0);
      press('ArrowRight');
      expect(mockSeekCommit).toHaveBeenLastCalledWith(15);
    });

    it('changes volume and mutes', async () => {
      render(<PlayPage />);
      await waitFor(() => expect(screen.getByTestId('video-controls')).toBeInTheDocument());

      press('ArrowUp');
      expect(mockSetVolume).toHaveBeenLastCalledWith(0.55);
      press('ArrowDown');
      expect(mockSetVolume).toHaveBeenLastCalledWith(0.45);
      press('m');
      expect(mockToggleMute).toHaveBeenCalled();
    });

    it('ignores keys typed into a text field', async () => {
      render(<PlayPage />);
      await waitFor(() => expect(screen.getByTestId('video-controls')).toBeInTheDocument());

      const input = document.createElement('input');
      document.body.appendChild(input);
      fireEvent.keyDown(input, { key: ' ' });
      expect(mockTogglePlay).not.toHaveBeenCalled();
      input.remove();
    });
  });

  describe('playback errors', () => {
    beforeEach(() => {
      mockPlayerState.currentMedia = mockVideoMediaContext;
    });
    afterEach(() => {
      mockPlayerState.error = null;
    });

    it('shows nothing while playback is healthy', async () => {
      render(<PlayPage />);
      await waitFor(() => expect(screen.getByTestId('video-controls')).toBeInTheDocument());
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('surfaces a failure with a retry action', async () => {
      const user = userEvent.setup();
      mockPlayerState.error = 'playback.errorNetwork';
      render(<PlayPage />);

      expect(await screen.findByRole('alert')).toHaveTextContent(/connection to the server was lost/i);
      await user.click(screen.getByRole('button', { name: /try again/i }));
      expect(mockRetryPlayback).toHaveBeenCalled();
    });
  });
});
