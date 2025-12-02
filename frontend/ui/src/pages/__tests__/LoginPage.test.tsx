import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { LoginPage } from '../LoginPage';
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

describe('LoginPage', () => {
  const mockLogin = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    mockUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      isAuthenticated: false,
      needsSetup: false,
      login: mockLogin,
      setup: jest.fn(),
      logout: jest.fn(),
    });
  });

  describe('rendering', () => {
    it('renders app name', () => {
      render(<LoginPage />);

      expect(screen.getByRole('heading', { name: 'Tubeca' })).toBeInTheDocument();
    });

    it('renders username field', () => {
      render(<LoginPage />);

      expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    });

    it('renders password field', () => {
      render(<LoginPage />);

      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    });

    it('renders login button', () => {
      render(<LoginPage />);

      expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument();
    });

    it('does not show error initially', () => {
      render(<LoginPage />);

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('form interaction', () => {
    it('allows typing in username field', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const usernameField = screen.getByLabelText(/username/i);
      await user.type(usernameField, 'testuser');

      expect(usernameField).toHaveValue('testuser');
    });

    it('allows typing in password field', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const passwordField = screen.getByLabelText(/password/i);
      await user.type(passwordField, 'testpass');

      expect(passwordField).toHaveValue('testpass');
    });

    it('password field masks input', () => {
      render(<LoginPage />);

      const passwordField = screen.getByLabelText(/password/i);
      expect(passwordField).toHaveAttribute('type', 'password');
    });
  });

  describe('login flow', () => {
    it('calls login with credentials on form submit', async () => {
      const user = userEvent.setup();
      mockLogin.mockResolvedValue(null); // null = success

      render(<LoginPage />);

      await user.type(screen.getByLabelText(/username/i), 'testuser');
      await user.type(screen.getByLabelText(/password/i), 'testpass');
      await user.click(screen.getByRole('button', { name: /login/i }));

      expect(mockLogin).toHaveBeenCalledWith('testuser', 'testpass');
    });

    it('navigates to / on successful login', async () => {
      const user = userEvent.setup();
      mockLogin.mockResolvedValue(null);

      render(<LoginPage />);

      await user.type(screen.getByLabelText(/username/i), 'testuser');
      await user.type(screen.getByLabelText(/password/i), 'testpass');
      await user.click(screen.getByRole('button', { name: /login/i }));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/');
      });
    });

    it('displays error message on failed login', async () => {
      const user = userEvent.setup();
      mockLogin.mockResolvedValue('Invalid credentials');

      render(<LoginPage />);

      await user.type(screen.getByLabelText(/username/i), 'testuser');
      await user.type(screen.getByLabelText(/password/i), 'wrongpass');
      await user.click(screen.getByRole('button', { name: /login/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials');
      });
    });

    it('does not navigate on failed login', async () => {
      const user = userEvent.setup();
      mockLogin.mockResolvedValue('Invalid credentials');

      render(<LoginPage />);

      await user.type(screen.getByLabelText(/username/i), 'testuser');
      await user.type(screen.getByLabelText(/password/i), 'wrongpass');
      await user.click(screen.getByRole('button', { name: /login/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('clears previous error on new submit', async () => {
      const user = userEvent.setup();
      mockLogin
        .mockResolvedValueOnce('First error')
        .mockResolvedValueOnce(null);

      render(<LoginPage />);

      // First attempt - fails
      await user.type(screen.getByLabelText(/username/i), 'testuser');
      await user.type(screen.getByLabelText(/password/i), 'wrongpass');
      await user.click(screen.getByRole('button', { name: /login/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('First error');
      });

      // Second attempt - succeeds
      await user.clear(screen.getByLabelText(/password/i));
      await user.type(screen.getByLabelText(/password/i), 'correctpass');
      await user.click(screen.getByRole('button', { name: /login/i }));

      await waitFor(() => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('disables button while submitting', async () => {
      const user = userEvent.setup();
      // Make login hang to keep submitting state
      mockLogin.mockImplementation(() => new Promise(() => {}));

      render(<LoginPage />);

      await user.type(screen.getByLabelText(/username/i), 'testuser');
      await user.type(screen.getByLabelText(/password/i), 'testpass');
      await user.click(screen.getByRole('button', { name: /login/i }));

      await waitFor(() => {
        expect(screen.getByRole('button')).toBeDisabled();
      });
    });

    it('shows loading spinner while submitting', async () => {
      const user = userEvent.setup();
      mockLogin.mockImplementation(() => new Promise(() => {}));

      render(<LoginPage />);

      await user.type(screen.getByLabelText(/username/i), 'testuser');
      await user.type(screen.getByLabelText(/password/i), 'testpass');
      await user.click(screen.getByRole('button', { name: /login/i }));

      await waitFor(() => {
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
      });
    });

    it('re-enables button after submission completes', async () => {
      const user = userEvent.setup();
      mockLogin.mockResolvedValue('Error');

      render(<LoginPage />);

      const button = screen.getByRole('button', { name: /login/i });
      expect(button).not.toBeDisabled();

      await user.type(screen.getByLabelText(/username/i), 'testuser');
      await user.type(screen.getByLabelText(/password/i), 'testpass');
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /login/i })).not.toBeDisabled();
      });
    });
  });
});
