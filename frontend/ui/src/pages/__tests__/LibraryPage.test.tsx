import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { LibraryPage } from '../LibraryPage';
import { apiClient } from '../../api/client';
import type { Library, Collection } from '../../api/client';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    getLibrary: jest.fn(),
    getCollectionsByLibrary: jest.fn(),
    getImageUrl: jest.fn((id) => `http://localhost/api/images/${id}`),
    checkFavorites: jest.fn().mockResolvedValue({ data: { collectionIds: [], mediaIds: [] } }),
    checkWatchLater: jest.fn().mockResolvedValue({ data: { collectionIds: [], mediaIds: [] } }),
    toggleFavorite: jest.fn().mockResolvedValue({ data: { favorited: true } }),
    toggleWatchLater: jest.fn().mockResolvedValue({ data: { inWatchLater: true } }),
    getUserCollections: jest.fn().mockResolvedValue({ data: { userCollections: [] } }),
    addUserCollectionItem: jest.fn().mockResolvedValue({ data: { item: {} } }),
  },
}));

// Mock useParams and useNavigate
let mockLibraryId: string | undefined = 'lib-123';
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ libraryId: mockLibraryId }),
  useNavigate: () => mockNavigate,
}));

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

// Mock library data
const mockLibrary: Library = {
  id: 'lib-123',
  name: 'Movies',
  path: '/media/movies',
  libraryType: 'Film',
  watchForChanges: false,
  groups: [],
  createdAt: '',
  updatedAt: '',
};

const mockTvLibrary: Library = {
  ...mockLibrary,
  id: 'lib-tv',
  name: 'TV Shows',
  libraryType: 'Television',
};

// Mock collection data
const mockCollections: Collection[] = [
  {
    id: 'col-1',
    name: 'The Matrix',
    collectionType: 'Film',
    libraryId: 'lib-123',
    parentId: null,
    images: [
      {
        id: 'img-1',
        mediaId: null,
        collectionId: 'col-1',
        personId: null,
        showCreditId: null,
        creditId: null,
        imageType: 'Poster',
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
    _count: { media: 1, children: 0 },
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'col-2',
    name: 'Inception',
    collectionType: 'Film',
    libraryId: 'lib-123',
    parentId: null,
    images: [],
    _count: { media: 1, children: 0 },
    createdAt: '',
    updatedAt: '',
  },
];

const mockShowCollections: Collection[] = [
  {
    id: 'col-show-1',
    name: 'Breaking Bad',
    collectionType: 'Show',
    libraryId: 'lib-tv',
    parentId: null,
    images: [
      {
        id: 'img-show-1',
        mediaId: null,
        collectionId: 'col-show-1',
        personId: null,
        showCreditId: null,
        creditId: null,
        imageType: 'Poster',
        path: '/images/bb.jpg',
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
    _count: { media: 0, children: 5 },
    createdAt: '',
    updatedAt: '',
  },
];

// Collection with child collection (nested, should be filtered out)
const mockCollectionsWithNested: Collection[] = [
  ...mockCollections,
  {
    id: 'col-3',
    name: 'Season 1',
    collectionType: 'Season',
    libraryId: 'lib-123',
    parentId: 'col-1', // Has parent, should be filtered
    images: [],
    _count: { media: 5, children: 0 },
    createdAt: '',
    updatedAt: '',
  },
];

describe('LibraryPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLibraryId = 'lib-123';
  });

  describe('loading state', () => {
    it('shows loading spinner while fetching', () => {
      mockApiClient.getLibrary.mockImplementation(() => new Promise(() => {}));

      render(<LibraryPage />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('hides loading spinner after data loads', async () => {
      mockApiClient.getLibrary.mockResolvedValue({ data: { library: mockLibrary } });
      mockApiClient.getCollectionsByLibrary.mockResolvedValue({ data: { collections: mockCollections } });

      render(<LibraryPage />);

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows error when library fetch fails', async () => {
      mockApiClient.getLibrary.mockResolvedValue({ error: 'Library not found' });

      render(<LibraryPage />);

      await waitFor(() => {
        expect(screen.getByText('Library not found')).toBeInTheDocument();
      });
    });

    it('shows error when collections fetch fails', async () => {
      mockApiClient.getLibrary.mockResolvedValue({ data: { library: mockLibrary } });
      mockApiClient.getCollectionsByLibrary.mockResolvedValue({ error: 'Failed to load collections' });

      render(<LibraryPage />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load collections')).toBeInTheDocument();
      });
    });

    it('shows not found when library is null', async () => {
      mockApiClient.getLibrary.mockResolvedValue({ data: { library: null as unknown as Library } });
      mockApiClient.getCollectionsByLibrary.mockResolvedValue({ data: { collections: [] } });

      render(<LibraryPage />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });
  });

  describe('rendering', () => {
    beforeEach(() => {
      mockApiClient.getLibrary.mockResolvedValue({ data: { library: mockLibrary } });
      mockApiClient.getCollectionsByLibrary.mockResolvedValue({ data: { collections: mockCollections } });
    });

    it('shows library name as heading', async () => {
      render(<LibraryPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Movies' })).toBeInTheDocument();
      });
    });

    it('shows empty message when no collections', async () => {
      mockApiClient.getCollectionsByLibrary.mockResolvedValue({ data: { collections: [] } });

      render(<LibraryPage />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });

    it('shows collection names', async () => {
      render(<LibraryPage />);

      await waitFor(() => {
        expect(screen.getByText('The Matrix')).toBeInTheDocument();
        expect(screen.getByText('Inception')).toBeInTheDocument();
      });
    });

    it('shows collection images for Film library', async () => {
      render(<LibraryPage />);

      await waitFor(() => {
        expect(screen.getByAltText('The Matrix')).toBeInTheDocument();
      });
    });

    it('shows movie icon for Film collections without images', async () => {
      render(<LibraryPage />);

      await waitFor(() => {
        // Film library shows MovieIcon for collections without images
        expect(screen.getByTestId('MovieIcon')).toBeInTheDocument();
      });
    });

    it('filters out nested collections (with parentId)', async () => {
      mockApiClient.getCollectionsByLibrary.mockResolvedValue({ data: { collections: mockCollectionsWithNested } });

      render(<LibraryPage />);

      await waitFor(() => {
        expect(screen.getByText('The Matrix')).toBeInTheDocument();
        expect(screen.getByText('Inception')).toBeInTheDocument();
      });

      // Season 1 should not be visible (it has a parentId)
      expect(screen.queryByText('Season 1')).not.toBeInTheDocument();
    });
  });

  describe('TV library with shows', () => {
    beforeEach(() => {
      mockLibraryId = 'lib-tv';
      mockApiClient.getLibrary.mockResolvedValue({ data: { library: mockTvLibrary } });
      mockApiClient.getCollectionsByLibrary.mockResolvedValue({ data: { collections: mockShowCollections } });
    });

    it('shows show images', async () => {
      render(<LibraryPage />);

      await waitFor(() => {
        expect(screen.getByAltText('Breaking Bad')).toBeInTheDocument();
      });
    });

    it('shows season count for shows', async () => {
      render(<LibraryPage />);

      await waitFor(() => {
        expect(screen.getByText(/5 seasons/i)).toBeInTheDocument();
      });
    });
  });

  describe('navigation', () => {
    beforeEach(() => {
      mockApiClient.getLibrary.mockResolvedValue({ data: { library: mockLibrary } });
      mockApiClient.getCollectionsByLibrary.mockResolvedValue({ data: { collections: mockCollections } });
    });

    it('navigates to collection when clicked', async () => {
      const user = userEvent.setup();

      render(<LibraryPage />);

      await waitFor(() => {
        expect(screen.getByText('The Matrix')).toBeInTheDocument();
      });

      await user.click(screen.getByText('The Matrix'));

      expect(mockNavigate).toHaveBeenCalledWith('/collection/col-1');
    });
  });

  describe('no libraryId', () => {
    it('does not fetch when libraryId is undefined', () => {
      mockLibraryId = undefined;

      render(<LibraryPage />);

      expect(mockApiClient.getLibrary).not.toHaveBeenCalled();
      expect(mockApiClient.getCollectionsByLibrary).not.toHaveBeenCalled();
    });
  });
});
