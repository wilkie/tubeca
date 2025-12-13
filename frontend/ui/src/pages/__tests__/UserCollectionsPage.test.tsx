import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { UserCollectionsPage } from '../UserCollectionsPage';
import { apiClient } from '../../api/client';
import type { UserCollection } from '../../api/client';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    getUserCollections: jest.fn(),
    getPublicCollections: jest.fn(),
    createUserCollection: jest.fn(),
    deleteUserCollection: jest.fn(),
    checkFavorites: jest.fn(),
    toggleFavorite: jest.fn(),
  },
}));

// Mock CreateCollectionDialog
jest.mock('../../components/CreateCollectionDialog', () => ({
  CreateCollectionDialog: jest.fn(({ open, onClose, onCreate }) =>
    open ? (
      <div data-testid="create-dialog">
        <button onClick={() => onCreate('New Collection', 'Description', false, 'Set')} data-testid="create-submit">
          Create
        </button>
        <button onClick={onClose} data-testid="create-cancel">Cancel</button>
      </div>
    ) : null
  ),
}));

// Mock useNavigate
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

// Mock data
const mockMyCollections: UserCollection[] = [
  {
    id: 'col-1',
    name: 'My Favorites',
    description: 'My favorite movies',
    collectionType: 'Set',
    isPublic: false,
    isSystem: false,
    systemType: null,
    userId: 'user-1',
    createdAt: '',
    updatedAt: '',
    _count: { items: 10 },
  },
  {
    id: 'col-2',
    name: 'Shared Playlist',
    description: 'Movies to share',
    collectionType: 'Set',
    isPublic: true,
    isSystem: false,
    systemType: null,
    userId: 'user-1',
    createdAt: '',
    updatedAt: '',
    _count: { items: 5 },
  },
];

const mockPublicCollections: UserCollection[] = [
  {
    id: 'col-3',
    name: 'Best Sci-Fi',
    description: 'Top sci-fi films',
    collectionType: 'Set',
    isPublic: true,
    isSystem: false,
    systemType: null,
    userId: 'user-2',
    createdAt: '',
    updatedAt: '',
    _count: { items: 20 },
    user: { id: 'user-2', name: 'John Doe' },
  },
];

describe('UserCollectionsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiClient.getUserCollections.mockResolvedValue({
      data: { userCollections: mockMyCollections },
    });
    mockApiClient.getPublicCollections.mockResolvedValue({
      data: { userCollections: mockPublicCollections },
    });
    mockApiClient.checkFavorites.mockResolvedValue({
      data: { collectionIds: [], mediaIds: [], userCollectionIds: [] },
    });
    mockApiClient.toggleFavorite.mockResolvedValue({ data: { favorited: true } });
    mockApiClient.deleteUserCollection.mockResolvedValue({ data: undefined });
    mockApiClient.createUserCollection.mockResolvedValue({
      data: {
        userCollection: {
          id: 'new-col',
          name: 'New Collection',
          description: 'Description',
          collectionType: 'Set',
          isPublic: false,
          isSystem: false,
          systemType: null,
          userId: 'user-1',
          createdAt: '',
          updatedAt: '',
          _count: { items: 0 },
        },
      },
    });
  });

  describe('loading state', () => {
    it('shows loading spinner while fetching', () => {
      mockApiClient.getUserCollections.mockImplementation(() => new Promise(() => {}));

      render(<UserCollectionsPage />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('hides loading spinner after data loads', async () => {
      render(<UserCollectionsPage />);

      // Wait for content to appear (which means loading is done)
      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      // Then verify spinner is gone
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
  });

  describe('error handling', () => {
    it('shows error message when fetch fails', async () => {
      mockApiClient.getUserCollections.mockResolvedValue({ error: 'Failed to fetch collections' });

      render(<UserCollectionsPage />);

      await waitFor(() => {
        expect(screen.getByText('Failed to fetch collections')).toBeInTheDocument();
      });
    });
  });

  describe('rendering my collections', () => {
    it('shows page title', async () => {
      render(<UserCollectionsPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
      });
    });

    it('shows create button', async () => {
      render(<UserCollectionsPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
      });
    });

    it('shows collection names', async () => {
      render(<UserCollectionsPage />);

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
        expect(screen.getByText('Shared Playlist')).toBeInTheDocument();
      });
    });

    it('shows collection descriptions', async () => {
      render(<UserCollectionsPage />);

      await waitFor(() => {
        expect(screen.getByText('My favorite movies')).toBeInTheDocument();
      });
    });

    it('shows public/private status', async () => {
      render(<UserCollectionsPage />);

      await waitFor(() => {
        // Should have both public and private chips
        expect(screen.getAllByText(/private|public/i).length).toBeGreaterThan(0);
      });
    });

    it('shows item counts', async () => {
      render(<UserCollectionsPage />);

      await waitFor(() => {
        expect(screen.getByText(/10 items/i)).toBeInTheDocument();
        expect(screen.getByText(/5 items/i)).toBeInTheDocument();
      });
    });

    it('shows delete buttons for own collections', async () => {
      render(<UserCollectionsPage />);

      await waitFor(() => {
        // Should have delete buttons for each of the user's collections
        const deleteButtons = screen.getAllByRole('button', { name: '' }).filter(
          btn => btn.querySelector('[data-testid="DeleteIcon"]') !== null
        );
        expect(deleteButtons.length).toBeGreaterThan(0);
      });
    });
  });

  describe('tabs', () => {
    it('shows tabs for my collections and public', async () => {
      render(<UserCollectionsPage />);

      await waitFor(() => {
        expect(screen.getAllByRole('tab').length).toBe(2);
      });
    });

    it('switches to public collections tab', async () => {
      const user = userEvent.setup();

      render(<UserCollectionsPage />);

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      // Click the public collections tab
      const tabs = screen.getAllByRole('tab');
      await user.click(tabs[1]);

      await waitFor(() => {
        expect(screen.getByText('Best Sci-Fi')).toBeInTheDocument();
      });
    });

    it('shows creator name for public collections', async () => {
      const user = userEvent.setup();

      render(<UserCollectionsPage />);

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      // Click the public collections tab
      const tabs = screen.getAllByRole('tab');
      await user.click(tabs[1]);

      await waitFor(() => {
        expect(screen.getByText(/John Doe/)).toBeInTheDocument();
      });
    });
  });

  describe('navigation', () => {
    it('navigates to collection when clicked', async () => {
      const user = userEvent.setup();

      render(<UserCollectionsPage />);

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      await user.click(screen.getByText('My Favorites'));

      expect(mockNavigate).toHaveBeenCalledWith('/my-collections/col-1');
    });
  });

  describe('creating collections', () => {
    it('opens create dialog when create button clicked', async () => {
      const user = userEvent.setup();

      render(<UserCollectionsPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /create/i }));

      expect(screen.getByTestId('create-dialog')).toBeInTheDocument();
    });

    it('creates collection and adds to list', async () => {
      const user = userEvent.setup();

      render(<UserCollectionsPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /create/i }));
      await user.click(screen.getByTestId('create-submit'));

      expect(mockApiClient.createUserCollection).toHaveBeenCalled();

      await waitFor(() => {
        expect(screen.getByText('New Collection')).toBeInTheDocument();
      });
    });
  });

  describe('deleting collections', () => {
    it('shows delete confirmation dialog', async () => {
      const user = userEvent.setup();

      render(<UserCollectionsPage />);

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      // Find delete button by finding the DeleteIcon and getting its parent button
      const deleteIcons = screen.getAllByTestId('DeleteIcon');
      const deleteButton = deleteIcons[0].closest('button');

      if (deleteButton) {
        await user.click(deleteButton);

        await waitFor(() => {
          expect(screen.getByRole('dialog')).toBeInTheDocument();
        });
      }
    });

    it('deletes collection when confirmed', async () => {
      const user = userEvent.setup();

      render(<UserCollectionsPage />);

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      // Find delete button by finding the DeleteIcon and getting its parent button
      const deleteIcons = screen.getAllByTestId('DeleteIcon');
      const deleteButton = deleteIcons[0].closest('button');

      if (deleteButton) {
        await user.click(deleteButton);

        await waitFor(() => {
          expect(screen.getByRole('dialog')).toBeInTheDocument();
        });

        // Confirm deletion
        const confirmButton = screen.getByRole('button', { name: /delete/i });
        await user.click(confirmButton);

        expect(mockApiClient.deleteUserCollection).toHaveBeenCalledWith('col-1');
      }
    });
  });

  describe('empty states', () => {
    it('shows empty message when no collections', async () => {
      mockApiClient.getUserCollections.mockResolvedValue({
        data: { userCollections: [] },
      });

      render(<UserCollectionsPage />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });

    it('shows empty message when no public collections', async () => {
      const user = userEvent.setup();

      mockApiClient.getPublicCollections.mockResolvedValue({
        data: { userCollections: [] },
      });

      render(<UserCollectionsPage />);

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      // Click the public collections tab
      const tabs = screen.getAllByRole('tab');
      await user.click(tabs[1]);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });
  });
});
