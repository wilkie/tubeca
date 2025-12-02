import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { LibraryDialog } from '../LibraryDialog';
import { apiClient } from '../../api/client';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    createLibrary: jest.fn(),
    updateLibrary: jest.fn(),
  },
}));

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('LibraryDialog', () => {
  const mockOnClose = jest.fn();
  const mockOnSave = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Create mode', () => {
    it('renders create dialog with empty form', () => {
      render(
        <LibraryDialog
          open={true}
          library={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByLabelText(/name/i)).toHaveValue('');
      expect(screen.getByLabelText(/path/i)).toHaveValue('');
    });

    it('shows validation error when name is empty', async () => {
      const user = userEvent.setup();

      render(
        <LibraryDialog
          open={true}
          library={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.type(screen.getByLabelText(/path/i), '/media/movies');
      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(mockApiClient.createLibrary).not.toHaveBeenCalled();
    });

    it('shows validation error when path is empty', async () => {
      const user = userEvent.setup();

      render(
        <LibraryDialog
          open={true}
          library={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.type(screen.getByLabelText(/name/i), 'Movies');
      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(mockApiClient.createLibrary).not.toHaveBeenCalled();
    });

    it('creates library successfully', async () => {
      const user = userEvent.setup();
      mockApiClient.createLibrary.mockResolvedValue({
        data: {
          library: {
            id: '1',
            name: 'Movies',
            path: '/media/movies',
            libraryType: 'Film',
            watchForChanges: false,
            createdAt: '',
            updatedAt: '',
            groups: [],
          },
        },
      });

      render(
        <LibraryDialog
          open={true}
          library={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.type(screen.getByLabelText(/name/i), 'Movies');
      await user.type(screen.getByLabelText(/path/i), '/media/movies');
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockApiClient.createLibrary).toHaveBeenCalledWith({
          name: 'Movies',
          path: '/media/movies',
          libraryType: 'Film',
          watchForChanges: false,
        });
      });

      expect(mockOnSave).toHaveBeenCalled();
    });

    it('displays API error on create failure', async () => {
      const user = userEvent.setup();
      mockApiClient.createLibrary.mockResolvedValue({ error: 'Path does not exist' });

      render(
        <LibraryDialog
          open={true}
          library={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.type(screen.getByLabelText(/name/i), 'Movies');
      await user.type(screen.getByLabelText(/path/i), '/invalid/path');
      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(await screen.findByText(/path does not exist/i)).toBeInTheDocument();
      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('calls onClose when cancel is clicked', async () => {
      const user = userEvent.setup();

      render(
        <LibraryDialog
          open={true}
          library={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('allows selecting different library types', async () => {
      const user = userEvent.setup();
      mockApiClient.createLibrary.mockResolvedValue({
        data: {
          library: {
            id: '1',
            name: 'TV Shows',
            path: '/media/tv',
            libraryType: 'Television',
            watchForChanges: true,
            createdAt: '',
            updatedAt: '',
            groups: [],
          },
        },
      });

      render(
        <LibraryDialog
          open={true}
          library={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.type(screen.getByLabelText(/name/i), 'TV Shows');
      await user.type(screen.getByLabelText(/path/i), '/media/tv');

      // Open dropdown and select Television
      // MUI Select uses combobox role
      await user.click(screen.getByRole('combobox'));
      await user.click(screen.getByRole('option', { name: /television/i }));

      // Enable watch for changes (MUI Switch uses role="switch")
      await user.click(screen.getByRole('switch'));

      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockApiClient.createLibrary).toHaveBeenCalledWith({
          name: 'TV Shows',
          path: '/media/tv',
          libraryType: 'Television',
          watchForChanges: true,
        });
      });
    });
  });

  describe('Edit mode', () => {
    const existingLibrary = {
      id: 'lib-1',
      name: 'Movies',
      path: '/media/movies',
      libraryType: 'Film' as const,
      watchForChanges: false,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      groups: [],
    };

    it('renders edit dialog with populated form', () => {
      render(
        <LibraryDialog
          open={true}
          library={existingLibrary}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      expect(screen.getByLabelText(/name/i)).toHaveValue('Movies');
      expect(screen.getByLabelText(/path/i)).toHaveValue('/media/movies');
    });

    it('updates library successfully', async () => {
      const user = userEvent.setup();
      mockApiClient.updateLibrary.mockResolvedValue({
        data: { library: { ...existingLibrary, name: 'Updated Movies' } },
      });

      render(
        <LibraryDialog
          open={true}
          library={existingLibrary}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      const nameInput = screen.getByLabelText(/name/i);
      await user.clear(nameInput);
      await user.type(nameInput, 'Updated Movies');
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockApiClient.updateLibrary).toHaveBeenCalledWith('lib-1', {
          name: 'Updated Movies',
          path: '/media/movies',
          libraryType: 'Film',
          watchForChanges: false,
        });
      });

      expect(mockOnSave).toHaveBeenCalled();
    });
  });

  describe('Dialog visibility', () => {
    it('does not render when open is false', () => {
      render(
        <LibraryDialog
          open={false}
          library={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
