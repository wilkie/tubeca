import { render, screen, waitFor, within } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { AddToCollectionDialog } from '../AddToCollectionDialog';
import { apiClient, type UserCollection } from '../../api/client';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    getUserCollections: jest.fn(),
    createUserCollection: jest.fn(),
    addUserCollectionItem: jest.fn(),
  },
}));

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

const mockCollections: UserCollection[] = [
  {
    id: 'col-1',
    name: 'My Favorites',
    description: 'Favorite movies',
    collectionType: 'Set',
    isPublic: false,
    isSystem: false,
    systemType: null,
    userId: 'user-1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-15T00:00:00Z',
    _count: { items: 5 },
  },
  {
    id: 'col-2',
    name: 'To Watch',
    description: 'Movies to watch',
    collectionType: 'Set',
    isPublic: false,
    isSystem: false,
    systemType: null,
    userId: 'user-1',
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-10T00:00:00Z',
    _count: { items: 10 },
  },
  {
    id: 'col-3',
    name: 'Shared List',
    description: 'Public list',
    collectionType: 'Set',
    isPublic: true,
    isSystem: false,
    systemType: null,
    userId: 'user-1',
    createdAt: '2024-01-03T00:00:00Z',
    updatedAt: '2024-01-05T00:00:00Z',
    _count: { items: 3 },
  },
];

describe('AddToCollectionDialog', () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockApiClient.getUserCollections.mockResolvedValue({
      data: { userCollections: mockCollections },
    });
    mockApiClient.createUserCollection.mockResolvedValue({
      data: {
        userCollection: {
          id: 'new-col',
          name: 'New Collection',
          description: '',
          collectionType: 'Set',
          isPublic: false,
          isSystem: false,
          systemType: null,
          userId: 'user-1',
          createdAt: '2024-01-20T00:00:00Z',
          updatedAt: '2024-01-20T00:00:00Z',
          _count: { items: 0 },
        },
      },
    });
    mockApiClient.addUserCollectionItem.mockResolvedValue({ data: undefined });
  });

  describe('when closed', () => {
    it('does not render dialog when open is false', () => {
      render(
        <AddToCollectionDialog
          open={false}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('does not fetch collections when closed', () => {
      render(
        <AddToCollectionDialog
          open={false}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      expect(mockApiClient.getUserCollections).not.toHaveBeenCalled();
    });
  });

  describe('when open', () => {
    it('renders the dialog and fetches collections on open', async () => {
      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Wait for data to load completely
      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      expect(mockApiClient.getUserCollections).toHaveBeenCalled();
    });

    it('shows the item name', async () => {
      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });

      expect(screen.getByText('The Matrix')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading spinner while fetching', () => {
      mockApiClient.getUserCollections.mockImplementation(() => new Promise(() => {}));

      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('hides loading spinner after data loads', async () => {
      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows error message when fetch fails', async () => {
      mockApiClient.getUserCollections.mockResolvedValue({
        error: 'Failed to load collections',
      });

      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Failed to load collections')).toBeInTheDocument();
      });
    });
  });

  describe('collection list', () => {
    it('shows all collections', async () => {
      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
        expect(screen.getByText('To Watch')).toBeInTheDocument();
        expect(screen.getByText('Shared List')).toBeInTheDocument();
      });
    });

    it('shows item counts for collections', async () => {
      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/5 items/i)).toBeInTheDocument();
        expect(screen.getByText(/10 items/i)).toBeInTheDocument();
        expect(screen.getByText(/3 items/i)).toBeInTheDocument();
      });
    });

    it('shows empty message when no collections', async () => {
      mockApiClient.getUserCollections.mockResolvedValue({
        data: { userCollections: [] },
      });

      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });
  });

  describe('selection', () => {
    it('allows selecting a collection', async () => {
      const user = userEvent.setup();

      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      await user.click(screen.getByText('My Favorites'));

      const checkbox = within(
        screen.getByText('My Favorites').closest('li') as HTMLElement
      ).getByRole('checkbox');
      expect(checkbox).toBeChecked();
    });

    it('allows deselecting a collection', async () => {
      const user = userEvent.setup();

      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      // Select
      await user.click(screen.getByText('My Favorites'));

      const listItem = screen.getByText('My Favorites').closest('li') as HTMLElement;
      const checkbox = within(listItem).getByRole('checkbox');
      expect(checkbox).toBeChecked();

      // Deselect
      await user.click(screen.getByText('My Favorites'));
      expect(checkbox).not.toBeChecked();
    });

    it('allows selecting multiple collections', async () => {
      const user = userEvent.setup();

      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      await user.click(screen.getByText('My Favorites'));
      await user.click(screen.getByText('To Watch'));

      const checkbox1 = within(
        screen.getByText('My Favorites').closest('li') as HTMLElement
      ).getByRole('checkbox');
      const checkbox2 = within(
        screen.getByText('To Watch').closest('li') as HTMLElement
      ).getByRole('checkbox');

      expect(checkbox1).toBeChecked();
      expect(checkbox2).toBeChecked();
    });
  });

  describe('saving', () => {
    it('disables save button when nothing selected', async () => {
      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    });

    it('enables save button when collection is selected', async () => {
      const user = userEvent.setup();

      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      await user.click(screen.getByText('My Favorites'));

      expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
    });

    it('calls addUserCollectionItem when saving', async () => {
      const user = userEvent.setup();

      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      await user.click(screen.getByText('My Favorites'));
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockApiClient.addUserCollectionItem).toHaveBeenCalledWith('col-1', {
          collectionId: 'item-1',
        });
      });
    });

    it('adds to multiple collections when multiple selected', async () => {
      const user = userEvent.setup();

      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      await user.click(screen.getByText('My Favorites'));
      await user.click(screen.getByText('To Watch'));
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockApiClient.addUserCollectionItem).toHaveBeenCalledTimes(2);
      });
    });

    it('uses mediaId when provided instead of collectionId', async () => {
      const user = userEvent.setup();

      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          mediaId="media-1"
          itemName="Pilot Episode"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      await user.click(screen.getByText('My Favorites'));
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockApiClient.addUserCollectionItem).toHaveBeenCalledWith('col-1', {
          mediaId: 'media-1',
        });
      });
    });

    it('closes dialog after successful save', async () => {
      const user = userEvent.setup();

      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      await user.click(screen.getByText('My Favorites'));
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });
    });
  });

  describe('creating new collection', () => {
    it('shows create button', async () => {
      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
      });
    });

    it('shows input field when create is clicked', async () => {
      const user = userEvent.setup();

      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /create/i }));

      // Look for the name input by finding the textbox with Name label
      expect(screen.getByRole('textbox', { name: /name/i })).toBeInTheDocument();
    });

    it('creates new collection when submitted', async () => {
      const user = userEvent.setup();

      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /create/i }));

      const nameInput = screen.getByRole('textbox', { name: /name/i });
      await user.type(nameInput, 'New Collection');

      // There are now multiple create buttons - find the one in the form area
      const createButtons = screen.getAllByRole('button', { name: /create/i });
      await user.click(createButtons[0]);

      await waitFor(() => {
        expect(mockApiClient.createUserCollection).toHaveBeenCalledWith({
          name: 'New Collection',
        });
      });
    });

    it('adds new collection to list and selects it', async () => {
      const user = userEvent.setup();

      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /create/i }));

      const nameInput = screen.getByRole('textbox', { name: /name/i });
      await user.type(nameInput, 'New Collection');

      const createButtons = screen.getAllByRole('button', { name: /create/i });
      await user.click(createButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('New Collection')).toBeInTheDocument();
      });

      // Should be automatically selected
      const listItem = screen.getByText('New Collection').closest('li') as HTMLElement;
      const checkbox = within(listItem).getByRole('checkbox');
      expect(checkbox).toBeChecked();
    });

    it('cancels create mode when cancel clicked', async () => {
      const user = userEvent.setup();

      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /create/i }));
      expect(screen.getByRole('textbox', { name: /name/i })).toBeInTheDocument();

      // Click the cancel button in the create form (not the one in dialog actions)
      const cancelButtons = screen.getAllByRole('button', { name: /cancel/i });
      // The cancel button in the create form area is the first one
      await user.click(cancelButtons[0]);

      // Input should be gone, create button should be back
      expect(screen.queryByRole('textbox', { name: /name/i })).not.toBeInTheDocument();
    });

    it('disables create button when name is empty', async () => {
      const user = userEvent.setup();

      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: /name/i })).toBeInTheDocument();
      });

      const createButtons = screen.getAllByRole('button', { name: /create/i });
      expect(createButtons[0]).toBeDisabled();
    });
  });

  describe('sorting', () => {
    it('shows sort controls', async () => {
      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      // Should have sort toggle buttons
      const toggleGroup = screen.getByRole('group');
      expect(toggleGroup).toBeInTheDocument();
    });

    it('sorts by date by default (descending)', async () => {
      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      // Get all list items
      const listItems = screen.getAllByRole('listitem');
      const names = listItems.map((item) => within(item).getByText(/Favorites|Watch|Shared/).textContent);

      // By date descending: My Favorites (Jan 15), To Watch (Jan 10), Shared List (Jan 5)
      expect(names[0]).toBe('My Favorites');
      expect(names[1]).toBe('To Watch');
      expect(names[2]).toBe('Shared List');
    });
  });

  describe('cancel button', () => {
    it('closes dialog when cancel clicked', async () => {
      const user = userEvent.setup();

      render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      // Find the cancel button in the dialog actions (at the bottom)
      const dialogActions = screen.getByRole('dialog').querySelector('.MuiDialogActions-root');
      const cancelButton = within(dialogActions as HTMLElement).getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('resets selections when closed', async () => {
      const user = userEvent.setup();

      const { rerender } = render(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      // Select a collection
      await user.click(screen.getByText('My Favorites'));

      // Cancel
      const dialogActions = screen.getByRole('dialog').querySelector('.MuiDialogActions-root');
      const cancelButton = within(dialogActions as HTMLElement).getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      // Reopen
      rerender(
        <AddToCollectionDialog
          open={true}
          onClose={mockOnClose}
          collectionId="item-1"
          itemName="The Matrix"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('My Favorites')).toBeInTheDocument();
      });

      // Should not be selected
      const listItem = screen.getByText('My Favorites').closest('li') as HTMLElement;
      const checkbox = within(listItem).getByRole('checkbox');
      expect(checkbox).not.toBeChecked();
    });
  });
});
