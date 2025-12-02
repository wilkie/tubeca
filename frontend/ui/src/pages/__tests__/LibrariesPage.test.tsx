import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { LibrariesPage } from '../LibrariesPage';
import { apiClient } from '../../api/client';
import type { Library } from '../../api/client';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    getLibraries: jest.fn(),
    getLibraryScanStatus: jest.fn(),
    startLibraryScan: jest.fn(),
    cancelLibraryScan: jest.fn(),
    deleteLibrary: jest.fn(),
  },
}));

// Mock LibraryDialog
jest.mock('../../components/LibraryDialog', () => ({
  LibraryDialog: jest.fn(({ open, library, onClose }) =>
    open ? (
      <div data-testid="library-dialog" data-library={library?.name || 'new'}>
        <button onClick={onClose} data-testid="dialog-close">Close</button>
      </div>
    ) : null
  ),
}));

// Mock window.confirm
const mockConfirm = jest.fn();
window.confirm = mockConfirm;

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

// Mock library data
const mockLibraries: Library[] = [
  {
    id: 'lib-1',
    name: 'Movies',
    path: '/media/movies',
    libraryType: 'Film',
    watchForChanges: true,
    groups: [{ id: 'grp-1', name: 'Family' }],
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'lib-2',
    name: 'TV Shows',
    path: '/media/tv',
    libraryType: 'Television',
    watchForChanges: false,
    groups: [],
    createdAt: '',
    updatedAt: '',
  },
];

describe('LibrariesPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockConfirm.mockReturnValue(true);

    // Default mock responses
    mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: mockLibraries } });
    mockApiClient.getLibraryScanStatus.mockResolvedValue({
      data: { status: 'idle' as const, scanning: false, progress: 0 },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('loading state', () => {
    it('shows loading spinner while fetching', () => {
      mockApiClient.getLibraries.mockImplementation(() => new Promise(() => {}));

      render(<LibrariesPage />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('hides loading spinner after data loads', async () => {
      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });
  });

  describe('rendering', () => {
    it('shows page title', async () => {
      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /libraries/i })).toBeInTheDocument();
      });
    });

    it('shows create button', async () => {
      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add library/i })).toBeInTheDocument();
      });
    });

    it('shows error message when fetch fails', async () => {
      mockApiClient.getLibraries.mockResolvedValue({ error: 'Failed to load libraries' });

      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load libraries')).toBeInTheDocument();
      });
    });

    it('shows empty message when no libraries', async () => {
      mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: [] } });

      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByText(/no libraries/i)).toBeInTheDocument();
      });
    });

    it('shows library names in table', async () => {
      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByText('Movies')).toBeInTheDocument();
        expect(screen.getByText('TV Shows')).toBeInTheDocument();
      });
    });

    it('shows library paths', async () => {
      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByText('/media/movies')).toBeInTheDocument();
        expect(screen.getByText('/media/tv')).toBeInTheDocument();
      });
    });

    it('shows groups as chips', async () => {
      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByText('Family')).toBeInTheDocument();
      });
    });

    it('shows all users message for libraries without groups', async () => {
      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByText('All users')).toBeInTheDocument();
      });
    });

    it('shows watch indicator for libraries watching for changes', async () => {
      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByTestId('VisibilityIcon')).toBeInTheDocument();
        expect(screen.getByTestId('VisibilityOffIcon')).toBeInTheDocument();
      });
    });
  });

  describe('create/edit operations', () => {
    it('opens dialog for creating new library', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add library/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /add library/i }));

      expect(screen.getByTestId('library-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('library-dialog')).toHaveAttribute('data-library', 'new');
    });

    it('opens dialog for editing library', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByText('Movies')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByTestId('EditIcon');
      await user.click(editButtons[0].closest('button')!);

      expect(screen.getByTestId('library-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('library-dialog')).toHaveAttribute('data-library', 'Movies');
    });

    it('closes dialog', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add library/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /add library/i }));
      expect(screen.getByTestId('library-dialog')).toBeInTheDocument();

      await user.click(screen.getByTestId('dialog-close'));
      expect(screen.queryByTestId('library-dialog')).not.toBeInTheDocument();
    });
  });

  describe('delete operations', () => {
    it('deletes library when confirmed', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      mockApiClient.deleteLibrary.mockResolvedValue({});

      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByText('Movies')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTestId('DeleteIcon');
      await user.click(deleteButtons[0].closest('button')!);

      expect(mockConfirm).toHaveBeenCalled();
      expect(mockApiClient.deleteLibrary).toHaveBeenCalledWith('lib-1');

      await waitFor(() => {
        expect(screen.queryByText('Movies')).not.toBeInTheDocument();
      });
    });

    it('does not delete when cancelled', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      mockConfirm.mockReturnValue(false);

      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByText('Movies')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTestId('DeleteIcon');
      await user.click(deleteButtons[0].closest('button')!);

      expect(mockConfirm).toHaveBeenCalled();
      expect(mockApiClient.deleteLibrary).not.toHaveBeenCalled();
      expect(screen.getByText('Movies')).toBeInTheDocument();
    });

    it('shows error when delete fails', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      mockApiClient.deleteLibrary.mockResolvedValue({ error: 'Delete failed' });

      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByText('Movies')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTestId('DeleteIcon');
      await user.click(deleteButtons[0].closest('button')!);

      await waitFor(() => {
        expect(screen.getByText('Delete failed')).toBeInTheDocument();
      });
    });
  });

  describe('scan operations', () => {
    it('shows scan button for each library', async () => {
      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByText('Movies')).toBeInTheDocument();
      });

      const refreshButtons = screen.getAllByTestId('RefreshIcon');
      expect(refreshButtons).toHaveLength(2);
    });

    it('starts scan when scan button clicked', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      mockApiClient.startLibraryScan.mockResolvedValue({ data: { message: 'Scan started', jobId: 'job-1' } });

      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByText('Movies')).toBeInTheDocument();
      });

      const refreshButtons = screen.getAllByTestId('RefreshIcon');
      await user.click(refreshButtons[0].closest('button')!);

      expect(mockApiClient.startLibraryScan).toHaveBeenCalledWith('lib-1');
    });

    it('shows progress when scanning', async () => {
      // Set up mock before render - only lib-1 is scanning
      mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: mockLibraries } });
      mockApiClient.getLibraryScanStatus.mockImplementation(async (id) => {
        if (id === 'lib-1') {
          return { data: { status: 'active' as const, scanning: true, progress: 50 } };
        }
        return { data: { status: 'idle' as const, scanning: false, progress: 0 } };
      });

      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByText('50%')).toBeInTheDocument();
      });
    });

    it('shows cancel button when scanning', async () => {
      mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: mockLibraries } });
      mockApiClient.getLibraryScanStatus.mockImplementation(async (id) => {
        if (id === 'lib-1') {
          return { data: { status: 'active' as const, scanning: true, progress: 50 } };
        }
        return { data: { status: 'idle' as const, scanning: false, progress: 0 } };
      });

      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByTestId('StopIcon')).toBeInTheDocument();
      });
    });

    it('cancels scan when cancel button clicked', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: mockLibraries } });
      mockApiClient.getLibraryScanStatus.mockImplementation(async (id) => {
        if (id === 'lib-1') {
          return { data: { status: 'active' as const, scanning: true, progress: 50 } };
        }
        return { data: { status: 'idle' as const, scanning: false, progress: 0 } };
      });
      mockApiClient.cancelLibraryScan.mockResolvedValue({ data: { message: 'Cancelled', wasActive: true } });

      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByTestId('StopIcon')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('StopIcon').closest('button')!);

      expect(mockApiClient.cancelLibraryScan).toHaveBeenCalledWith('lib-1');
    });

    it('shows completed status after scan', async () => {
      mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: mockLibraries } });
      mockApiClient.getLibraryScanStatus.mockImplementation(async (id) => {
        if (id === 'lib-1') {
          return {
            data: {
              status: 'completed' as const,
              scanning: false,
              progress: 100,
              result: { filesFound: 15, filesProcessed: 10, collectionsCreated: 5, mediaCreated: 10, errors: [] },
            },
          };
        }
        return { data: { status: 'idle' as const, scanning: false, progress: 0 } };
      });

      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByText(/complete/i)).toBeInTheDocument();
      });
    });

    it('shows failed status when scan fails', async () => {
      mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: mockLibraries } });
      mockApiClient.getLibraryScanStatus.mockImplementation(async (id) => {
        if (id === 'lib-1') {
          return {
            data: {
              status: 'failed' as const,
              scanning: false,
              progress: 0,
              failedReason: 'Path not found',
            },
          };
        }
        return { data: { status: 'idle' as const, scanning: false, progress: 0 } };
      });

      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByText(/failed/i)).toBeInTheDocument();
      });
    });

    it('disables delete button while scanning', async () => {
      mockApiClient.getLibraryScanStatus.mockImplementation(async (id) => {
        if (id === 'lib-1') {
          return { data: { status: 'active' as const, scanning: true, progress: 50 } };
        }
        return { data: { status: 'idle' as const, scanning: false, progress: 0 } };
      });

      render(<LibrariesPage />);

      await waitFor(() => {
        expect(screen.getByText('Movies')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTestId('DeleteIcon');
      expect(deleteButtons[0].closest('button')).toBeDisabled();
      expect(deleteButtons[1].closest('button')).not.toBeDisabled();
    });
  });

  describe('error dismissal', () => {
    it('can dismiss error alert', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      mockApiClient.getLibraries.mockResolvedValue({ error: 'Failed to load' });

      render(<LibrariesPage />);

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
