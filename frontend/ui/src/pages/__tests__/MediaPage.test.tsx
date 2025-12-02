import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { MediaPage } from '../MediaPage';
import { apiClient } from '../../api/client';
import type { Media } from '../../api/client';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    getMedia: jest.fn(),
    deleteMedia: jest.fn(),
    refreshMediaMetadata: jest.fn(),
    refreshMediaImages: jest.fn(),
    getImageUrl: jest.fn((id: string) => `http://localhost/api/images/${id}`),
  },
}));

// Mock useParams and useNavigate
let mockMediaId: string | undefined = 'media-123';
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ mediaId: mockMediaId }),
  useNavigate: () => mockNavigate,
}));

// Mock useAuth - default to Admin user
let mockUser: { id: string; name: string; role: 'Admin' | 'Editor' | 'Viewer' } = { id: 'user-1', name: 'Admin', role: 'Admin' };
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

// Mock ImagesDialog
jest.mock('../../components/ImagesDialog', () => ({
  ImagesDialog: jest.fn(({ open, onClose, title }) =>
    open ? (
      <div data-testid="images-dialog" data-title={title}>
        <button onClick={onClose} data-testid="images-dialog-close">Close</button>
      </div>
    ) : null
  ),
}));

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

// Mock video media data - using type assertion for extended properties the component expects
const mockVideoMedia = {
  id: 'media-123',
  name: 'The Matrix',
  path: '/media/movies/the-matrix.mp4',
  duration: 8160,
  type: 'Video' as const,
  thumbnails: null,
  collectionId: 'col-1',
  collection: {
    id: 'col-1',
    name: 'The Matrix Collection',
    collectionType: 'Film' as const,
    images: [],
    library: {
      id: 'lib-1',
      name: 'Movies',
    },
  },
  videoDetails: {
    id: 'vd-1',
    mediaId: 'media-123',
    description: 'A computer hacker learns about the true nature of reality.',
    releaseDate: '1999-03-31',
    rating: 'R',
    showName: null,
    season: null,
    episode: null,
    credits: [
      { id: 'cr-1', name: 'Keanu Reeves', role: 'Neo', creditType: 'Actor' as const, order: 1, personId: 'person-1', person: { id: 'person-1', images: [] } },
      { id: 'cr-2', name: 'Laurence Fishburne', role: 'Morpheus', creditType: 'Actor' as const, order: 2, personId: 'person-2', person: null },
      { id: 'cr-3', name: 'Lana Wachowski', role: null, creditType: 'Director' as const, order: null, personId: null },
      { id: 'cr-4', name: 'Lilly Wachowski', role: null, creditType: 'Writer' as const, order: null, personId: null },
    ],
  },
  audioDetails: null,
  streams: [],
  images: [
    {
      id: 'img-1',
      mediaId: 'media-123',
      collectionId: null,
      personId: null,
      showCreditId: null,
      creditId: null,
      imageType: 'Poster' as const,
      path: '/images/matrix.jpg',
      width: 800,
      height: 1200,
      format: 'jpeg',
      fileSize: null,
      sourceUrl: null,
      scraperId: null,
      isPrimary: true,
      createdAt: '',
      updatedAt: '',
    },
  ],
  createdAt: '',
  updatedAt: '',
} as Media;

// Mock TV episode media
const mockTvEpisodeMedia = {
  ...mockVideoMedia,
  id: 'media-tv-123',
  name: 'Pilot',
  videoDetails: {
    id: 'vd-2',
    mediaId: 'media-tv-123',
    description: 'The first episode.',
    releaseDate: '2008-01-20',
    rating: 'TV-MA',
    showName: 'Breaking Bad',
    season: 1,
    episode: 1,
    credits: [],
  },
  collection: {
    id: 'col-season',
    name: 'Season 1',
    collectionType: 'Season' as const,
    images: [],
    parent: {
      id: 'col-show',
      name: 'Breaking Bad',
      collectionType: 'Show' as const,
    },
    library: {
      id: 'lib-tv',
      name: 'TV Shows',
    },
  },
} as Media;

// Mock audio media
const mockAudioMedia = {
  ...mockVideoMedia,
  id: 'media-audio-123',
  name: 'Bohemian Rhapsody',
  type: 'Audio' as const,
  duration: 354,
  videoDetails: null,
  audioDetails: {
    id: 'ad-1',
    mediaId: 'media-audio-123',
    artist: 'Queen',
    albumArtist: null,
    album: 'A Night at the Opera',
    track: 11,
    disc: 1,
    year: 1975,
    genre: 'Rock',
  },
  images: [],
} as Media;

describe('MediaPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMediaId = 'media-123';
    mockUser = { id: 'user-1', name: 'Admin', role: 'Admin' };
    mockApiClient.getMedia.mockResolvedValue({ data: { media: mockVideoMedia } });
  });

  describe('loading state', () => {
    it('shows loading spinner while fetching', () => {
      mockApiClient.getMedia.mockImplementation(() => new Promise(() => {}));

      render(<MediaPage />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('hides loading spinner after data loads', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows error message when fetch fails', async () => {
      mockApiClient.getMedia.mockResolvedValue({ error: 'Failed to load media' });

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load media')).toBeInTheDocument();
      });
    });

    it('shows not found message when media is missing', async () => {
      // When data is missing entirely, the component shows not found alert
      mockApiClient.getMedia.mockResolvedValue({ data: undefined as unknown as { media: Media } });

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });
  });

  describe('video media rendering', () => {
    it('shows media title', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'The Matrix' })).toBeInTheDocument();
      });
    });

    it('shows media description', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByText(/computer hacker learns/i)).toBeInTheDocument();
      });
    });

    it('shows play button', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
      });
    });

    it('shows duration chip', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        // Duration 8160 seconds = 2 hours 16 minutes
        expect(screen.getByText(/2h.*16m/)).toBeInTheDocument();
      });
    });

    it('shows rating chip', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByText('R')).toBeInTheDocument();
      });
    });

    it('shows release year chip', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByText('1999')).toBeInTheDocument();
      });
    });

    it('shows Movie chip for film media', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByText('Movie')).toBeInTheDocument();
      });
    });

    it('shows cast and crew section', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getAllByText(/cast & crew/i).length).toBeGreaterThan(0);
      });
    });

    it('shows director', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        // Director name appears in both the summary section and the credits grid
        expect(screen.getAllByText('Lana Wachowski').length).toBeGreaterThan(0);
      });
    });

    it('shows writer', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        // Writer name appears in both the summary section and the credits grid
        expect(screen.getAllByText('Lilly Wachowski').length).toBeGreaterThan(0);
      });
    });

    it('shows cast members with roles', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        // Cast members appear in the credits grid
        expect(screen.getAllByText('Keanu Reeves').length).toBeGreaterThan(0);
      });
    });
  });

  describe('TV episode rendering', () => {
    beforeEach(() => {
      mockApiClient.getMedia.mockResolvedValue({ data: { media: mockTvEpisodeMedia } });
    });

    it('shows formatted episode title', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Breaking Bad - S01E01/i })).toBeInTheDocument();
      });
    });

    it('shows episode name as subtitle', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        // "Pilot" appears in the subtitle and breadcrumbs
        expect(screen.getAllByText('Pilot').length).toBeGreaterThan(0);
      });
    });

    it('shows TV Episode chip', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByText('TV Episode')).toBeInTheDocument();
      });
    });
  });

  describe('audio media rendering', () => {
    beforeEach(() => {
      mockApiClient.getMedia.mockResolvedValue({ data: { media: mockAudioMedia } });
    });

    it('shows audio title', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Bohemian Rhapsody' })).toBeInTheDocument();
      });
    });

    it('shows Audio chip', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByText('Audio')).toBeInTheDocument();
      });
    });

    it('shows artist', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByText('Queen')).toBeInTheDocument();
      });
    });

    it('shows album', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByText('A Night at the Opera')).toBeInTheDocument();
      });
    });

    it('shows track number', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByText('1-11')).toBeInTheDocument();
      });
    });

    it('shows genre chip', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByText('Rock')).toBeInTheDocument();
      });
    });

    it('shows year chip', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByText('1975')).toBeInTheDocument();
      });
    });
  });

  describe('breadcrumbs', () => {
    it('shows library in breadcrumbs', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByText('Movies')).toBeInTheDocument();
      });
    });

    it('shows collection in breadcrumbs', async () => {
      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByText('The Matrix Collection')).toBeInTheDocument();
      });
    });

    it('navigates to library when breadcrumb clicked', async () => {
      const user = userEvent.setup();

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByText('Movies')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Movies'));

      expect(mockNavigate).toHaveBeenCalledWith('/library/lib-1');
    });

    it('navigates to collection when breadcrumb clicked', async () => {
      const user = userEvent.setup();

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByText('The Matrix Collection')).toBeInTheDocument();
      });

      await user.click(screen.getByText('The Matrix Collection'));

      expect(mockNavigate).toHaveBeenCalledWith('/collection/col-1');
    });

    it('shows parent collection in TV episode breadcrumbs', async () => {
      mockApiClient.getMedia.mockResolvedValue({ data: { media: mockTvEpisodeMedia } });

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByText('TV Shows')).toBeInTheDocument();
        expect(screen.getByText('Breaking Bad')).toBeInTheDocument();
        expect(screen.getByText('Season 1')).toBeInTheDocument();
      });
    });
  });

  describe('navigation', () => {
    it('navigates to play page when play button clicked', async () => {
      const user = userEvent.setup();

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /play/i }));

      expect(mockNavigate).toHaveBeenCalledWith('/play/media-123');
    });

    it('navigates to person page when credit clicked', async () => {
      const user = userEvent.setup();

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByText('Keanu Reeves')).toBeInTheDocument();
      });

      // Find the card with Keanu Reeves and click it
      const keanuCard = screen.getByText('Keanu Reeves').closest('button');
      if (keanuCard) {
        await user.click(keanuCard);
        expect(mockNavigate).toHaveBeenCalledWith('/person/person-1');
      }
    });
  });

  describe('options menu', () => {
    it('opens menu when more button clicked', async () => {
      const user = userEvent.setup();

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /more options/i }));

      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('shows Images option in menu', async () => {
      const user = userEvent.setup();

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /more options/i }));

      // Look for the Images menu item (exact match, not "Refresh images")
      expect(screen.getByRole('menuitem', { name: 'Images' })).toBeInTheDocument();
    });

    it('opens images dialog when Images clicked', async () => {
      const user = userEvent.setup();

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /more options/i }));
      await user.click(screen.getByRole('menuitem', { name: 'Images' }));

      expect(screen.getByTestId('images-dialog')).toBeInTheDocument();
    });

    it('closes images dialog', async () => {
      const user = userEvent.setup();

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /more options/i }));
      await user.click(screen.getByRole('menuitem', { name: 'Images' }));

      expect(screen.getByTestId('images-dialog')).toBeInTheDocument();

      await user.click(screen.getByTestId('images-dialog-close'));

      expect(screen.queryByTestId('images-dialog')).not.toBeInTheDocument();
    });
  });

  describe('admin actions', () => {
    it('shows refresh metadata option for admin', async () => {
      const user = userEvent.setup();

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /more options/i }));

      expect(screen.getByText(/refresh metadata/i)).toBeInTheDocument();
    });

    it('shows refresh images option for admin', async () => {
      const user = userEvent.setup();

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /more options/i }));

      expect(screen.getByText(/refresh images/i)).toBeInTheDocument();
    });

    it('shows delete option for admin', async () => {
      const user = userEvent.setup();

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /more options/i }));

      expect(screen.getByText(/delete/i)).toBeInTheDocument();
    });

    it('calls refresh metadata API when clicked', async () => {
      const user = userEvent.setup();
      mockApiClient.refreshMediaMetadata.mockResolvedValue({});

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /more options/i }));
      await user.click(screen.getByText(/refresh metadata/i));

      expect(mockApiClient.refreshMediaMetadata).toHaveBeenCalledWith('media-123');
    });

    it('calls refresh images API when clicked', async () => {
      const user = userEvent.setup();
      mockApiClient.refreshMediaImages.mockResolvedValue({});

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /more options/i }));
      await user.click(screen.getByText(/refresh images/i));

      expect(mockApiClient.refreshMediaImages).toHaveBeenCalledWith('media-123');
    });

    it('hides admin options for viewer', async () => {
      mockUser = { id: 'user-2', name: 'Viewer', role: 'Viewer' as const };
      const user = userEvent.setup();

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /more options/i }));

      expect(screen.queryByText(/refresh metadata/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/delete/i)).not.toBeInTheDocument();
    });

    it('shows admin options for editor', async () => {
      mockUser = { id: 'user-2', name: 'Editor', role: 'Editor' as const };
      const user = userEvent.setup();

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /more options/i }));

      expect(screen.getByText(/refresh metadata/i)).toBeInTheDocument();
      expect(screen.getByText(/delete/i)).toBeInTheDocument();
    });
  });

  describe('delete flow', () => {
    it('opens delete dialog when delete clicked', async () => {
      const user = userEvent.setup();

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /more options/i }));
      await user.click(screen.getByText(/delete/i));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText(/delete media/i)).toBeInTheDocument();
    });

    it('closes delete dialog when cancelled', async () => {
      const user = userEvent.setup();

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /more options/i }));
      await user.click(screen.getByText(/delete/i));

      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('deletes media and navigates to collection', async () => {
      const user = userEvent.setup();
      mockApiClient.deleteMedia.mockResolvedValue({});

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /more options/i }));
      await user.click(screen.getByText(/delete/i));

      // Click the Delete button in the dialog (there are now two "Delete" texts)
      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      await user.click(deleteButtons[deleteButtons.length - 1]);

      expect(mockApiClient.deleteMedia).toHaveBeenCalledWith('media-123');

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/collection/col-1');
      });
    });

    it('shows error when delete fails', async () => {
      const user = userEvent.setup();
      mockApiClient.deleteMedia.mockResolvedValue({ error: 'Delete failed' });

      render(<MediaPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /more options/i }));
      await user.click(screen.getByText(/delete/i));

      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      await user.click(deleteButtons[deleteButtons.length - 1]);

      await waitFor(() => {
        expect(screen.getByText('Delete failed')).toBeInTheDocument();
      });
    });
  });

  describe('no mediaId', () => {
    it('does not fetch when mediaId is undefined', () => {
      mockMediaId = undefined;

      render(<MediaPage />);

      expect(mockApiClient.getMedia).not.toHaveBeenCalled();
    });
  });
});
