import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { SearchPage } from '../SearchPage';
import { apiClient } from '../../api/client';
import type { Collection, Media, Image } from '../../api/client';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    search: jest.fn(),
    getImageUrl: jest.fn((id) => `http://localhost/api/images/${id}`),
  },
}));

// Mock useNavigate and useSearchParams
const mockNavigate = jest.fn();
const mockSetSearchParams = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useSearchParams: () => [mockSearchParams, mockSetSearchParams],
}));

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

// Helper to create minimal Image mock
const createMockImage = (id: string, imageType: string): Image =>
  ({ id, imageType, isPrimary: true } as unknown as Image);

// Mock data - use partial types for complex nested objects
const mockCollections: Partial<Collection>[] = [
  {
    id: 'col-1',
    name: 'The Matrix',
    collectionType: 'Film',
    libraryId: 'lib-1',
    parentId: null,
    createdAt: '',
    updatedAt: '',
    images: [createMockImage('img-1', 'Poster')],
    library: { id: 'lib-1', name: 'Movies', libraryType: 'Film' },
    filmDetails: { contentRating: 'R' } as Collection['filmDetails'],
    keywords: [{ id: 'kw-1', name: 'sci-fi' }],
  },
  {
    id: 'col-2',
    name: 'Breaking Bad',
    collectionType: 'Show',
    libraryId: 'lib-2',
    parentId: null,
    createdAt: '',
    updatedAt: '',
    images: [],
    library: { id: 'lib-2', name: 'TV Shows', libraryType: 'Television' },
    keywords: [{ id: 'kw-2', name: 'drama' }],
  },
];

const mockMedia: Partial<Media>[] = [
  {
    id: 'media-1',
    name: 'Pilot',
    type: 'Video',
    path: '/media/pilot.mp4',
    duration: 3600,
    collectionId: 'col-2',
    createdAt: '',
    updatedAt: '',
    images: [createMockImage('img-2', 'Still')],
    videoDetails: { season: 1, episode: 1 } as Media['videoDetails'],
    collection: { id: 'col-2', name: 'Breaking Bad', collectionType: 'Show' } as Media['collection'],
  },
];

describe('SearchPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    mockApiClient.search.mockResolvedValue({
      data: { collections: mockCollections as Collection[], media: mockMedia as Media[] },
    });
  });

  describe('initial state', () => {
    it('shows page title', () => {
      render(<SearchPage />);

      expect(screen.getByRole('heading', { name: /search/i })).toBeInTheDocument();
    });

    it('shows search input', () => {
      render(<SearchPage />);

      expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
    });

    it('does not show results before searching', () => {
      render(<SearchPage />);

      expect(screen.queryByText('Collections')).not.toBeInTheDocument();
      expect(screen.queryByText('Media')).not.toBeInTheDocument();
    });
  });

  describe('search from URL', () => {
    it('performs search when query param is present', async () => {
      mockSearchParams = new URLSearchParams('q=matrix');

      render(<SearchPage />);

      await waitFor(() => {
        expect(mockApiClient.search).toHaveBeenCalledWith('matrix');
      });
    });

    it('shows results after search', async () => {
      mockSearchParams = new URLSearchParams('q=matrix');

      render(<SearchPage />);

      await waitFor(() => {
        expect(screen.getByText('The Matrix')).toBeInTheDocument();
      });
    });
  });

  describe('search interaction', () => {
    it('updates search params on form submit', async () => {
      const user = userEvent.setup();

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'breaking bad');
      await user.keyboard('{Enter}');

      expect(mockSetSearchParams).toHaveBeenCalledWith({ q: 'breaking bad' });
    });

    it('does not search with empty query', async () => {
      const user = userEvent.setup();

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.clear(searchInput);
      await user.keyboard('{Enter}');

      expect(mockSetSearchParams).not.toHaveBeenCalled();
    });
  });

  describe('loading state', () => {
    it('shows loading spinner while searching', async () => {
      mockSearchParams = new URLSearchParams('q=matrix');
      mockApiClient.search.mockImplementation(() => new Promise(() => {}));

      render(<SearchPage />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('hides loading spinner after search completes', async () => {
      mockSearchParams = new URLSearchParams('q=matrix');

      render(<SearchPage />);

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows error message when search fails', async () => {
      mockSearchParams = new URLSearchParams('q=matrix');
      mockApiClient.search.mockResolvedValue({ error: 'Search failed' });

      render(<SearchPage />);

      await waitFor(() => {
        expect(screen.getByText('Search failed')).toBeInTheDocument();
      });
    });
  });

  describe('no results', () => {
    it('shows no results message when nothing found', async () => {
      mockSearchParams = new URLSearchParams('q=nonexistent');
      mockApiClient.search.mockResolvedValue({ data: { collections: [], media: [] } });

      render(<SearchPage />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });
  });

  describe('rendering results', () => {
    beforeEach(() => {
      mockSearchParams = new URLSearchParams('q=test');
    });

    it('shows collections section with count', async () => {
      render(<SearchPage />);

      await waitFor(() => {
        // Translation: "Shows & Movies (2)" - count is part of same text
        expect(screen.getByText(/Shows & Movies \(2\)/)).toBeInTheDocument();
      });
    });

    it('shows media section with count', async () => {
      render(<SearchPage />);

      await waitFor(() => {
        // Translation: "Episodes & Tracks (1)" - count is part of same text
        expect(screen.getByText(/Episodes & Tracks \(1\)/)).toBeInTheDocument();
      });
    });

    it('shows collection names', async () => {
      render(<SearchPage />);

      await waitFor(() => {
        expect(screen.getByText('The Matrix')).toBeInTheDocument();
        expect(screen.getByText('Breaking Bad')).toBeInTheDocument();
      });
    });

    it('shows collection library names', async () => {
      render(<SearchPage />);

      await waitFor(() => {
        expect(screen.getByText('Movies')).toBeInTheDocument();
        expect(screen.getByText('TV Shows')).toBeInTheDocument();
      });
    });

    it('shows media names with episode info', async () => {
      render(<SearchPage />);

      await waitFor(() => {
        expect(screen.getByText('Pilot')).toBeInTheDocument();
        expect(screen.getByText(/Breaking Bad.*S1E1/)).toBeInTheDocument();
      });
    });

    it('shows images for items with images', async () => {
      render(<SearchPage />);

      await waitFor(() => {
        expect(screen.getByAltText('The Matrix')).toHaveAttribute(
          'src',
          'http://localhost/api/images/img-1'
        );
      });
    });
  });

  describe('navigation', () => {
    beforeEach(() => {
      mockSearchParams = new URLSearchParams('q=test');
    });

    it('navigates to collection when collection clicked', async () => {
      const user = userEvent.setup();

      render(<SearchPage />);

      await waitFor(() => {
        expect(screen.getByText('The Matrix')).toBeInTheDocument();
      });

      await user.click(screen.getByText('The Matrix'));

      expect(mockNavigate).toHaveBeenCalledWith('/collection/col-1');
    });

    it('navigates to media when media clicked', async () => {
      const user = userEvent.setup();

      render(<SearchPage />);

      await waitFor(() => {
        expect(screen.getByText('Pilot')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Pilot'));

      expect(mockNavigate).toHaveBeenCalledWith('/media/media-1');
    });
  });

  describe('filtering', () => {
    beforeEach(() => {
      mockSearchParams = new URLSearchParams('q=test');
    });

    it('shows filter button after search', async () => {
      render(<SearchPage />);

      await waitFor(() => {
        // Filter button has accessible aria-label
        expect(screen.getByRole('button', { name: /toggle filters/i })).toBeInTheDocument();
      });
    });

    it('toggles filter panel visibility', async () => {
      const user = userEvent.setup();

      render(<SearchPage />);

      await waitFor(() => {
        expect(screen.getByText('The Matrix')).toBeInTheDocument();
      });

      // Click the filter toggle button (now accessible)
      await user.click(screen.getByRole('button', { name: /toggle filters/i }));

      // Rating filter should be visible
      await waitFor(() => {
        expect(screen.getByText('R')).toBeInTheDocument();
      });
    });
  });
});
