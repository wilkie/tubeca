import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { Sidebar } from '../Sidebar';
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

// Mock useNavigate and useLocation
const mockNavigate = jest.fn();
let mockPathname = '/';
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: mockPathname }),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseActiveLibrary = useActiveLibrary as jest.MockedFunction<typeof useActiveLibrary>;
const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

// Mock library data
const mockLibraries = [
  { id: 'lib-1', name: 'Movies', path: '/media/movies', libraryType: 'Film' as const, watchForChanges: false, createdAt: '', updatedAt: '', groups: [] },
  { id: 'lib-2', name: 'TV Shows', path: '/media/tv', libraryType: 'Television' as const, watchForChanges: false, createdAt: '', updatedAt: '', groups: [] },
  { id: 'lib-3', name: 'Music', path: '/media/music', libraryType: 'Music' as const, watchForChanges: false, createdAt: '', updatedAt: '', groups: [] },
];

describe('Sidebar', () => {
  const mockOnClose = jest.fn();
  const mockSetActiveLibrary = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname = '/';

    // Default: admin user
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', name: 'admin', role: 'Admin', groups: [], createdAt: '', updatedAt: '' },
      isLoading: false,
      isAuthenticated: true,
      needsSetup: false,
      login: jest.fn(),
      setup: jest.fn(),
      logout: jest.fn(),
    });

    mockUseActiveLibrary.mockReturnValue({
      activeLibraryId: null,
      setActiveLibrary: mockSetActiveLibrary,
    });

    // Default: return empty libraries (never resolving for tests that don't need them)
    mockApiClient.getLibraries.mockImplementation(() => new Promise(() => {}));
  });

  describe('rendering', () => {
    it('renders libraries section header when open', () => {
      render(<Sidebar open={true} onClose={mockOnClose} />);

      // "Libraries" appears twice - as section header and admin link
      const librariesElements = screen.getAllByText('Libraries');
      expect(librariesElements.length).toBeGreaterThanOrEqual(1);
    });

    it('shows no libraries message when library list is empty', () => {
      mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: [] } });

      render(<Sidebar open={true} onClose={mockOnClose} />);

      expect(screen.getByText(/no libraries available/i)).toBeInTheDocument();
    });

    it('renders administration section for admin users', () => {
      render(<Sidebar open={true} onClose={mockOnClose} />);

      expect(screen.getByText('Administration')).toBeInTheDocument();
      // "Libraries" appears as both section header and admin link
      expect(screen.getAllByText('Libraries').length).toBe(2);
      expect(screen.getByText('Users')).toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('hides administration section for non-admin users', () => {
      mockUseAuth.mockReturnValue({
        user: { id: 'user-2', name: 'viewer', role: 'Viewer', groups: [], createdAt: '', updatedAt: '' },
        isLoading: false,
        isAuthenticated: true,
        needsSetup: false,
        login: jest.fn(),
        setup: jest.fn(),
        logout: jest.fn(),
      });

      render(<Sidebar open={true} onClose={mockOnClose} />);

      expect(screen.queryByText('Administration')).not.toBeInTheDocument();
      expect(screen.queryByText('Users')).not.toBeInTheDocument();
      expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    });
  });

  describe('library fetching', () => {
    it('fetches libraries when open and user is logged in', async () => {
      mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: mockLibraries } });

      render(<Sidebar open={true} onClose={mockOnClose} />);

      await waitFor(() => {
        expect(mockApiClient.getLibraries).toHaveBeenCalled();
      });
    });

    it('does not fetch libraries when closed', () => {
      render(<Sidebar open={false} onClose={mockOnClose} />);

      expect(mockApiClient.getLibraries).not.toHaveBeenCalled();
    });

    it('does not fetch libraries when no user', () => {
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
        isAuthenticated: false,
        needsSetup: false,
        login: jest.fn(),
        setup: jest.fn(),
        logout: jest.fn(),
      });

      render(<Sidebar open={true} onClose={mockOnClose} />);

      expect(mockApiClient.getLibraries).not.toHaveBeenCalled();
    });

    it('displays library buttons after fetching', async () => {
      mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: mockLibraries } });

      render(<Sidebar open={true} onClose={mockOnClose} />);

      await waitFor(() => {
        expect(screen.getByText('Movies')).toBeInTheDocument();
        expect(screen.getByText('TV Shows')).toBeInTheDocument();
        expect(screen.getByText('Music')).toBeInTheDocument();
      });
    });
  });

  describe('library navigation', () => {
    it('navigates to library when clicked', async () => {
      const user = userEvent.setup();
      mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: mockLibraries } });

      render(<Sidebar open={true} onClose={mockOnClose} />);

      await waitFor(() => {
        expect(screen.getByText('Movies')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Movies'));

      expect(mockNavigate).toHaveBeenCalledWith('/library/lib-1');
    });

    it('sets active library when navigating', async () => {
      const user = userEvent.setup();
      mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: mockLibraries } });

      render(<Sidebar open={true} onClose={mockOnClose} />);

      await waitFor(() => {
        expect(screen.getByText('Movies')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Movies'));

      expect(mockSetActiveLibrary).toHaveBeenCalledWith('lib-1');
    });

    it('calls onClose after library navigation', async () => {
      const user = userEvent.setup();
      mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: mockLibraries } });

      render(<Sidebar open={true} onClose={mockOnClose} />);

      await waitFor(() => {
        expect(screen.getByText('Movies')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Movies'));

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('displays correct icon for Film library', async () => {
      mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: mockLibraries } });

      render(<Sidebar open={true} onClose={mockOnClose} />);

      await waitFor(() => {
        expect(screen.getByText('Movies')).toBeInTheDocument();
      });

      expect(screen.getByTestId('MovieIcon')).toBeInTheDocument();
    });

    it('displays correct icon for Television library', async () => {
      mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: mockLibraries } });

      render(<Sidebar open={true} onClose={mockOnClose} />);

      await waitFor(() => {
        expect(screen.getByText('TV Shows')).toBeInTheDocument();
      });

      expect(screen.getByTestId('TvIcon')).toBeInTheDocument();
    });

    it('displays correct icon for Music library', async () => {
      mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: mockLibraries } });

      render(<Sidebar open={true} onClose={mockOnClose} />);

      await waitFor(() => {
        expect(screen.getByText('Music')).toBeInTheDocument();
      });

      expect(screen.getByTestId('MusicNoteIcon')).toBeInTheDocument();
    });
  });

  describe('admin navigation', () => {
    it('navigates to libraries admin page', async () => {
      const user = userEvent.setup();

      render(<Sidebar open={true} onClose={mockOnClose} />);

      // Find the Libraries link in admin section (not the section header)
      const adminLinks = screen.getAllByText('Libraries');
      const adminLibrariesLink = adminLinks[adminLinks.length - 1]; // Get the admin one
      await user.click(adminLibrariesLink);

      expect(mockNavigate).toHaveBeenCalledWith('/admin/libraries');
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('navigates to users admin page', async () => {
      const user = userEvent.setup();

      render(<Sidebar open={true} onClose={mockOnClose} />);

      await user.click(screen.getByText('Users'));

      expect(mockNavigate).toHaveBeenCalledWith('/admin/users');
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('navigates to settings page', async () => {
      const user = userEvent.setup();

      render(<Sidebar open={true} onClose={mockOnClose} />);

      await user.click(screen.getByText('Settings'));

      expect(mockNavigate).toHaveBeenCalledWith('/settings');
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('selection state', () => {
    it('highlights current library in navigation', async () => {
      mockPathname = '/library/lib-2';
      mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: mockLibraries } });

      render(<Sidebar open={true} onClose={mockOnClose} />);

      await waitFor(() => {
        expect(screen.getByText('TV Shows')).toBeInTheDocument();
      });

      // The TV Shows button should be selected
      const tvShowsButton = screen.getByText('TV Shows').closest('[role="button"]');
      expect(tvShowsButton).toHaveClass('Mui-selected');
    });

    it('highlights current admin page', () => {
      mockPathname = '/admin/users';

      render(<Sidebar open={true} onClose={mockOnClose} />);

      const usersButton = screen.getByText('Users').closest('[role="button"]');
      expect(usersButton).toHaveClass('Mui-selected');
    });

    it('highlights settings page', () => {
      mockPathname = '/settings';

      render(<Sidebar open={true} onClose={mockOnClose} />);

      const settingsButton = screen.getByText('Settings').closest('[role="button"]');
      expect(settingsButton).toHaveClass('Mui-selected');
    });
  });

  describe('drawer behavior', () => {
    it('calls onClose when drawer backdrop is clicked', async () => {
      const user = userEvent.setup();

      render(<Sidebar open={true} onClose={mockOnClose} />);

      // Click the backdrop
      const backdrop = document.querySelector('.MuiBackdrop-root');
      if (backdrop) {
        await user.click(backdrop);
        expect(mockOnClose).toHaveBeenCalled();
      }
    });
  });
});
