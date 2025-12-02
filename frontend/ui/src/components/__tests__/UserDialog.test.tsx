import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { UserDialog } from '../UserDialog';
import { apiClient } from '../../api/client';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    createUser: jest.fn(),
    updateUser: jest.fn(),
    updateUserRole: jest.fn(),
    updateUserGroups: jest.fn(),
  },
}));

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('UserDialog', () => {
  const mockOnClose = jest.fn();
  const mockOnSave = jest.fn();
  const mockGroups = [
    { id: 'group-1', name: 'Admins', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
    { id: 'group-2', name: 'Editors', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Create mode', () => {
    it('renders create dialog with empty form', () => {
      render(
        <UserDialog
          open={true}
          user={null}
          groups={mockGroups}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByLabelText(/username/i)).toHaveValue('');
      expect(screen.getByLabelText(/password/i)).toHaveValue('');
    });

    it('shows validation error when name is empty', async () => {
      const user = userEvent.setup();

      render(
        <UserDialog
          open={true}
          user={null}
          groups={mockGroups}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(await screen.findByText(/name.*required/i)).toBeInTheDocument();
      expect(mockApiClient.createUser).not.toHaveBeenCalled();
    });

    it('shows validation error when password is empty on create', async () => {
      const user = userEvent.setup();

      render(
        <UserDialog
          open={true}
          user={null}
          groups={mockGroups}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.type(screen.getByLabelText(/username/i), 'newuser');
      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(await screen.findByText(/password.*required/i)).toBeInTheDocument();
      expect(mockApiClient.createUser).not.toHaveBeenCalled();
    });

    it('creates user successfully', async () => {
      const user = userEvent.setup();
      mockApiClient.createUser.mockResolvedValue({ data: { user: { id: '1', name: 'newuser', role: 'Viewer', groups: [], createdAt: '', updatedAt: '' } } });

      render(
        <UserDialog
          open={true}
          user={null}
          groups={mockGroups}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.type(screen.getByLabelText(/username/i), 'newuser');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockApiClient.createUser).toHaveBeenCalledWith({
          name: 'newuser',
          password: 'password123',
          role: 'Viewer',
          groupIds: [],
        });
      });

      expect(mockOnSave).toHaveBeenCalled();
    });

    it('displays API error on create failure', async () => {
      const user = userEvent.setup();
      mockApiClient.createUser.mockResolvedValue({ error: 'Username already exists' });

      render(
        <UserDialog
          open={true}
          user={null}
          groups={mockGroups}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.type(screen.getByLabelText(/username/i), 'existinguser');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(await screen.findByText(/username already exists/i)).toBeInTheDocument();
      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('calls onClose when cancel is clicked', async () => {
      const user = userEvent.setup();

      render(
        <UserDialog
          open={true}
          user={null}
          groups={mockGroups}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('Edit mode', () => {
    const existingUser = {
      id: 'user-1',
      name: 'existinguser',
      role: 'Editor' as const,
      groups: [{ id: 'group-1', name: 'Admins', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    it('renders edit dialog with populated form', () => {
      render(
        <UserDialog
          open={true}
          user={existingUser}
          groups={mockGroups}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      expect(screen.getByLabelText(/username/i)).toHaveValue('existinguser');
      // Password should be empty for editing
      expect(screen.getByLabelText(/new password/i)).toHaveValue('');
    });

    it('allows updating user without changing password', async () => {
      const user = userEvent.setup();
      mockApiClient.updateUser.mockResolvedValue({ data: { user: existingUser } });
      mockApiClient.updateUserRole.mockResolvedValue({ data: { user: existingUser } });
      mockApiClient.updateUserGroups.mockResolvedValue({ data: { user: existingUser } });

      render(
        <UserDialog
          open={true}
          user={existingUser}
          groups={mockGroups}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      // Clear and type new username
      const usernameInput = screen.getByLabelText(/username/i);
      await user.clear(usernameInput);
      await user.type(usernameInput, 'updateduser');
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockApiClient.updateUser).toHaveBeenCalledWith('user-1', { name: 'updateduser' });
      });

      expect(mockOnSave).toHaveBeenCalled();
    });

    it('updates password when provided', async () => {
      const user = userEvent.setup();
      mockApiClient.updateUser.mockResolvedValue({ data: { user: existingUser } });
      mockApiClient.updateUserRole.mockResolvedValue({ data: { user: existingUser } });
      mockApiClient.updateUserGroups.mockResolvedValue({ data: { user: existingUser } });

      render(
        <UserDialog
          open={true}
          user={existingUser}
          groups={mockGroups}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.type(screen.getByLabelText(/new password/i), 'newpassword');
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockApiClient.updateUser).toHaveBeenCalledWith('user-1', { password: 'newpassword' });
      });
    });
  });

  describe('Dialog visibility', () => {
    it('does not render when open is false', () => {
      render(
        <UserDialog
          open={false}
          user={null}
          groups={mockGroups}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
