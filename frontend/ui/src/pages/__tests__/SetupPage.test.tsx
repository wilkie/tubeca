import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { SetupPage } from '../SetupPage';
import { useAuth } from '../../context/AuthContext';

// Mock the AuthContext
jest.mock('../../context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

// Mock useNavigate
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

describe('SetupPage', () => {
  const mockSetup = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    mockUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      isAuthenticated: false,
      needsSetup: true,
      login: jest.fn(),
      setup: mockSetup,
      logout: jest.fn(),
    });
  });

  describe('rendering', () => {
    it('renders setup title', () => {
      render(<SetupPage />);

      expect(screen.getByRole('heading', { name: /tubeca setup/i })).toBeInTheDocument();
    });

    it('renders setup description', () => {
      render(<SetupPage />);

      expect(screen.getByText(/create your administrator account/i)).toBeInTheDocument();
    });

    it('renders username field', () => {
      render(<SetupPage />);

      expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    });

    it('renders password field', () => {
      render(<SetupPage />);

      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    });

    it('renders create admin button', () => {
      render(<SetupPage />);

      expect(screen.getByRole('button', { name: /create admin account/i })).toBeInTheDocument();
    });

    it('does not show error initially', () => {
      render(<SetupPage />);

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('form interaction', () => {
    it('allows typing in username field', async () => {
      const user = userEvent.setup();
      render(<SetupPage />);

      const usernameField = screen.getByLabelText(/username/i);
      await user.type(usernameField, 'admin');

      expect(usernameField).toHaveValue('admin');
    });

    it('allows typing in password field', async () => {
      const user = userEvent.setup();
      render(<SetupPage />);

      const passwordField = screen.getByLabelText(/password/i);
      await user.type(passwordField, 'securepass');

      expect(passwordField).toHaveValue('securepass');
    });

    it('password field masks input', () => {
      render(<SetupPage />);

      const passwordField = screen.getByLabelText(/password/i);
      expect(passwordField).toHaveAttribute('type', 'password');
    });
  });

  describe('setup flow', () => {
    it('calls setup with credentials on form submit', async () => {
      const user = userEvent.setup();
      mockSetup.mockResolvedValue(null);

      render(<SetupPage />);

      await user.type(screen.getByLabelText(/username/i), 'admin');
      await user.type(screen.getByLabelText(/password/i), 'securepass');
      await user.click(screen.getByRole('button', { name: /create admin account/i }));

      expect(mockSetup).toHaveBeenCalledWith('admin', 'securepass');
    });

    it('navigates to / on successful setup', async () => {
      const user = userEvent.setup();
      mockSetup.mockResolvedValue(null);

      render(<SetupPage />);

      await user.type(screen.getByLabelText(/username/i), 'admin');
      await user.type(screen.getByLabelText(/password/i), 'securepass');
      await user.click(screen.getByRole('button', { name: /create admin account/i }));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/');
      });
    });

    it('displays error message on failed setup', async () => {
      const user = userEvent.setup();
      mockSetup.mockResolvedValue('Username already exists');

      render(<SetupPage />);

      await user.type(screen.getByLabelText(/username/i), 'admin');
      await user.type(screen.getByLabelText(/password/i), 'securepass');
      await user.click(screen.getByRole('button', { name: /create admin account/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Username already exists');
      });
    });

    it('does not navigate on failed setup', async () => {
      const user = userEvent.setup();
      mockSetup.mockResolvedValue('Setup failed');

      render(<SetupPage />);

      await user.type(screen.getByLabelText(/username/i), 'admin');
      await user.type(screen.getByLabelText(/password/i), 'securepass');
      await user.click(screen.getByRole('button', { name: /create admin account/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('clears previous error on new submit', async () => {
      const user = userEvent.setup();
      mockSetup
        .mockResolvedValueOnce('First error')
        .mockResolvedValueOnce(null);

      render(<SetupPage />);

      // First attempt - fails
      await user.type(screen.getByLabelText(/username/i), 'admin');
      await user.type(screen.getByLabelText(/password/i), 'weakpass');
      await user.click(screen.getByRole('button', { name: /create admin account/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('First error');
      });

      // Second attempt - succeeds
      await user.clear(screen.getByLabelText(/password/i));
      await user.type(screen.getByLabelText(/password/i), 'strongpass');
      await user.click(screen.getByRole('button', { name: /create admin account/i }));

      await waitFor(() => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('disables button while submitting', async () => {
      const user = userEvent.setup();
      mockSetup.mockImplementation(() => new Promise(() => {}));

      render(<SetupPage />);

      await user.type(screen.getByLabelText(/username/i), 'admin');
      await user.type(screen.getByLabelText(/password/i), 'securepass');
      await user.click(screen.getByRole('button', { name: /create admin account/i }));

      await waitFor(() => {
        expect(screen.getByRole('button')).toBeDisabled();
      });
    });

    it('shows loading spinner while submitting', async () => {
      const user = userEvent.setup();
      mockSetup.mockImplementation(() => new Promise(() => {}));

      render(<SetupPage />);

      await user.type(screen.getByLabelText(/username/i), 'admin');
      await user.type(screen.getByLabelText(/password/i), 'securepass');
      await user.click(screen.getByRole('button', { name: /create admin account/i }));

      await waitFor(() => {
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
      });
    });

    it('re-enables button after submission completes', async () => {
      const user = userEvent.setup();
      mockSetup.mockResolvedValue('Error');

      render(<SetupPage />);

      const button = screen.getByRole('button', { name: /create admin account/i });
      expect(button).not.toBeDisabled();

      await user.type(screen.getByLabelText(/username/i), 'admin');
      await user.type(screen.getByLabelText(/password/i), 'securepass');
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create admin account/i })).not.toBeDisabled();
      });
    });
  });
});
