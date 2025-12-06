import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { WatchLaterPage } from '../WatchLaterPage';
import { apiClient } from '../../api/client';
import type { UserCollection, UserCollectionItem, Image } from '../../api/client';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    getWatchLater: jest.fn(),
    toggleWatchLater: jest.fn(),
    getImageUrl: jest.fn((id) => `http://localhost/api/images/${id}`),
  },
}));

// Mock useNavigate
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

// Helper to create minimal Image mock
const createMockImage = (id: string, imageType: string): Image =>
  ({ id, imageType, isPrimary: true } as unknown as Image);

// Mock data
const mockCollectionItem: UserCollectionItem = {
  id: 'item-1',
  position: 0,
  userCollectionId: 'watch-later-collection',
  collectionId: 'col-1',
  mediaId: null,
  itemUserCollectionId: null,
  addedAt: '2024-01-15T00:00:00Z',
  collection: {
    id: 'col-1',
    name: 'Inception',
    collectionType: 'Film',
    images: [createMockImage('img-1', 'Poster')],
    library: { id: 'lib-1', name: 'Movies', libraryType: 'Film' },
  },
  media: null,
  itemUserCollection: null,
};

const mockMediaItem: UserCollectionItem = {
  id: 'item-2',
  position: 1,
  userCollectionId: 'watch-later-collection',
  collectionId: null,
  mediaId: 'media-1',
  itemUserCollectionId: null,
  addedAt: '2024-01-16T00:00:00Z',
  collection: null,
  media: {
    id: 'media-1',
    name: 'The One Where It All Began',
    type: 'Video',
    duration: 1800,
    images: [],
    videoDetails: { season: 1, episode: 1 },
    collection: { id: 'col-2', name: 'Friends' },
  },
  itemUserCollection: null,
};

const mockAudioItem: UserCollectionItem = {
  id: 'item-3',
  position: 2,
  userCollectionId: 'watch-later-collection',
  collectionId: null,
  mediaId: 'media-2',
  itemUserCollectionId: null,
  addedAt: '2024-01-17T00:00:00Z',
  collection: null,
  media: {
    id: 'media-2',
    name: 'Bohemian Rhapsody',
    type: 'Audio',
    duration: 354,
    images: [],
    audioDetails: { track: 1, disc: 1 },
    collection: { id: 'col-3', name: 'A Night at the Opera' },
  },
  itemUserCollection: null,
};

const mockWatchLater: UserCollection = {
  id: 'watch-later-collection',
  name: 'Watch Later',
  description: null,
  isPublic: false,
  isSystem: true,
  systemType: 'WatchLater',
  userId: 'user-1',
  createdAt: '',
  updatedAt: '',
  items: [mockCollectionItem, mockMediaItem, mockAudioItem],
  _count: { items: 3 },
};

describe('WatchLaterPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiClient.getWatchLater.mockResolvedValue({ data: { userCollection: mockWatchLater } });
    mockApiClient.toggleWatchLater.mockResolvedValue({ data: { inWatchLater: false } });
  });

  describe('loading state', () => {
    it('shows loading spinner while fetching', () => {
      mockApiClient.getWatchLater.mockImplementation(() => new Promise(() => {}));

      render(<WatchLaterPage />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('hides loading spinner after data loads', async () => {
      render(<WatchLaterPage />);

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows error message when fetch fails', async () => {
      mockApiClient.getWatchLater.mockResolvedValue({ error: 'Failed to fetch watch later' });

      render(<WatchLaterPage />);

      await waitFor(() => {
        expect(screen.getByText('Failed to fetch watch later')).toBeInTheDocument();
      });
    });
  });

  describe('empty state', () => {
    it('shows empty message when no items', async () => {
      mockApiClient.getWatchLater.mockResolvedValue({
        data: { userCollection: { ...mockWatchLater, items: [] } },
      });

      render(<WatchLaterPage />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });
  });

  describe('rendering', () => {
    it('shows page title', async () => {
      render(<WatchLaterPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /watch later/i })).toBeInTheDocument();
      });
    });

    it('shows item count', async () => {
      render(<WatchLaterPage />);

      await waitFor(() => {
        expect(screen.getByText('(3)')).toBeInTheDocument();
      });
    });

    it('shows collection items', async () => {
      render(<WatchLaterPage />);

      await waitFor(() => {
        expect(screen.getByText('Inception')).toBeInTheDocument();
      });
    });

    it('shows video items with episode info', async () => {
      render(<WatchLaterPage />);

      await waitFor(() => {
        expect(screen.getByText('The One Where It All Began')).toBeInTheDocument();
        expect(screen.getByText('S1E1')).toBeInTheDocument();
      });
    });

    it('shows audio items with track info', async () => {
      render(<WatchLaterPage />);

      await waitFor(() => {
        expect(screen.getByText('Bohemian Rhapsody')).toBeInTheDocument();
        expect(screen.getByText('Disc 1, Track 1')).toBeInTheDocument();
      });
    });

    it('shows images for items with images', async () => {
      render(<WatchLaterPage />);

      await waitFor(() => {
        expect(screen.getByAltText('Inception')).toHaveAttribute(
          'src',
          'http://localhost/api/images/img-1'
        );
      });
    });
  });

  describe('navigation', () => {
    it('navigates to collection when collection item clicked', async () => {
      const user = userEvent.setup();

      render(<WatchLaterPage />);

      await waitFor(() => {
        expect(screen.getByText('Inception')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Inception'));

      expect(mockNavigate).toHaveBeenCalledWith('/collection/col-1');
    });

    it('navigates to media when media item clicked', async () => {
      const user = userEvent.setup();

      render(<WatchLaterPage />);

      await waitFor(() => {
        expect(screen.getByText('The One Where It All Began')).toBeInTheDocument();
      });

      await user.click(screen.getByText('The One Where It All Began'));

      expect(mockNavigate).toHaveBeenCalledWith('/media/media-1');
    });
  });

  describe('removing from watch later', () => {
    it('removes item when remove button clicked', async () => {
      const user = userEvent.setup();

      render(<WatchLaterPage />);

      await waitFor(() => {
        expect(screen.getByText('Inception')).toBeInTheDocument();
      });

      // Find all remove buttons - items are sorted by date descending
      // So Inception (oldest, Jan 15) is last, audio item (Jan 17) is first
      const removeButtons = screen.getAllByRole('button', { name: /remove from watch later/i });
      // Click the last button to remove Inception (the collection item)
      await user.click(removeButtons[removeButtons.length - 1]);

      expect(mockApiClient.toggleWatchLater).toHaveBeenCalledWith({ collectionId: 'col-1' });
    });

    it('updates UI after removing item', async () => {
      const user = userEvent.setup();

      render(<WatchLaterPage />);

      await waitFor(() => {
        expect(screen.getByText('Inception')).toBeInTheDocument();
      });

      const removeButtons = screen.getAllByRole('button', { name: /remove from watch later/i });
      // Click the last button to remove Inception (oldest item due to date sorting)
      await user.click(removeButtons[removeButtons.length - 1]);

      await waitFor(() => {
        expect(screen.queryByText('Inception')).not.toBeInTheDocument();
      });
    });
  });

  describe('sorting', () => {
    it('shows sort controls when items exist', async () => {
      render(<WatchLaterPage />);

      await waitFor(() => {
        expect(screen.getByRole('combobox')).toBeInTheDocument();
      });
    });

    it('hides sort controls when no items', async () => {
      mockApiClient.getWatchLater.mockResolvedValue({
        data: { userCollection: { ...mockWatchLater, items: [] } },
      });

      render(<WatchLaterPage />);

      await waitFor(() => {
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      });
    });
  });

  describe('type filtering', () => {
    it('shows filter chips when multiple types exist', async () => {
      render(<WatchLaterPage />);

      await waitFor(() => {
        // Should show Film, Episode, and Track type chips
        expect(screen.getByText('Film')).toBeInTheDocument();
        expect(screen.getByText('Episode')).toBeInTheDocument();
        expect(screen.getByText('Track')).toBeInTheDocument();
      });
    });

    it('filters items when type chip clicked', async () => {
      const user = userEvent.setup();

      render(<WatchLaterPage />);

      await waitFor(() => {
        expect(screen.getByText('Inception')).toBeInTheDocument();
      });

      // Click to exclude Film type
      await user.click(screen.getByText('Film'));

      await waitFor(() => {
        expect(screen.queryByText('Inception')).not.toBeInTheDocument();
        expect(screen.getByText('The One Where It All Began')).toBeInTheDocument();
        expect(screen.getByText('Bohemian Rhapsody')).toBeInTheDocument();
      });
    });
  });
});
