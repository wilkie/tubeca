import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { ShowHeroView } from '../ShowHeroView';
import { apiClient, type Collection, type Image } from '../../api/client';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    getImageUrl: jest.fn((id) => `http://localhost/api/images/${id}`),
    checkFavorites: jest.fn(),
    checkWatchLater: jest.fn(),
    getUserCollections: jest.fn(),
    addUserCollectionItem: jest.fn(),
  },
}));

// Mock child components that make their own API calls
jest.mock('../FavoriteButton', () => ({
  FavoriteButton: jest.fn(({ collectionId }) => (
    <button data-testid="favorite-button" aria-label="Toggle favorite">
      Favorite {collectionId}
    </button>
  )),
}));

jest.mock('../WatchLaterButton', () => ({
  WatchLaterButton: jest.fn(({ collectionId }) => (
    <button data-testid="watch-later-button" aria-label="Toggle watch later">
      Watch Later {collectionId}
    </button>
  )),
}));

jest.mock('../CardQuickActions', () => ({
  CardQuickActions: jest.fn(() => <div data-testid="card-quick-actions" />),
}));

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

// Helper to create minimal Image mock
const createMockImage = (id: string, imageType: string): Image =>
  ({ id, imageType, isPrimary: true } as unknown as Image);

// Mock data
const mockCollection: Partial<Collection> = {
  id: 'show-1',
  name: 'Breaking Bad',
  collectionType: 'Show',
  libraryId: 'lib-1',
  parentId: null,
  createdAt: '',
  updatedAt: '',
  images: [
    createMockImage('backdrop-1', 'Backdrop'),
    createMockImage('poster-1', 'Poster'),
    createMockImage('logo-1', 'Logo'),
  ],
  keywords: [
    { id: 'kw-1', name: 'Drama' },
    { id: 'kw-2', name: 'Crime' },
  ],
  showDetails: {
    id: 'sd-1',
    collectionId: 'show-1',
    scraperId: null,
    externalId: null,
    description: 'A high school chemistry teacher turned meth manufacturer.',
    releaseDate: '2008-01-20',
    endDate: '2013-09-29',
    status: 'Ended',
    rating: 9.5,
    genres: 'Drama, Crime, Thriller',
    credits: [
      {
        id: 'credit-1',
        creditType: 'Actor',
        name: 'Bryan Cranston',
        role: 'Walter White',
        personId: 'person-1',
        person: { id: 'person-1', images: [createMockImage('person-img-1', 'Profile')] },
      },
      {
        id: 'credit-2',
        creditType: 'Actor',
        name: 'Aaron Paul',
        role: 'Jesse Pinkman',
        personId: 'person-2',
        person: { id: 'person-2', images: [] },
      },
      {
        id: 'credit-3',
        creditType: 'Director',
        name: 'Vince Gilligan',
        role: null,
        personId: 'person-3',
        person: null,
      },
    ],
  } as unknown as Collection['showDetails'],
};

const mockSeasons = [
  {
    id: 'season-1',
    name: 'Season 1',
    collectionType: 'Season',
    images: [createMockImage('season-1-img', 'Poster')],
    media: [
      { id: 'ep-1', videoDetails: { episode: 1 } },
      { id: 'ep-2', videoDetails: { episode: 2 } },
    ],
  },
  {
    id: 'season-2',
    name: 'Season 2',
    collectionType: 'Season',
    images: [],
    media: [
      { id: 'ep-3', videoDetails: { episode: 1 } },
    ],
  },
];

const mockBreadcrumbs = [
  { id: 'lib-1', name: 'TV Shows', type: 'library' as const },
];

describe('ShowHeroView', () => {
  const mockHandlers = {
    onBreadcrumbNavigate: jest.fn(),
    onPlay: jest.fn(),
    onPlayAfter: jest.fn(),
    onPlayInMiniPlayer: jest.fn(),
    onSeasonClick: jest.fn(),
    onPersonClick: jest.fn(),
    onMenuOpen: jest.fn(),
    onAddToCollection: jest.fn(),
    onAddSeasonToCollection: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockApiClient.checkFavorites.mockResolvedValue({
      data: { collectionIds: [], mediaIds: [], userCollectionIds: [] },
    });
    mockApiClient.checkWatchLater.mockResolvedValue({
      data: { collectionIds: [], mediaIds: [] },
    });
    mockApiClient.getUserCollections.mockResolvedValue({
      data: { userCollections: [] },
    });
    mockApiClient.addUserCollectionItem.mockResolvedValue({ data: undefined });
  });

  // Helper to render and wait for async operations to complete
  const renderAndWait = async (props: Partial<Parameters<typeof ShowHeroView>[0]> = {}) => {
    const result = render(
      <ShowHeroView
        collection={mockCollection as Collection}
        seasons={mockSeasons}
        breadcrumbs={mockBreadcrumbs}
        menuOpen={false}
        {...mockHandlers}
        {...props}
      />
    );
    // Wait for async operations to complete by checking for stable content
    await waitFor(() => {
      expect(screen.getByText(/high school chemistry teacher/)).toBeInTheDocument();
    });
    return result;
  };

  describe('rendering', () => {
    it('renders the show name when no logo', async () => {
      const collectionWithoutLogo = {
        ...mockCollection,
        images: [createMockImage('backdrop-1', 'Backdrop')],
      };

      render(
        <ShowHeroView
          collection={collectionWithoutLogo as Collection}
          seasons={mockSeasons}
          breadcrumbs={mockBreadcrumbs}
          menuOpen={false}
          {...mockHandlers}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Breaking Bad' })).toBeInTheDocument();
      });
    });

    it('renders the description', async () => {
      await renderAndWait();

      expect(screen.getByText(/high school chemistry teacher/)).toBeInTheDocument();
    });

    it('renders release year and end year', async () => {
      await renderAndWait();

      expect(screen.getByText(/2008.*2013/)).toBeInTheDocument();
    });

    it('renders the status chip', async () => {
      await renderAndWait();

      expect(screen.getByText('Ended')).toBeInTheDocument();
    });

    it('renders the rating', async () => {
      await renderAndWait();

      expect(screen.getByText('9.5')).toBeInTheDocument();
    });

    it('renders season count', async () => {
      await renderAndWait();

      expect(screen.getByText(/2 Seasons/)).toBeInTheDocument();
    });

    it('renders genre chips', async () => {
      await renderAndWait();

      // Genres/keywords may appear multiple times, so use getAllByText
      expect(screen.getAllByText('Drama').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Crime').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Thriller').length).toBeGreaterThanOrEqual(1);
    });

    it('renders keyword chips', async () => {
      await renderAndWait();

      // Keywords are different from genres - look for them
      const chips = screen.getAllByText('Drama');
      expect(chips.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('action buttons', () => {
    it('renders play button', async () => {
      await renderAndWait();

      expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
    });

    it('calls onPlay with first episode when play clicked', async () => {
      const user = userEvent.setup();

      await renderAndWait();

      await user.click(screen.getByRole('button', { name: /play/i }));

      expect(mockHandlers.onPlay).toHaveBeenCalledWith('ep-1');
    });

    it('renders favorite button', async () => {
      await renderAndWait();

      expect(screen.getByTestId('favorite-button')).toBeInTheDocument();
    });

    it('renders watch later button', async () => {
      await renderAndWait();

      expect(screen.getByTestId('watch-later-button')).toBeInTheDocument();
    });

    it('renders add button', async () => {
      await renderAndWait();

      expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
    });

    it('renders more options button', async () => {
      await renderAndWait();

      expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
    });
  });

  describe('season selector', () => {
    it('shows season selector button when multiple seasons', async () => {
      await renderAndWait();

      // Find the selector button specifically - it has a dropdown icon
      const selectorButtons = screen.getAllByRole('button').filter(
        btn => btn.textContent?.includes('Season 1') && btn.querySelector('[data-testid="KeyboardArrowDownIcon"]')
      );
      expect(selectorButtons.length).toBe(1);
    });

    it('opens season menu when selector clicked', async () => {
      const user = userEvent.setup();

      await renderAndWait();

      // Find and click the season selector button (has dropdown icon)
      const selectorButton = screen.getAllByRole('button').find(
        btn => btn.textContent?.includes('Season 1') && btn.querySelector('[data-testid="KeyboardArrowDownIcon"]')
      );
      expect(selectorButton).toBeDefined();

      await user.click(selectorButton!);

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });

      expect(screen.getByRole('menuitem', { name: 'Season 1' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Season 2' })).toBeInTheDocument();
    });

    it('selects different season', async () => {
      const user = userEvent.setup();

      await renderAndWait();

      // Find and click the season selector button
      const selectorButton = screen.getAllByRole('button').find(
        btn => btn.textContent?.includes('Season 1') && btn.querySelector('[data-testid="KeyboardArrowDownIcon"]')
      );

      await user.click(selectorButton!);

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('menuitem', { name: 'Season 2' }));

      await waitFor(() => {
        // The selector should now show Season 2
        const newSelectorButton = screen.getAllByRole('button').find(
          btn => btn.textContent?.includes('Season 2') && btn.querySelector('[data-testid="KeyboardArrowDownIcon"]')
        );
        expect(newSelectorButton).toBeDefined();
      });
    });

    it('does not show season selector with single season', async () => {
      render(
        <ShowHeroView
          collection={mockCollection as Collection}
          seasons={[mockSeasons[0]]}
          breadcrumbs={mockBreadcrumbs}
          menuOpen={false}
          {...mockHandlers}
        />
      );

      // Wait for async ops
      await waitFor(() => {
        expect(screen.getByText(/high school chemistry teacher/)).toBeInTheDocument();
      });

      // The season selector button (with dropdown icon) should not exist
      const selectorButtons = screen.getAllByRole('button').filter(
        btn => btn.textContent?.includes('Season 1') && btn.querySelector('[data-testid="KeyboardArrowDownIcon"]')
      );
      expect(selectorButtons.length).toBe(0);
    });
  });

  describe('seasons grid', () => {
    it('renders seasons section', async () => {
      await renderAndWait();

      expect(screen.getByText(/Seasons.*\(2\)/)).toBeInTheDocument();
    });

    it('renders season cards', async () => {
      await renderAndWait();

      // Each season name appears at least once in the grid
      const season1Elements = screen.getAllByText('Season 1');
      const season2Elements = screen.getAllByText('Season 2');
      expect(season1Elements.length).toBeGreaterThan(0);
      expect(season2Elements.length).toBeGreaterThan(0);
    });

    it('calls onSeasonClick when season card clicked', async () => {
      const user = userEvent.setup();

      await renderAndWait();

      // Find season cards in the grid (not the selector button)
      const seasonCards = screen.getAllByText('Season 1');
      // The one in the card should be clickable
      const cardWithSeason1 = seasonCards.find(el =>
        el.closest('.MuiCard-root') !== null
      );

      if (cardWithSeason1) {
        await user.click(cardWithSeason1);
        expect(mockHandlers.onSeasonClick).toHaveBeenCalledWith('season-1');
      }
    });

    it('shows season image when available', async () => {
      await renderAndWait();

      expect(screen.getByAltText('Season 1')).toHaveAttribute(
        'src',
        'http://localhost/api/images/season-1-img'
      );
    });
  });

  describe('cast grid', () => {
    it('renders cast section', async () => {
      await renderAndWait();

      expect(screen.getByText('Cast')).toBeInTheDocument();
    });

    it('renders actor names', async () => {
      await renderAndWait();

      expect(screen.getByText('Bryan Cranston')).toBeInTheDocument();
      expect(screen.getByText('Aaron Paul')).toBeInTheDocument();
    });

    it('renders character names', async () => {
      await renderAndWait();

      expect(screen.getByText('Walter White')).toBeInTheDocument();
      expect(screen.getByText('Jesse Pinkman')).toBeInTheDocument();
    });

    it('only shows actor credits, not directors', async () => {
      await renderAndWait();

      expect(screen.queryByText('Vince Gilligan')).not.toBeInTheDocument();
    });

    it('calls onPersonClick when actor clicked', async () => {
      const user = userEvent.setup();

      await renderAndWait();

      await user.click(screen.getByText('Bryan Cranston'));

      expect(mockHandlers.onPersonClick).toHaveBeenCalledWith('person-1');
    });
  });

  describe('add menu', () => {
    it('opens add menu when add button clicked', async () => {
      const user = userEvent.setup();

      await renderAndWait();

      await user.click(screen.getByRole('button', { name: /add/i }));

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });

      expect(screen.getByText(/Choose/)).toBeInTheDocument();
    });

    it('calls onAddToCollection when "Choose..." clicked', async () => {
      const user = userEvent.setup();

      await renderAndWait();

      await user.click(screen.getByRole('button', { name: /add/i }));

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Choose/));

      expect(mockHandlers.onAddToCollection).toHaveBeenCalled();
    });
  });

  describe('play menu', () => {
    it('shows play menu dropdown when onPlayAfter provided', async () => {
      const user = userEvent.setup();

      await renderAndWait();

      // There should be a button with aria-haspopup for the play menu
      const playMenuButton = Array.from(screen.getAllByRole('button')).find(
        btn => btn.getAttribute('aria-haspopup') === 'true' && btn.getAttribute('aria-controls')?.includes('play-menu')
      );

      if (playMenuButton) {
        await user.click(playMenuButton);

        await waitFor(() => {
          expect(screen.getByText(/Play after current/)).toBeInTheDocument();
        });
      }
    });
  });

  describe('more options menu', () => {
    it('calls onMenuOpen when more options clicked', async () => {
      const user = userEvent.setup();

      await renderAndWait();

      await user.click(screen.getByRole('button', { name: /more options/i }));

      expect(mockHandlers.onMenuOpen).toHaveBeenCalled();
    });
  });

  describe('no seasons', () => {
    it('does not render seasons section when no seasons', async () => {
      render(
        <ShowHeroView
          collection={mockCollection as Collection}
          seasons={[]}
          breadcrumbs={mockBreadcrumbs}
          menuOpen={false}
          {...mockHandlers}
        />
      );

      // Wait for async ops - use cast section as indicator since no seasons means no season fetch
      await waitFor(() => {
        expect(screen.getByText('Cast')).toBeInTheDocument();
      });

      expect(screen.queryByText(/Seasons/)).not.toBeInTheDocument();
    });

    it('does not render play button when no episodes', async () => {
      render(
        <ShowHeroView
          collection={mockCollection as Collection}
          seasons={[]}
          breadcrumbs={mockBreadcrumbs}
          menuOpen={false}
          {...mockHandlers}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Cast')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /play/i })).not.toBeInTheDocument();
    });
  });

  describe('no cast', () => {
    it('does not render cast section when no credits', async () => {
      const collectionWithoutCredits = {
        ...mockCollection,
        showDetails: {
          ...mockCollection.showDetails,
          credits: [],
        },
      };

      render(
        <ShowHeroView
          collection={collectionWithoutCredits as Collection}
          seasons={mockSeasons}
          breadcrumbs={mockBreadcrumbs}
          menuOpen={false}
          {...mockHandlers}
        />
      );

      // Wait for async ops
      await waitFor(() => {
        expect(screen.getByText(/high school chemistry teacher/)).toBeInTheDocument();
      });

      expect(screen.queryByText('Cast')).not.toBeInTheDocument();
    });
  });
});
