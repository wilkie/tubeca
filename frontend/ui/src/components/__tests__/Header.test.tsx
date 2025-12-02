import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { Header } from '../Header';
import { useAuth } from '../../context/AuthContext';
import { useActiveLibrary } from '../../context/ActiveLibraryContext';
import { apiClient } from '../../api/client';

// Mock the contexts and API client
jest.mock('../../context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../context/ActiveLibraryContext', () => ({
  useActiveLibrary: jest.fn(),
}));

jest.mock('../../api/client', () => ({
  apiClient: {
    getLibraries: jest.fn(),
  },
}));

// Mock useNavigate
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseActiveLibrary = useActiveLibrary as jest.MockedFunction<typeof useActiveLibrary>;
const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

// Mock library data for tests that need it
const mockLibraries = [
  { id: 'lib-1', name: 'Movies', path: '/media/movies', libraryType: 'Film' as const, watchForChanges: false, createdAt: '', updatedAt: '', groups: [] },
  { id: 'lib-2', name: 'TV Shows', path: '/media/tv', libraryType: 'Television' as const, watchForChanges: false, createdAt: '', updatedAt: '', groups: [] },
];

describe('Header', () => {
  const mockLogout = jest.fn();
  const mockSetActiveLibrary = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock implementations
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', name: 'testuser', role: 'Admin', groups: [], createdAt: '', updatedAt: '' },
      isLoading: false,
      isAuthenticated: true,
      needsSetup: false,
      login: jest.fn(),
      setup: jest.fn(),
      logout: mockLogout,
    });

    mockUseActiveLibrary.mockReturnValue({
      activeLibraryId: null,
      setActiveLibrary: mockSetActiveLibrary,
    });

    // Default: return a never-resolving promise to avoid act() warnings in tests that don't need libraries
    mockApiClient.getLibraries.mockImplementation(() => new Promise(() => {}));
  });

  describe('basic rendering', () => {
    it('renders app name', async () => {
      render(<Header />);

      expect(screen.getByText('Tubeca')).toBeInTheDocument();
    });

    it('renders menu button', () => {
      render(<Header />);

      expect(screen.getByRole('button', { name: /menu/i })).toBeInTheDocument();
    });

    it('renders search button', () => {
      render(<Header />);

      expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
    });

    it('renders account button', () => {
      render(<Header />);

      expect(screen.getByRole('button', { name: /account/i })).toBeInTheDocument();
    });
  });

  describe('menu button', () => {
    it('calls onMenuClick when menu button is clicked', async () => {
      const user = userEvent.setup();
      const mockOnMenuClick = jest.fn();

      render(<Header onMenuClick={mockOnMenuClick} />);

      await user.click(screen.getByRole('button', { name: /menu/i }));

      expect(mockOnMenuClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('library navigation', () => {
    it('fetches libraries when user is logged in', async () => {
      mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: mockLibraries } });

      render(<Header />);

      await waitFor(() => {
        expect(mockApiClient.getLibraries).toHaveBeenCalled();
      });
    });

    it('does not fetch libraries when user is not logged in', () => {
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
        isAuthenticated: false,
        needsSetup: false,
        login: jest.fn(),
        setup: jest.fn(),
        logout: mockLogout,
      });

      render(<Header />);

      expect(mockApiClient.getLibraries).not.toHaveBeenCalled();
    });

    it('displays library buttons after fetching', async () => {
      mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: mockLibraries } });

      render(<Header />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Movies' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'TV Shows' })).toBeInTheDocument();
      });
    });

    it('navigates to library when library button is clicked', async () => {
      mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: mockLibraries } });
      const user = userEvent.setup();

      render(<Header />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Movies' })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Movies' }));

      expect(mockSetActiveLibrary).toHaveBeenCalledWith('lib-1');
      expect(mockNavigate).toHaveBeenCalledWith('/library/lib-1');
    });

    it('highlights active library', async () => {
      mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: mockLibraries } });
      mockUseActiveLibrary.mockReturnValue({
        activeLibraryId: 'lib-1',
        setActiveLibrary: mockSetActiveLibrary,
      });

      render(<Header />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Movies' })).toBeInTheDocument();
      });

      // The active library button should have bold font weight (MUI uses 700 for bold)
      const moviesButton = screen.getByRole('button', { name: 'Movies' });
      expect(moviesButton).toHaveStyle({ fontWeight: 700 });
    });
  });

  describe('account menu', () => {
    it('opens account menu when account button is clicked', async () => {
      const user = userEvent.setup();

      render(<Header />);

      await user.click(screen.getByRole('button', { name: /account/i }));

      expect(screen.getByRole('menuitem', { name: /logout/i })).toBeInTheDocument();
    });

    it('shows user name in menu when logged in', async () => {
      const user = userEvent.setup();

      render(<Header />);

      await user.click(screen.getByRole('button', { name: /account/i }));

      expect(screen.getByText('testuser')).toBeInTheDocument();
    });

    it('calls logout and navigates to /login when logout is clicked', async () => {
      const user = userEvent.setup();

      render(<Header />);

      await user.click(screen.getByRole('button', { name: /account/i }));
      await user.click(screen.getByRole('menuitem', { name: /logout/i }));

      expect(mockLogout).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });

    it('closes menu when logout is clicked', async () => {
      const user = userEvent.setup();

      render(<Header />);

      await user.click(screen.getByRole('button', { name: /account/i }));
      await user.click(screen.getByRole('menuitem', { name: /logout/i }));

      // Menu should be closed (menuitem should not be visible)
      await waitFor(() => {
        expect(screen.queryByRole('menuitem', { name: /logout/i })).not.toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('handles API error gracefully', async () => {
      mockApiClient.getLibraries.mockResolvedValue({
        error: 'Failed to fetch libraries',
      });

      // Should not throw
      render(<Header />);

      await waitFor(() => {
        expect(mockApiClient.getLibraries).toHaveBeenCalled();
      });

      // Give time for any state updates to process
      await waitFor(() => {
        // No library buttons should be shown
        expect(screen.queryByRole('button', { name: 'Movies' })).not.toBeInTheDocument();
      });
    });
  });
});
