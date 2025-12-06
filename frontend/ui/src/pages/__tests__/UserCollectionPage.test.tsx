import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { UserCollectionPage } from '../UserCollectionPage';
import { apiClient } from '../../api/client';
import type { UserCollection, UserCollectionItem, Image } from '../../api/client';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    getUserCollection: jest.fn(),
    updateUserCollection: jest.fn(),
    removeUserCollectionItem: jest.fn(),
    checkFavorites: jest.fn(),
    toggleFavorite: jest.fn(),
    getImageUrl: jest.fn((id) => `http://localhost/api/images/${id}`),
  },
}));

// Mock useParams and useNavigate
let mockCollectionId = 'col-1';
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ collectionId: mockCollectionId }),
  useNavigate: () => mockNavigate,
}));

// Mock useAuth
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', name: 'Test User', role: 'Admin' } }),
}));

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

// Helper to create minimal Image mock
const createMockImage = (id: string, imageType: string): Image =>
  ({ id, imageType, isPrimary: true } as unknown as Image);

// Mock data
const mockCollectionItem: UserCollectionItem = {
  id: 'item-1',
  position: 0,
  userCollectionId: 'col-1',
  collectionId: 'lib-col-1',
  mediaId: null,
  itemUserCollectionId: null,
  addedAt: '2024-01-15T00:00:00Z',
  collection: {
    id: 'lib-col-1',
    name: 'The Matrix',
    collectionType: 'Film',
    images: [createMockImage('img-1', 'Poster')],
  },
  media: null,
  itemUserCollection: null,
};

const mockMediaItem: UserCollectionItem = {
  id: 'item-2',
  position: 1,
  userCollectionId: 'col-1',
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
    collection: { id: 'lib-col-2', name: 'Breaking Bad' },
  },
  itemUserCollection: null,
};

const mockUserCollection: UserCollection = {
  id: 'col-1',
  name: 'My Playlist',
  description: 'A collection of my favorite media',
  isPublic: false,
  isSystem: false,
  systemType: null,
  userId: 'user-1',
  createdAt: '',
  updatedAt: '',
  items: [mockCollectionItem, mockMediaItem],
  _count: { items: 2 },
};

describe('UserCollectionPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCollectionId = 'col-1';
    mockApiClient.getUserCollection.mockResolvedValue({
      data: { userCollection: mockUserCollection },
    });
    mockApiClient.checkFavorites.mockResolvedValue({
      data: { collectionIds: [], mediaIds: [], userCollectionIds: [] },
    });
    mockApiClient.toggleFavorite.mockResolvedValue({ data: { favorited: true } });
    mockApiClient.updateUserCollection.mockResolvedValue({
      data: { userCollection: { ...mockUserCollection, name: 'Updated Name' } },
    });
    mockApiClient.removeUserCollectionItem.mockResolvedValue({ data: undefined });
  });

  describe('loading state', () => {
    it('shows loading spinner while fetching', () => {
      mockApiClient.getUserCollection.mockImplementation(() => new Promise(() => {}));

      render(<UserCollectionPage />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('hides loading spinner after data loads', async () => {
      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows error message when fetch fails', async () => {
      mockApiClient.getUserCollection.mockResolvedValue({ error: 'Failed to fetch collection' });

      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByText('Failed to fetch collection')).toBeInTheDocument();
      });
    });

    it('shows not found when collection is null', async () => {
      mockApiClient.getUserCollection.mockResolvedValue({
        data: { userCollection: null as unknown as UserCollection },
      });

      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });
  });

  describe('rendering', () => {
    it('shows collection name', async () => {
      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'My Playlist' })).toBeInTheDocument();
      });
    });

    it('shows collection description', async () => {
      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByText('A collection of my favorite media')).toBeInTheDocument();
      });
    });

    it('shows public/private status', async () => {
      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByText(/private/i)).toBeInTheDocument();
      });
    });

    it('shows item count', async () => {
      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByText(/2 items/i)).toBeInTheDocument();
      });
    });

    it('shows breadcrumb navigation', async () => {
      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('navigation')).toBeInTheDocument();
      });
    });

    it('shows items with names', async () => {
      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByText('The Matrix')).toBeInTheDocument();
        expect(screen.getByText('Pilot')).toBeInTheDocument();
      });
    });

    it('shows episode info for video items', async () => {
      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByText(/Breaking Bad.*S1E1/)).toBeInTheDocument();
      });
    });

    it('shows images for items with images', async () => {
      render(<UserCollectionPage />);

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

      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByText('The Matrix')).toBeInTheDocument();
      });

      await user.click(screen.getByText('The Matrix'));

      expect(mockNavigate).toHaveBeenCalledWith('/collection/lib-col-1');
    });

    it('navigates to media when media item clicked', async () => {
      const user = userEvent.setup();

      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByText('Pilot')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Pilot'));

      expect(mockNavigate).toHaveBeenCalledWith('/media/media-1');
    });

    it('navigates to collections list when breadcrumb clicked', async () => {
      const user = userEvent.setup();

      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('navigation')).toBeInTheDocument();
      });

      const backLink = screen.getByRole('button', { name: /collections/i });
      await user.click(backLink);

      expect(mockNavigate).toHaveBeenCalledWith('/my-collections');
    });
  });

  describe('editing collection', () => {
    it('shows edit button for owner', async () => {
      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
      });
    });

    it('enters edit mode when edit button clicked', async () => {
      const user = userEvent.setup();

      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /edit/i }));

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
      });
    });

    it('saves changes when save button clicked', async () => {
      const user = userEvent.setup();

      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /edit/i }));

      const nameInput = screen.getByLabelText(/name/i);
      await user.clear(nameInput);
      await user.type(nameInput, 'Updated Name');

      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(mockApiClient.updateUserCollection).toHaveBeenCalledWith('col-1', {
        name: 'Updated Name',
        description: 'A collection of my favorite media',
        isPublic: false,
      });
    });

    it('cancels edit mode when cancel button clicked', async () => {
      const user = userEvent.setup();

      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /edit/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByLabelText(/name/i)).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'My Playlist' })).toBeInTheDocument();
      });
    });
  });

  describe('removing items', () => {
    it('shows remove button for owner', async () => {
      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByText('The Matrix')).toBeInTheDocument();
      });

      // Should have delete buttons
      const deleteButtons = screen.getAllByRole('button').filter(
        btn => btn.querySelector('svg[data-testid="DeleteIcon"]') !== null
      );
      expect(deleteButtons.length).toBeGreaterThan(0);
    });

    it('shows confirmation dialog when remove clicked', async () => {
      const user = userEvent.setup();

      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByText('The Matrix')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByRole('button').filter(
        btn => btn.querySelector('svg[data-testid="DeleteIcon"]') !== null
      );
      await user.click(deleteButtons[0]);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    });

    it('removes item when confirmed', async () => {
      const user = userEvent.setup();

      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByText('The Matrix')).toBeInTheDocument();
      });

      // Items are sorted by date descending, so The Matrix (oldest) is last
      const deleteButtons = screen.getAllByRole('button').filter(
        btn => btn.querySelector('svg[data-testid="DeleteIcon"]') !== null
      );
      await user.click(deleteButtons[deleteButtons.length - 1]);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const confirmButton = screen.getByRole('button', { name: /delete/i });
      await user.click(confirmButton);

      expect(mockApiClient.removeUserCollectionItem).toHaveBeenCalledWith('col-1', 'item-1');
    });
  });

  describe('sorting', () => {
    it('shows sort controls when items exist', async () => {
      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('combobox')).toBeInTheDocument();
      });
    });
  });

  describe('type filtering', () => {
    it('shows filter chips when multiple types exist', async () => {
      render(<UserCollectionPage />);

      await waitFor(() => {
        // Should show Film and Episode type chips
        expect(screen.getByText('Film')).toBeInTheDocument();
        expect(screen.getByText('Episode')).toBeInTheDocument();
      });
    });

    it('filters items when type chip clicked', async () => {
      const user = userEvent.setup();

      render(<UserCollectionPage />);

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

  describe('favoriting', () => {
    it('shows favorite button', async () => {
      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /favorites/i })).toBeInTheDocument();
      });
    });

    it('toggles favorite when button clicked', async () => {
      const user = userEvent.setup();

      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /favorites/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /favorites/i }));

      expect(mockApiClient.toggleFavorite).toHaveBeenCalledWith({ userCollectionId: 'col-1' });
    });
  });

  describe('empty state', () => {
    it('shows empty message when no items', async () => {
      mockApiClient.getUserCollection.mockResolvedValue({
        data: { userCollection: { ...mockUserCollection, items: [] } },
      });

      render(<UserCollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });
  });
});
