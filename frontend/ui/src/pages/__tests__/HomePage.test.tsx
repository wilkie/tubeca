import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { HomePage } from '../HomePage';
import { apiClient } from '../../api/client';
import type { Library } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useActiveLibrary } from '../../context/ActiveLibraryContext';

jest.mock('../../api/client', () => ({
  apiClient: {
    getLibraries: jest.fn(),
    getContinueWatching: jest.fn(),
    getImageUrl: jest.fn((id: string) => `/api/images/${id}/file`),
  },
}));

jest.mock('../../context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../context/ActiveLibraryContext', () => ({
  useActiveLibrary: jest.fn(),
}));

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseActiveLibrary = useActiveLibrary as jest.MockedFunction<typeof useActiveLibrary>;

const libraries: Library[] = [
  {
    id: 'lib-1',
    name: 'Movies',
    path: '/media/movies',
    libraryType: 'Film',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  } as Library,
  {
    id: 'lib-2',
    name: 'Shows',
    path: '/media/shows',
    libraryType: 'Television',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  } as Library,
];

function mockUser(role: 'Admin' | 'Editor' | 'Viewer') {
  mockUseAuth.mockReturnValue({
    user: { id: 'u1', name: 'Test', role },
    isLoading: false,
    isAuthenticated: true,
    needsSetup: false,
    login: jest.fn(),
    setup: jest.fn(),
    logout: jest.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}

describe('HomePage', () => {
  const mockSetActiveLibrary = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser('Viewer');
    mockApiClient.getContinueWatching.mockResolvedValue({ data: { items: [] } });
    mockUseActiveLibrary.mockReturnValue({
      activeLibraryId: null,
      setActiveLibrary: mockSetActiveLibrary,
    } as unknown as ReturnType<typeof useActiveLibrary>);
  });

  it('shows a spinner while loading', () => {
    mockApiClient.getLibraries.mockReturnValue(new Promise(() => {}));
    render(<HomePage />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('lists the accessible libraries', async () => {
    mockApiClient.getLibraries.mockResolvedValue({ data: { libraries } });
    render(<HomePage />);

    await waitFor(() => {
      expect(screen.getByText('Movies')).toBeInTheDocument();
    });
    expect(screen.getByText('Shows')).toBeInTheDocument();
  });

  it('opens a library when its card is clicked', async () => {
    const user = userEvent.setup();
    mockApiClient.getLibraries.mockResolvedValue({ data: { libraries } });
    render(<HomePage />);

    await user.click(await screen.findByRole('button', { name: 'Shows' }));

    expect(mockSetActiveLibrary).toHaveBeenCalledWith('lib-2');
    expect(mockNavigate).toHaveBeenCalledWith('/library/lib-2');
  });

  it('shows an empty state without the add button for non-admins', async () => {
    mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: [] } });
    render(<HomePage />);

    expect(await screen.findByText(/no libraries/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers admins a shortcut to add a library when there are none', async () => {
    const user = userEvent.setup();
    mockUser('Admin');
    mockApiClient.getLibraries.mockResolvedValue({ data: { libraries: [] } });
    render(<HomePage />);

    await user.click(await screen.findByRole('button', { name: /add a library/i }));

    expect(mockNavigate).toHaveBeenCalledWith('/admin/libraries');
  });

  it('shows an error when loading fails', async () => {
    mockApiClient.getLibraries.mockResolvedValue({ error: 'Network error' });
    render(<HomePage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Network error');
  });

  it('renders a Continue Watching row that resumes playback', async () => {
    const user = userEvent.setup();
    mockApiClient.getLibraries.mockResolvedValue({ data: { libraries } });
    mockApiClient.getContinueWatching.mockResolvedValue({
      data: {
        items: [
          {
            progress: {
              id: 'p1',
              userId: 'u1',
              mediaId: 'm1',
              position: 600,
              duration: 1200,
              completed: false,
              createdAt: '',
              updatedAt: '',
            },
            media: {
              id: 'm1',
              name: 'Pilot',
              path: '/x.mkv',
              duration: 1200,
              type: 'Video',
              thumbnails: null,
              collectionId: 'c1',
              collection: {
                id: 'c1',
                name: 'Season 1',
                collectionType: 'Season',
                images: [],
                parent: { id: 's1', name: 'The Show', collectionType: 'Show', images: [] },
              },
              videoDetails: { season: 1, episode: 1 },
              audioDetails: null,
              images: [],
              createdAt: '',
              updatedAt: '',
            },
          },
        ],
      },
    } as never);
    render(<HomePage />);

    expect(await screen.findByText('Continue Watching')).toBeInTheDocument();
    expect(screen.getByText('The Show · S1E1')).toBeInTheDocument();
    expect(screen.getByText(/left$/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Pilot' }));
    expect(mockNavigate).toHaveBeenCalledWith('/play/m1');
  });

  it('still renders libraries when Continue Watching fails', async () => {
    mockApiClient.getLibraries.mockResolvedValue({ data: { libraries } });
    mockApiClient.getContinueWatching.mockResolvedValue({ error: 'boom' });
    render(<HomePage />);

    expect(await screen.findByText('Movies')).toBeInTheDocument();
    expect(screen.queryByText('Continue Watching')).not.toBeInTheDocument();
  });
});
