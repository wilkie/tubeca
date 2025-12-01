import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { apiClient } from '../api/client';

// Mock the API client
jest.mock('../api/client', () => ({
  apiClient: {
    checkSetup: jest.fn(),
    hasToken: jest.fn(),
    getCurrentUser: jest.fn(),
    login: jest.fn(),
    setup: jest.fn(),
    clearToken: jest.fn(),
  },
}));

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

// Test component that uses the auth context
function TestComponent() {
  const { user, isLoading, isAuthenticated, needsSetup, login, logout } = useAuth();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (needsSetup) {
    return <div>Setup Required</div>;
  }

  if (!isAuthenticated) {
    return (
      <div>
        <span>Not authenticated</span>
        <button onClick={() => login('testuser', 'password')}>Login</button>
      </div>
    );
  }

  return (
    <div>
      <span>Logged in as {user?.name}</span>
      <button onClick={logout}>Logout</button>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('useAuth hook', () => {
    it('throws error when used outside AuthProvider', () => {
      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<TestComponent />);
      }).toThrow('useAuth must be used within an AuthProvider');

      consoleSpy.mockRestore();
    });
  });

  describe('initialization', () => {
    it('shows loading state initially', async () => {
      mockApiClient.checkSetup.mockImplementation(() => new Promise(() => {})); // Never resolves

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('shows setup required when needsSetup is true', async () => {
      mockApiClient.checkSetup.mockResolvedValue({ data: { needsSetup: true } });

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Setup Required')).toBeInTheDocument();
      });
    });

    it('shows not authenticated when no token exists', async () => {
      mockApiClient.checkSetup.mockResolvedValue({ data: { needsSetup: false } });
      mockApiClient.hasToken.mockReturnValue(false);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Not authenticated')).toBeInTheDocument();
      });
    });

    it('fetches current user when token exists', async () => {
      const mockUser = { id: '1', name: 'testuser', role: 'Admin' as const, groups: [], createdAt: '', updatedAt: '' };
      mockApiClient.checkSetup.mockResolvedValue({ data: { needsSetup: false } });
      mockApiClient.hasToken.mockReturnValue(true);
      mockApiClient.getCurrentUser.mockResolvedValue({ data: { user: mockUser } });

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Logged in as testuser')).toBeInTheDocument();
      });
    });

    it('clears token when getCurrentUser fails', async () => {
      mockApiClient.checkSetup.mockResolvedValue({ data: { needsSetup: false } });
      mockApiClient.hasToken.mockReturnValue(true);
      mockApiClient.getCurrentUser.mockResolvedValue({ error: 'Token expired' });

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(mockApiClient.clearToken).toHaveBeenCalled();
        expect(screen.getByText('Not authenticated')).toBeInTheDocument();
      });
    });
  });

  describe('login', () => {
    it('sets user on successful login', async () => {
      const user = userEvent.setup();
      const mockUser = { id: '1', name: 'testuser', role: 'Admin' as const, groups: [], createdAt: '', updatedAt: '' };

      mockApiClient.checkSetup.mockResolvedValue({ data: { needsSetup: false } });
      mockApiClient.hasToken.mockReturnValue(false);
      mockApiClient.login.mockResolvedValue({ data: { token: 'token', user: mockUser } });

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Not authenticated')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /login/i }));

      await waitFor(() => {
        expect(screen.getByText('Logged in as testuser')).toBeInTheDocument();
      });
    });

    it('returns error on failed login', async () => {
      mockApiClient.checkSetup.mockResolvedValue({ data: { needsSetup: false } });
      mockApiClient.hasToken.mockReturnValue(false);
      mockApiClient.login.mockResolvedValue({ error: 'Invalid credentials' });

      // Test component that shows login errors
      function LoginErrorComponent() {
        const { isLoading, login } = useAuth();
        const [error, setError] = React.useState<string | null>(null);

        if (isLoading) return <div>Loading...</div>;

        return (
          <div>
            <button
              onClick={async () => {
                const err = await login('wrong', 'password');
                setError(err);
              }}
            >
              Login
            </button>
            {error && <span>Error: {error}</span>}
          </div>
        );
      }

      const user = userEvent.setup();

      render(
        <AuthProvider>
          <LoginErrorComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /login/i }));

      await waitFor(() => {
        expect(screen.getByText('Error: Invalid credentials')).toBeInTheDocument();
      });
    });
  });

  describe('logout', () => {
    it('clears user and token on logout', async () => {
      const user = userEvent.setup();
      const mockUser = { id: '1', name: 'testuser', role: 'Admin' as const, groups: [], createdAt: '', updatedAt: '' };

      mockApiClient.checkSetup.mockResolvedValue({ data: { needsSetup: false } });
      mockApiClient.hasToken.mockReturnValue(true);
      mockApiClient.getCurrentUser.mockResolvedValue({ data: { user: mockUser } });

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Logged in as testuser')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /logout/i }));

      expect(mockApiClient.clearToken).toHaveBeenCalled();
      expect(screen.getByText('Not authenticated')).toBeInTheDocument();
    });
  });
});
