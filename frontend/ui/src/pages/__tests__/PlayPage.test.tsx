import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { PlayPage } from '../PlayPage';
import { apiClient } from '../../api/client';
import type { Media } from '../../api/client';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    getMedia: jest.fn(),
    getVideoStreamUrl: jest.fn((id, start, audio) => `http://localhost/api/stream/${id}?start=${start || 0}&audio=${audio || 0}`),
    getAudioStreamUrl: jest.fn((id) => `http://localhost/api/audio/${id}`),
    getSubtitleUrl: jest.fn((id, idx) => `http://localhost/api/subtitles/${id}/${idx}`),
    getImageUrl: jest.fn((id) => `http://localhost/api/images/${id}`),
  },
}));

// Mock VideoPlayer component
jest.mock('../../components/VideoPlayer', () => ({
  VideoPlayer: jest.fn(({ title, src, onAudioTrackChange, onSubtitleTrackChange }) => (
    <div data-testid="video-player" data-title={title} data-src={src}>
      <button onClick={() => onAudioTrackChange?.(1)} data-testid="change-audio">Change Audio</button>
      <button onClick={() => onSubtitleTrackChange?.(2)} data-testid="change-subtitle">Change Subtitle</button>
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
const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

// Mock video media data
const mockVideoMedia: Media = {
  id: 'media-123',
  name: 'Test Movie',
  path: '/media/movie.mp4',
  duration: 7200,
  type: 'Video',
  thumbnails: null,
  collectionId: 'col-1',
  collection: {
    id: 'col-1',
    name: 'Test Collection',
    collectionType: 'Film',
    images: [
      {
        id: 'img-1',
        mediaId: null,
        collectionId: 'col-1',
        personId: null,
        showCreditId: null,
        creditId: null,
        imageType: 'Backdrop',
        path: '/images/backdrop.jpg',
        width: 1920,
        height: 1080,
        format: 'jpeg',
        fileSize: null,
        sourceUrl: null,
        scraperId: null,
        isPrimary: true,
        createdAt: '',
        updatedAt: '',
      },
    ],
  },
  videoDetails: null,
  audioDetails: null,
  streams: [
    {
      id: 'stream-1',
      mediaId: 'media-123',
      streamIndex: 0,
      streamType: 'Video',
      codec: 'h264',
      codecLong: null,
      language: null,
      title: null,
      isDefault: true,
      isForced: false,
      channels: null,
      channelLayout: null,
      sampleRate: null,
      bitRate: null,
      width: 1920,
      height: 1080,
      frameRate: 24,
    },
    {
      id: 'stream-2',
      mediaId: 'media-123',
      streamIndex: 1,
      streamType: 'Audio',
      codec: 'aac',
      codecLong: null,
      language: 'eng',
      title: 'English',
      isDefault: true,
      isForced: false,
      channels: 2,
      channelLayout: 'stereo',
      sampleRate: 48000,
      bitRate: 128000,
      width: null,
      height: null,
      frameRate: null,
    },
    {
      id: 'stream-3',
      mediaId: 'media-123',
      streamIndex: 2,
      streamType: 'Audio',
      codec: 'aac',
      codecLong: null,
      language: 'spa',
      title: 'Spanish',
      isDefault: false,
      isForced: false,
      channels: 2,
      channelLayout: 'stereo',
      sampleRate: 48000,
      bitRate: 128000,
      width: null,
      height: null,
      frameRate: null,
    },
    {
      id: 'stream-4',
      mediaId: 'media-123',
      streamIndex: 3,
      streamType: 'Subtitle',
      codec: 'srt',
      codecLong: null,
      language: 'eng',
      title: 'English',
      isDefault: true,
      isForced: false,
      channels: null,
      channelLayout: null,
      sampleRate: null,
      bitRate: null,
      width: null,
      height: null,
      frameRate: null,
    },
  ],
  images: [],
  createdAt: '',
  updatedAt: '',
};

// Mock audio media data
const mockAudioMedia: Media = {
  ...mockVideoMedia,
  id: 'audio-123',
  name: 'Test Song',
  type: 'Audio',
  streams: [],
};

describe('PlayPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMediaId = 'media-123';
  });

  describe('loading state', () => {
    it('shows loading spinner while fetching media', () => {
      mockApiClient.getMedia.mockImplementation(() => new Promise(() => {}));

      render(<PlayPage />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('hides loading spinner after media loads', async () => {
      mockApiClient.getMedia.mockResolvedValue({ data: { media: mockVideoMedia } });

      render(<PlayPage />);

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows error message when fetch fails', async () => {
      mockApiClient.getMedia.mockResolvedValue({ error: 'Failed to load media' });

      render(<PlayPage />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load media')).toBeInTheDocument();
      });
    });

    it('shows back button on error', async () => {
      mockApiClient.getMedia.mockResolvedValue({ error: 'Failed to load media' });

      render(<PlayPage />);

      await waitFor(() => {
        expect(screen.getByTestId('ArrowBackIcon')).toBeInTheDocument();
      });
    });

    it('navigates back when back button clicked on error', async () => {
      const user = userEvent.setup();
      mockApiClient.getMedia.mockResolvedValue({ error: 'Failed to load media' });

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
      mockApiClient.getMedia.mockResolvedValue({ data: { media: mockVideoMedia } });
    });

    it('renders VideoPlayer for video media', async () => {
      render(<PlayPage />);

      await waitFor(() => {
        expect(screen.getByTestId('video-player')).toBeInTheDocument();
      });
    });

    it('passes correct title to VideoPlayer', async () => {
      render(<PlayPage />);

      await waitFor(() => {
        expect(screen.getByTestId('video-player')).toHaveAttribute('data-title', 'Test Movie');
      });
    });

    it('renders back button overlay', async () => {
      render(<PlayPage />);

      await waitFor(() => {
        expect(screen.getByTestId('video-player')).toBeInTheDocument();
      });

      expect(screen.getByTestId('ArrowBackIcon')).toBeInTheDocument();
    });

    it('navigates back when back button clicked', async () => {
      const user = userEvent.setup();

      render(<PlayPage />);

      await waitFor(() => {
        expect(screen.getByTestId('video-player')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('ArrowBackIcon').closest('button')!);

      expect(mockNavigate).toHaveBeenCalledWith(-1);
    });
  });

  describe('audio playback', () => {
    beforeEach(() => {
      mockApiClient.getMedia.mockResolvedValue({ data: { media: mockAudioMedia } });
    });

    it('renders audio element for audio media', async () => {
      render(<PlayPage />);

      await waitFor(() => {
        expect(document.querySelector('audio')).toBeInTheDocument();
      });
    });

    it('shows media name for audio', async () => {
      render(<PlayPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Song')).toBeInTheDocument();
      });
    });

    it('sets correct audio source', async () => {
      render(<PlayPage />);

      await waitFor(() => {
        const audio = document.querySelector('audio');
        expect(audio).toHaveAttribute('src', 'http://localhost/api/audio/audio-123');
      });
    });
  });

  describe('track handling', () => {
    beforeEach(() => {
      mockApiClient.getMedia.mockResolvedValue({ data: { media: mockVideoMedia } });
    });

    it('handles audio track change', async () => {
      const user = userEvent.setup();

      render(<PlayPage />);

      await waitFor(() => {
        expect(screen.getByTestId('video-player')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('change-audio'));

      // The component should handle this without error
      expect(screen.getByTestId('video-player')).toBeInTheDocument();
    });

    it('handles subtitle track change', async () => {
      const user = userEvent.setup();

      render(<PlayPage />);

      await waitFor(() => {
        expect(screen.getByTestId('video-player')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('change-subtitle'));

      // The component should handle this without error
      expect(screen.getByTestId('video-player')).toBeInTheDocument();
    });
  });

  describe('no mediaId', () => {
    it('does not fetch when mediaId is undefined', () => {
      mockMediaId = undefined;

      render(<PlayPage />);

      expect(mockApiClient.getMedia).not.toHaveBeenCalled();
    });
  });
});
