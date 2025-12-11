import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { FavoritesPage } from '../FavoritesPage';
import { apiClient } from '../../api/client';
import type { UserCollection, UserCollectionItem, Image } from '../../api/client';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    getFavorites: jest.fn(),
    toggleFavorite: jest.fn(),
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
  userCollectionId: 'fav-collection',
  collectionId: 'col-1',
  mediaId: null,
  itemUserCollectionId: null,
  addedAt: '2024-01-15T00:00:00Z',
  collection: {
    id: 'col-1',
    name: 'The Matrix',
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
  userCollectionId: 'fav-collection',
  collectionId: null,
  mediaId: 'media-1',
  itemUserCollectionId: null,
  addedAt: '2024-01-16T00:00:00Z',
  collection: null,
  media: {
    id: 'media-1',
    name: 'Pilot',
    type: 'Video',
    duration: 3600,
    images: [],
    videoDetails: { season: 1, episode: 1 },
    collection: { id: 'col-2', name: 'Breaking Bad' },
  },
  itemUserCollection: null,
};

const mockUserCollectionItem: UserCollectionItem = {
  id: 'item-3',
  position: 2,
  userCollectionId: 'fav-collection',
  collectionId: null,
  mediaId: null,
  itemUserCollectionId: 'user-col-1',
  addedAt: '2024-01-17T00:00:00Z',
  collection: null,
  media: null,
  itemUserCollection: {
    id: 'user-col-1',
    name: 'My Watchlist',
    description: null,
    isPublic: false,
    _count: { items: 5 },
  },
};

const mockFavorites: UserCollection = {
  id: 'fav-collection',
  name: 'Favorites',
  description: null,
  collectionType: 'Set',
  isPublic: false,
  isSystem: true,
  systemType: 'Favorites',
  userId: 'user-1',
  createdAt: '',
  updatedAt: '',
  items: [mockCollectionItem, mockMediaItem, mockUserCollectionItem],
  _count: { items: 3 },
};

describe('FavoritesPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiClient.getFavorites.mockResolvedValue({ data: { userCollection: mockFavorites } });
    mockApiClient.toggleFavorite.mockResolvedValue({ data: { favorited: false } });
  });

  describe('loading state', () => {
    it('shows loading spinner while fetching', () => {
      mockApiClient.getFavorites.mockImplementation(() => new Promise(() => {}));

      render(<FavoritesPage />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('hides loading spinner after data loads', async () => {
      render(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows error message when fetch fails', async () => {
      mockApiClient.getFavorites.mockResolvedValue({ error: 'Failed to fetch favorites' });

      render(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('Failed to fetch favorites')).toBeInTheDocument();
      });
    });
  });

  describe('empty state', () => {
    it('shows empty message when no favorites', async () => {
      mockApiClient.getFavorites.mockResolvedValue({
        data: { userCollection: { ...mockFavorites, items: [] } },
      });

      render(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });
  });

  describe('rendering', () => {
    it('shows page title', async () => {
      render(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /favorites/i })).toBeInTheDocument();
      });
    });

    it('shows item count', async () => {
      render(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('(3)')).toBeInTheDocument();
      });
    });

    it('shows collection items', async () => {
      render(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('The Matrix')).toBeInTheDocument();
      });
    });

    it('shows media items with episode info', async () => {
      render(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('Pilot')).toBeInTheDocument();
        expect(screen.getByText('S1E1')).toBeInTheDocument();
      });
    });

    it('shows user collection items', async () => {
      render(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('My Watchlist')).toBeInTheDocument();
      });
    });

    it('shows images for items with images', async () => {
      render(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByAltText('The Matrix')).toHaveAttribute(
          'src',
          'http://localhost/api/images/img-1'
        );
      });
    });
  });

  describe('navigation', () => {
    it('navigates to collection when collection item clicked', async () => {
      const user = userEvent.setup();

      render(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('The Matrix')).toBeInTheDocument();
      });

      await user.click(screen.getByText('The Matrix'));

      expect(mockNavigate).toHaveBeenCalledWith('/collection/col-1');
    });

    it('navigates to media when media item clicked', async () => {
      const user = userEvent.setup();

      render(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('Pilot')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Pilot'));

      expect(mockNavigate).toHaveBeenCalledWith('/media/media-1');
    });

    it('navigates to user collection when user collection item clicked', async () => {
      const user = userEvent.setup();

      render(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('My Watchlist')).toBeInTheDocument();
      });

      await user.click(screen.getByText('My Watchlist'));

      expect(mockNavigate).toHaveBeenCalledWith('/my-collections/user-col-1');
    });
  });

  describe('removing favorites', () => {
    it('removes item from favorites when remove button clicked', async () => {
      const user = userEvent.setup();

      render(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('The Matrix')).toBeInTheDocument();
      });

      // Find all remove buttons - items are sorted by date descending
      // So The Matrix (oldest, Jan 15) is last
      const removeButtons = screen.getAllByRole('button', { name: /remove from favorites/i });
      // Click the last button to remove The Matrix (the collection item)
      await user.click(removeButtons[removeButtons.length - 1]);

      expect(mockApiClient.toggleFavorite).toHaveBeenCalledWith({ collectionId: 'col-1' });
    });

    it('updates UI after removing item', async () => {
      const user = userEvent.setup();

      render(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('The Matrix')).toBeInTheDocument();
      });

      const removeButtons = screen.getAllByRole('button', { name: /remove from favorites/i });
      // Click the last button to remove The Matrix (oldest item due to date sorting)
      await user.click(removeButtons[removeButtons.length - 1]);

      await waitFor(() => {
        expect(screen.queryByText('The Matrix')).not.toBeInTheDocument();
      });
    });
  });

  describe('sorting', () => {
    it('shows sort controls when items exist', async () => {
      render(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByRole('combobox')).toBeInTheDocument();
      });
    });

    it('hides sort controls when no items', async () => {
      mockApiClient.getFavorites.mockResolvedValue({
        data: { userCollection: { ...mockFavorites, items: [] } },
      });

      render(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      });
    });
  });

  describe('type filtering', () => {
    it('shows filter chips when multiple types exist', async () => {
      render(<FavoritesPage />);

      await waitFor(() => {
        // Should show Film and Episode type chips (from the mock data)
        expect(screen.getByText('Film')).toBeInTheDocument();
        expect(screen.getByText('Episode')).toBeInTheDocument();
      });
    });

    it('filters items when type chip clicked', async () => {
      const user = userEvent.setup();

      render(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('The Matrix')).toBeInTheDocument();
        expect(screen.getByText('Pilot')).toBeInTheDocument();
      });

      // Click to exclude Film type
      await user.click(screen.getByText('Film'));

      await waitFor(() => {
        expect(screen.queryByText('The Matrix')).not.toBeInTheDocument();
        expect(screen.getByText('Pilot')).toBeInTheDocument();
      });
    });
  });
});
