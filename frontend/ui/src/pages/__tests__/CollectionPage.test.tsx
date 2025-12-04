import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { CollectionPage } from '../CollectionPage';

// Mock react-router-dom
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ collectionId: 'test-collection-id' }),
  useNavigate: () => mockNavigate,
}));

// Mock useAuth
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', role: 'Admin' },
    isAuthenticated: true,
  }),
}));

// Mock API client
const mockGetCollection = jest.fn();
const mockRefreshCollectionMetadata = jest.fn();
const mockRefreshCollectionImages = jest.fn();
const mockDeleteCollection = jest.fn();

jest.mock('../../api/client', () => ({
  apiClient: {
    getCollection: (...args: unknown[]) => mockGetCollection(...args),
    getImageUrl: jest.fn((id: string) => `http://localhost/api/images/${id}`),
    refreshCollectionMetadata: (...args: unknown[]) => mockRefreshCollectionMetadata(...args),
    refreshCollectionImages: (...args: unknown[]) => mockRefreshCollectionImages(...args),
    deleteCollection: (...args: unknown[]) => mockDeleteCollection(...args),
    checkFavorites: jest.fn().mockResolvedValue({ data: { collectionIds: [], mediaIds: [] } }),
    checkWatchLater: jest.fn().mockResolvedValue({ data: { collectionIds: [], mediaIds: [] } }),
    toggleFavorite: jest.fn().mockResolvedValue({ data: { favorited: true } }),
    toggleWatchLater: jest.fn().mockResolvedValue({ data: { inWatchLater: true } }),
    getUserCollections: jest.fn().mockResolvedValue({ data: { userCollections: [] } }),
    addUserCollectionItem: jest.fn().mockResolvedValue({ data: { item: {} } }),
  },
}));

const createMockFilmCollection = () => ({
  id: 'film-1',
  name: 'The Matrix',
  collectionType: 'Film',
  images: [{ id: 'poster-1', imageType: 'Poster' }, { id: 'backdrop-1', imageType: 'Backdrop' }],
  library: { id: 'lib-1', name: 'Films', libraryType: 'Film' },
  parent: null,
  children: [],
  filmDetails: {
    description: 'A computer hacker learns the truth about reality.',
    releaseDate: '1999-03-31',
    contentRating: 'R',
    rating: 8.7,
    credits: [
      { id: 'cred-1', name: 'Keanu Reeves', role: 'Neo', creditType: 'Actor', personId: 'person-1' },
    ],
  },
  media: [
    {
      id: 'media-1',
      name: 'The Matrix',
      type: 'Video',
      duration: 8160,
      images: [{ id: 'still-1', imageType: 'Still' }],
    },
  ],
});

const createMockShowCollection = () => ({
  id: 'show-1',
  name: 'Breaking Bad',
  collectionType: 'Show',
  images: [{ id: 'poster-1', imageType: 'Poster' }, { id: 'backdrop-1', imageType: 'Backdrop' }],
  library: { id: 'lib-2', name: 'TV Shows', libraryType: 'Television' },
  parent: null,
  children: [
    { id: 'season-1', name: 'Season 1', collectionType: 'Season', images: [] },
    { id: 'season-2', name: 'Season 2', collectionType: 'Season', images: [] },
  ],
  media: [],
});

const createMockSeasonCollection = () => ({
  id: 'season-1',
  name: 'Season 1',
  collectionType: 'Season',
  images: [{ id: 'poster-1', imageType: 'Poster' }],
  library: { id: 'lib-2', name: 'TV Shows', libraryType: 'Television' },
  parent: { id: 'show-1', name: 'Breaking Bad' },
  children: [],
  media: [
    { id: 'ep-1', name: 'Pilot', type: 'Video', videoDetails: { episode: 1 }, images: [] },
    { id: 'ep-2', name: "Cat's in the Bag", type: 'Video', videoDetails: { episode: 2 }, images: [] },
  ],
});

describe('CollectionPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNavigate.mockClear();
  });

  describe('loading state', () => {
    it('shows loading spinner while fetching', () => {
      mockGetCollection.mockReturnValue(new Promise(() => {}));

      render(<CollectionPage />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
  });

  describe('error handling', () => {
    it('displays error when API returns error', async () => {
      mockGetCollection.mockResolvedValue({
        error: 'Collection not found',
        data: null,
      });

      render(<CollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Collection not found');
      });
    });
  });

  describe('Film view', () => {
    it('renders FilmHeroView for Film library collections', async () => {
      mockGetCollection.mockResolvedValue({
        data: { collection: createMockFilmCollection() },
      });

      render(<CollectionPage />);

      await waitFor(() => {
        // Use heading role to be specific (avoid breadcrumb match)
        expect(screen.getByRole('heading', { name: 'The Matrix' })).toBeInTheDocument();
      });

      // Film view shows credits
      expect(screen.getByText('Keanu Reeves')).toBeInTheDocument();
    });

    it('navigates to play when play button clicked', async () => {
      const user = userEvent.setup();
      mockGetCollection.mockResolvedValue({
        data: { collection: createMockFilmCollection() },
      });

      render(<CollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'The Matrix' })).toBeInTheDocument();
      });

      const playButton = screen.getByRole('button', { name: /play/i });
      await user.click(playButton);

      expect(mockNavigate).toHaveBeenCalledWith('/play/media-1');
    });

    it('navigates to person when cast member clicked', async () => {
      const user = userEvent.setup();
      mockGetCollection.mockResolvedValue({
        data: { collection: createMockFilmCollection() },
      });

      render(<CollectionPage />);

      await waitFor(() => {
        expect(screen.getByText('Keanu Reeves')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Keanu Reeves'));

      expect(mockNavigate).toHaveBeenCalledWith('/person/person-1');
    });
  });

  describe('Show view', () => {
    it('renders ShowHeroView for Show collections', async () => {
      mockGetCollection.mockResolvedValue({
        data: { collection: createMockShowCollection() },
      });

      render(<CollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Breaking Bad' })).toBeInTheDocument();
      });
    });

    it('displays season cards', async () => {
      mockGetCollection.mockResolvedValue({
        data: { collection: createMockShowCollection() },
      });

      render(<CollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Breaking Bad' })).toBeInTheDocument();
      });

      // Season cards should be visible (multiple buttons with same name is OK)
      const season1Buttons = screen.getAllByRole('button', { name: 'Season 1' });
      const season2Buttons = screen.getAllByRole('button', { name: 'Season 2' });
      expect(season1Buttons.length).toBeGreaterThanOrEqual(1);
      expect(season2Buttons.length).toBeGreaterThanOrEqual(1);
    });

    it('navigates to season when season card clicked', async () => {
      const user = userEvent.setup();
      mockGetCollection.mockResolvedValue({
        data: { collection: createMockShowCollection() },
      });

      render(<CollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Breaking Bad' })).toBeInTheDocument();
      });

      // Click Season 2 card
      const season2Cards = screen.getAllByRole('button', { name: 'Season 2' });
      // Get the card button (not the menu button)
      await user.click(season2Cards[season2Cards.length - 1]);

      expect(mockNavigate).toHaveBeenCalledWith('/collection/season-2');
    });
  });

  describe('Season view (StandardCollectionView)', () => {
    it('renders StandardCollectionView for Season collections', async () => {
      mockGetCollection.mockResolvedValue({
        data: { collection: createMockSeasonCollection() },
      });

      render(<CollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Season 1' })).toBeInTheDocument();
      });

      // Season view shows episodes
      expect(screen.getByText('Pilot')).toBeInTheDocument();
    });

    it('shows breadcrumbs for nested collections', async () => {
      mockGetCollection.mockResolvedValue({
        data: { collection: createMockSeasonCollection() },
      });

      render(<CollectionPage />);

      await waitFor(() => {
        expect(screen.getByText('TV Shows')).toBeInTheDocument();
        expect(screen.getByText('Breaking Bad')).toBeInTheDocument();
      });
    });

    it('navigates to parent collection when breadcrumb clicked', async () => {
      const user = userEvent.setup();
      mockGetCollection.mockResolvedValue({
        data: { collection: createMockSeasonCollection() },
      });

      render(<CollectionPage />);

      await waitFor(() => {
        expect(screen.getByText('Breaking Bad')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Breaking Bad'));

      expect(mockNavigate).toHaveBeenCalledWith('/collection/show-1');
    });

    it('navigates to library when library breadcrumb clicked', async () => {
      const user = userEvent.setup();
      mockGetCollection.mockResolvedValue({
        data: { collection: createMockSeasonCollection() },
      });

      render(<CollectionPage />);

      await waitFor(() => {
        expect(screen.getByText('TV Shows')).toBeInTheDocument();
      });

      await user.click(screen.getByText('TV Shows'));

      expect(mockNavigate).toHaveBeenCalledWith('/library/lib-2');
    });

    it('navigates to episode when media clicked', async () => {
      const user = userEvent.setup();
      mockGetCollection.mockResolvedValue({
        data: { collection: createMockSeasonCollection() },
      });

      render(<CollectionPage />);

      await waitFor(() => {
        expect(screen.getByText('Pilot')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Pilot'));

      expect(mockNavigate).toHaveBeenCalledWith('/media/ep-1');
    });

    it('opens menu when options button clicked', async () => {
      const user = userEvent.setup();
      mockGetCollection.mockResolvedValue({
        data: { collection: createMockSeasonCollection() },
      });

      render(<CollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Season 1' })).toBeInTheDocument();
      });

      const menuButton = screen.getByRole('button', { name: /more options/i });
      await user.click(menuButton);

      expect(screen.getByText('Images')).toBeInTheDocument();
      expect(screen.getByText('Refresh metadata')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });

  describe('options menu', () => {
    it('opens images dialog when Images clicked', async () => {
      const user = userEvent.setup();
      mockGetCollection.mockResolvedValue({
        data: { collection: createMockSeasonCollection() },
      });

      render(<CollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Season 1' })).toBeInTheDocument();
      });

      const menuButton = screen.getByRole('button', { name: /more options/i });
      await user.click(menuButton);
      await user.click(screen.getByText('Images'));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('calls refresh metadata API when Refresh metadata clicked', async () => {
      const user = userEvent.setup();
      mockGetCollection.mockResolvedValue({
        data: { collection: createMockSeasonCollection() },
      });
      mockRefreshCollectionMetadata.mockResolvedValue({ data: { message: 'ok' } });

      render(<CollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Season 1' })).toBeInTheDocument();
      });

      const menuButton = screen.getByRole('button', { name: /more options/i });
      await user.click(menuButton);
      await user.click(screen.getByText('Refresh metadata'));

      await waitFor(() => {
        expect(mockRefreshCollectionMetadata).toHaveBeenCalledWith('season-1');
      });
    });

    it('calls refresh images API when Refresh images clicked', async () => {
      const user = userEvent.setup();
      mockGetCollection.mockResolvedValue({
        data: { collection: createMockSeasonCollection() },
      });
      mockRefreshCollectionImages.mockResolvedValue({ data: { message: 'ok' } });

      render(<CollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Season 1' })).toBeInTheDocument();
      });

      const menuButton = screen.getByRole('button', { name: /more options/i });
      await user.click(menuButton);
      await user.click(screen.getByText('Refresh images'));

      await waitFor(() => {
        expect(mockRefreshCollectionImages).toHaveBeenCalledWith('season-1');
      });
    });
  });

  describe('delete flow', () => {
    it('opens delete dialog when Delete clicked', async () => {
      const user = userEvent.setup();
      mockGetCollection.mockResolvedValue({
        data: { collection: createMockSeasonCollection() },
      });

      render(<CollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Season 1' })).toBeInTheDocument();
      });

      const menuButton = screen.getByRole('button', { name: /more options/i });
      await user.click(menuButton);
      await user.click(screen.getByText('Delete'));

      expect(screen.getByText('Delete Collection?')).toBeInTheDocument();
    });

    it('navigates to library after successful delete', async () => {
      const user = userEvent.setup();
      mockGetCollection.mockResolvedValue({
        data: { collection: createMockSeasonCollection() },
      });
      mockDeleteCollection.mockResolvedValue({ data: {} });

      render(<CollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Season 1' })).toBeInTheDocument();
      });

      // Open menu and click delete
      const menuButton = screen.getByRole('button', { name: /more options/i });
      await user.click(menuButton);
      await user.click(screen.getByText('Delete'));

      // Confirm deletion
      await user.click(screen.getByRole('button', { name: /^delete$/i }));

      await waitFor(() => {
        expect(mockDeleteCollection).toHaveBeenCalledWith('season-1');
        expect(mockNavigate).toHaveBeenCalledWith('/library/lib-2');
      });
    });

    it('closes delete dialog on cancel', async () => {
      const user = userEvent.setup();
      mockGetCollection.mockResolvedValue({
        data: { collection: createMockSeasonCollection() },
      });

      render(<CollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Season 1' })).toBeInTheDocument();
      });

      // Open menu and click delete
      const menuButton = screen.getByRole('button', { name: /more options/i });
      await user.click(menuButton);
      await user.click(screen.getByText('Delete'));

      expect(screen.getByText('Delete Collection?')).toBeInTheDocument();

      // Click cancel
      await user.click(screen.getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByText('Delete Collection?')).not.toBeInTheDocument();
      });
    });

    it('displays error if delete fails', async () => {
      const user = userEvent.setup();
      mockGetCollection.mockResolvedValue({
        data: { collection: createMockSeasonCollection() },
      });
      mockDeleteCollection.mockResolvedValue({ error: 'Delete failed' });

      render(<CollectionPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Season 1' })).toBeInTheDocument();
      });

      // Open menu and click delete
      const menuButton = screen.getByRole('button', { name: /more options/i });
      await user.click(menuButton);
      await user.click(screen.getByText('Delete'));

      // Confirm deletion
      await user.click(screen.getByRole('button', { name: /^delete$/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Delete failed');
      });
    });
  });
});
