import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { UsersPage } from '../UsersPage';
import { apiClient } from '../../api/client';
import type { User, Group } from '../../api/client';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    getUsers: jest.fn(),
    getGroups: jest.fn(),
    deleteUser: jest.fn(),
    deleteGroup: jest.fn(),
    createGroup: jest.fn(),
    updateGroup: jest.fn(),
  },
}));

// Mock UserDialog
jest.mock('../../components/UserDialog', () => ({
  UserDialog: jest.fn(({ open, user, onClose, onSave }) =>
    open ? (
      <div data-testid="user-dialog" data-user={user?.name || 'new'}>
        <button onClick={onClose} data-testid="dialog-close">Close</button>
        <button onClick={onSave} data-testid="dialog-save">Save</button>
      </div>
    ) : null
  ),
}));

// Mock useAuth
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'current-user', name: 'Admin User', role: 'Admin' },
  }),
}));

// Mock window.confirm
const mockConfirm = jest.fn();
window.confirm = mockConfirm;

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

// Mock user data
const mockUsers: User[] = [
  {
    id: 'user-1',
    name: 'admin',
    role: 'Admin',
    groups: [{ id: 'grp-1', name: 'Staff' }],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'user-2',
    name: 'editor',
    role: 'Editor',
    groups: [],
    createdAt: '2024-02-01T00:00:00Z',
    updatedAt: '2024-02-01T00:00:00Z',
  },
  {
    id: 'current-user',
    name: 'Admin User',
    role: 'Admin',
    groups: [],
    createdAt: '2024-03-01T00:00:00Z',
    updatedAt: '2024-03-01T00:00:00Z',
  },
];

// Mock group data
const mockGroups: Group[] = [
  {
    id: 'grp-1',
    name: 'Staff',
    _count: { users: 2, libraries: 3 },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'grp-2',
    name: 'Family',
    _count: { users: 5, libraries: 1 },
    createdAt: '2024-02-01T00:00:00Z',
    updatedAt: '2024-02-01T00:00:00Z',
  },
];

describe('UsersPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfirm.mockReturnValue(true);

    // Default mock responses
    mockApiClient.getUsers.mockResolvedValue({ data: { users: mockUsers } });
    mockApiClient.getGroups.mockResolvedValue({ data: { groups: mockGroups } });
  });

  describe('loading state', () => {
    it('shows loading spinner while fetching', () => {
      mockApiClient.getUsers.mockImplementation(() => new Promise(() => {}));
      mockApiClient.getGroups.mockImplementation(() => new Promise(() => {}));

      render(<UsersPage />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('hides loading spinner after data loads', async () => {
      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });
  });

  describe('rendering', () => {
    it('shows page title', async () => {
      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /users/i })).toBeInTheDocument();
      });
    });

    it('shows tabs for users and groups', async () => {
      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /users/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /groups/i })).toBeInTheDocument();
      });
    });

    it('shows create user button', async () => {
      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add user/i })).toBeInTheDocument();
      });
    });

    it('shows error message when fetch fails', async () => {
      mockApiClient.getUsers.mockResolvedValue({ error: 'Failed to load users' });

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load users')).toBeInTheDocument();
      });
    });

    it('shows empty message when no users', async () => {
      mockApiClient.getUsers.mockResolvedValue({ data: { users: [] } });

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByText(/no users/i)).toBeInTheDocument();
      });
    });
  });

  describe('users tab', () => {
    it('shows user names in table', async () => {
      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByText('admin')).toBeInTheDocument();
        expect(screen.getByText('editor')).toBeInTheDocument();
      });
    });

    it('shows user roles as chips', async () => {
      render(<UsersPage />);

      await waitFor(() => {
        // Look for chips specifically by checking for MuiChip class
        const chips = document.querySelectorAll('.MuiChip-root');
        expect(chips.length).toBeGreaterThan(0);
        // Check that Admin and Editor roles are displayed
        expect(screen.getAllByText('Admin').length).toBeGreaterThan(0);
        expect(screen.getByText('Editor')).toBeInTheDocument();
      });
    });

    it('shows groups assigned to users', async () => {
      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByText('Staff')).toBeInTheDocument();
      });
    });

    it('shows "no groups" for users without groups', async () => {
      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getAllByText(/no groups/i).length).toBeGreaterThan(0);
      });
    });

    it('shows edit button for each user', async () => {
      render(<UsersPage />);

      await waitFor(() => {
        const editButtons = screen.getAllByTestId('EditIcon');
        expect(editButtons.length).toBeGreaterThanOrEqual(mockUsers.length);
      });
    });

    it('shows delete button for each user', async () => {
      render(<UsersPage />);

      await waitFor(() => {
        const deleteButtons = screen.getAllByTestId('DeleteIcon');
        expect(deleteButtons.length).toBeGreaterThanOrEqual(mockUsers.length);
      });
    });

    it('disables delete button for current user', async () => {
      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByText('Admin User')).toBeInTheDocument();
      });

      // Find all delete buttons (they have DeleteIcon inside)
      const deleteButtons = screen.getAllByTestId('DeleteIcon').map((icon) => icon.closest('button'));

      // Admin User is the third user in our mock data
      // Find the delete button that is disabled
      const disabledDeleteButton = deleteButtons.find((btn) => btn?.disabled);
      expect(disabledDeleteButton).toBeTruthy();

      // Verify other delete buttons are enabled
      const enabledDeleteButtons = deleteButtons.filter((btn) => !btn?.disabled);
      expect(enabledDeleteButtons.length).toBeGreaterThan(0);
    });
  });

  describe('groups tab', () => {
    it('switches to groups tab when clicked', async () => {
      const user = userEvent.setup();

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /groups/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('tab', { name: /groups/i }));

      expect(screen.getByRole('button', { name: /add group/i })).toBeInTheDocument();
    });

    it('shows group names in table', async () => {
      const user = userEvent.setup();

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /groups/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('tab', { name: /groups/i }));

      expect(screen.getByText('Staff')).toBeInTheDocument();
      expect(screen.getByText('Family')).toBeInTheDocument();
    });

    it('shows user count for groups', async () => {
      const user = userEvent.setup();

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /groups/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('tab', { name: /groups/i }));

      expect(screen.getByText('2')).toBeInTheDocument(); // Staff has 2 users
      expect(screen.getByText('5')).toBeInTheDocument(); // Family has 5 users
    });

    it('shows library count for groups', async () => {
      const user = userEvent.setup();

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /groups/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('tab', { name: /groups/i }));

      expect(screen.getByText('3')).toBeInTheDocument(); // Staff has 3 libraries
      expect(screen.getByText('1')).toBeInTheDocument(); // Family has 1 library
    });

    it('shows empty message when no groups', async () => {
      const user = userEvent.setup();
      mockApiClient.getGroups.mockResolvedValue({ data: { groups: [] } });

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /groups/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('tab', { name: /groups/i }));

      expect(screen.getByText(/no groups/i)).toBeInTheDocument();
    });
  });

  describe('user operations', () => {
    it('opens dialog for creating new user', async () => {
      const user = userEvent.setup();

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add user/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /add user/i }));

      expect(screen.getByTestId('user-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('user-dialog')).toHaveAttribute('data-user', 'new');
    });

    it('opens dialog for editing user', async () => {
      const user = userEvent.setup();

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByText('admin')).toBeInTheDocument();
      });

      // Click first edit button (in users tab, not groups)
      const editButtons = screen.getAllByTestId('EditIcon');
      await user.click(editButtons[0].closest('button')!);

      expect(screen.getByTestId('user-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('user-dialog')).toHaveAttribute('data-user', 'admin');
    });

    it('closes user dialog', async () => {
      const user = userEvent.setup();

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add user/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /add user/i }));
      expect(screen.getByTestId('user-dialog')).toBeInTheDocument();

      await user.click(screen.getByTestId('dialog-close'));
      expect(screen.queryByTestId('user-dialog')).not.toBeInTheDocument();
    });

    it('deletes user when confirmed', async () => {
      const user = userEvent.setup();
      mockApiClient.deleteUser.mockResolvedValue({});

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByText('admin')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTestId('DeleteIcon');
      await user.click(deleteButtons[0].closest('button')!);

      expect(mockConfirm).toHaveBeenCalled();
      expect(mockApiClient.deleteUser).toHaveBeenCalledWith('user-1');

      await waitFor(() => {
        expect(screen.queryByText('admin')).not.toBeInTheDocument();
      });
    });

    it('does not delete user when cancelled', async () => {
      const user = userEvent.setup();
      mockConfirm.mockReturnValue(false);

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByText('admin')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTestId('DeleteIcon');
      await user.click(deleteButtons[0].closest('button')!);

      expect(mockConfirm).toHaveBeenCalled();
      expect(mockApiClient.deleteUser).not.toHaveBeenCalled();
      expect(screen.getByText('admin')).toBeInTheDocument();
    });

    it('shows error when delete fails', async () => {
      const user = userEvent.setup();
      mockApiClient.deleteUser.mockResolvedValue({ error: 'Delete failed' });

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByText('admin')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTestId('DeleteIcon');
      await user.click(deleteButtons[0].closest('button')!);

      await waitFor(() => {
        expect(screen.getByText('Delete failed')).toBeInTheDocument();
      });
    });

    it('reloads data after saving user', async () => {
      const user = userEvent.setup();

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add user/i })).toBeInTheDocument();
      });

      // Clear mock call count
      mockApiClient.getUsers.mockClear();
      mockApiClient.getGroups.mockClear();

      await user.click(screen.getByRole('button', { name: /add user/i }));
      await user.click(screen.getByTestId('dialog-save'));

      await waitFor(() => {
        expect(mockApiClient.getUsers).toHaveBeenCalled();
        expect(mockApiClient.getGroups).toHaveBeenCalled();
      });
    });
  });

  describe('group operations', () => {
    it('opens dialog for creating new group', async () => {
      const user = userEvent.setup();

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /groups/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('tab', { name: /groups/i }));
      await user.click(screen.getByRole('button', { name: /add group/i }));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByLabelText(/group name/i)).toBeInTheDocument();
    });

    it('opens dialog for editing group', async () => {
      const user = userEvent.setup();

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /groups/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('tab', { name: /groups/i }));

      // Click first edit button in groups tab
      const editButtons = screen.getAllByTestId('EditIcon');
      await user.click(editButtons[0].closest('button')!);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByLabelText(/group name/i)).toHaveValue('Staff');
    });

    it('creates new group', async () => {
      const user = userEvent.setup();
      mockApiClient.createGroup.mockResolvedValue({ data: { group: { id: 'new-grp', name: 'New Group', createdAt: '', updatedAt: '' } } });

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /groups/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('tab', { name: /groups/i }));
      await user.click(screen.getByRole('button', { name: /add group/i }));

      await user.type(screen.getByLabelText(/group name/i), 'New Group');
      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(mockApiClient.createGroup).toHaveBeenCalledWith({ name: 'New Group' });
    });

    it('updates existing group', async () => {
      const user = userEvent.setup();
      mockApiClient.updateGroup.mockResolvedValue({ data: { group: { id: 'grp-1', name: 'Updated Staff', createdAt: '', updatedAt: '' } } });

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /groups/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('tab', { name: /groups/i }));

      const editButtons = screen.getAllByTestId('EditIcon');
      await user.click(editButtons[0].closest('button')!);

      const input = screen.getByLabelText(/group name/i);
      await user.clear(input);
      await user.type(input, 'Updated Staff');
      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(mockApiClient.updateGroup).toHaveBeenCalledWith('grp-1', { name: 'Updated Staff' });
    });

    it('shows error when group name is empty', async () => {
      const user = userEvent.setup();

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /groups/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('tab', { name: /groups/i }));
      await user.click(screen.getByRole('button', { name: /add group/i }));

      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('shows error when group save fails', async () => {
      const user = userEvent.setup();
      mockApiClient.createGroup.mockResolvedValue({ error: 'Group already exists' });

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /groups/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('tab', { name: /groups/i }));
      await user.click(screen.getByRole('button', { name: /add group/i }));

      await user.type(screen.getByLabelText(/group name/i), 'Staff');
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(screen.getByText('Group already exists')).toBeInTheDocument();
      });
    });

    it('closes group dialog', async () => {
      const user = userEvent.setup();

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /groups/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('tab', { name: /groups/i }));
      await user.click(screen.getByRole('button', { name: /add group/i }));

      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('deletes group when confirmed', async () => {
      const user = userEvent.setup();
      mockApiClient.deleteGroup.mockResolvedValue({});

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /groups/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('tab', { name: /groups/i }));

      const deleteButtons = screen.getAllByTestId('DeleteIcon');
      await user.click(deleteButtons[0].closest('button')!);

      expect(mockConfirm).toHaveBeenCalled();
      expect(mockApiClient.deleteGroup).toHaveBeenCalledWith('grp-1');

      await waitFor(() => {
        expect(screen.queryByText('Staff')).not.toBeInTheDocument();
      });
    });

    it('does not delete group when cancelled', async () => {
      const user = userEvent.setup();
      mockConfirm.mockReturnValue(false);

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /groups/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('tab', { name: /groups/i }));

      const deleteButtons = screen.getAllByTestId('DeleteIcon');
      await user.click(deleteButtons[0].closest('button')!);

      expect(mockConfirm).toHaveBeenCalled();
      expect(mockApiClient.deleteGroup).not.toHaveBeenCalled();
      expect(screen.getByText('Staff')).toBeInTheDocument();
    });

    it('shows error when group delete fails', async () => {
      const user = userEvent.setup();
      mockApiClient.deleteGroup.mockResolvedValue({ error: 'Cannot delete group with users' });

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /groups/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('tab', { name: /groups/i }));

      const deleteButtons = screen.getAllByTestId('DeleteIcon');
      await user.click(deleteButtons[0].closest('button')!);

      await waitFor(() => {
        expect(screen.getByText('Cannot delete group with users')).toBeInTheDocument();
      });
    });
  });

  describe('error dismissal', () => {
    it('can dismiss error alert', async () => {
      const user = userEvent.setup();
      mockApiClient.getUsers.mockResolvedValue({ error: 'Failed to load' });

      render(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load')).toBeInTheDocument();
      });

      const closeButton = screen.getByRole('button', { name: /close/i });
      await user.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByText('Failed to load')).not.toBeInTheDocument();
      });
    });
  });
});
