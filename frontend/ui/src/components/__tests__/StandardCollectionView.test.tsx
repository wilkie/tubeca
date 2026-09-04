import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import type { Collection } from '../../api/client';
import { StandardCollectionView } from '../StandardCollectionView';
import { apiClient } from '../../api/client';

jest.mock('../../api/client', () => ({
  apiClient: {
    getImageUrl: jest.fn((id: string, size?: string) => `http://localhost/images/${id}?size=${size}`),
    checkFavorites: jest.fn(),
    toggleFavorite: jest.fn(),
    checkWatchLater: jest.fn(),
    toggleWatchLater: jest.fn(),
    getUserCollections: jest.fn(),
    addUserCollectionItem: jest.fn(),
  },
}));
const mockApi = apiClient as jest.Mocked<typeof apiClient>;

const onCollectionClick = jest.fn();
const onMediaClick = jest.fn();
const onMenuOpen = jest.fn();
const onAddToCollection = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getImageUrl.mockImplementation(
    (id: string, size?: string) => `http://localhost/images/${id}?size=${size}`
  );
  // The favourite and watch-later buttons have their own tests; here they are
  // left waiting on their check so they never settle mid-assertion.
  mockApi.checkFavorites.mockImplementation(() => new Promise(() => {}));
  mockApi.checkWatchLater.mockImplementation(() => new Promise(() => {}));
  mockApi.getUserCollections.mockResolvedValue({ data: { userCollections: [] } } as never);
});

function collection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 'col-1',
    name: 'Breaking Bad',
    collectionType: 'Show',
    images: [],
    ...overrides,
  } as Collection;
}

function renderView(props: Partial<Parameters<typeof StandardCollectionView>[0]> = {}) {
  return render(
    <StandardCollectionView
      collection={collection()}
      childCollections={[]}
      media={[]}
      menuOpen={false}
      onCollectionClick={onCollectionClick}
      onMediaClick={onMediaClick}
      onMenuOpen={onMenuOpen}
      onAddToCollection={onAddToCollection}
      {...props}
    />
  );
}

describe('StandardCollectionView', () => {
  it('heads the page with the collection and what kind it is', () => {
    renderView();

    expect(screen.getByRole('heading', { name: 'Breaking Bad' })).toBeInTheDocument();
    expect(screen.getByText('Show')).toBeInTheDocument();
  });

  it('leaves the chip off a kind that has no label', () => {
    renderView({ collection: collection({ collectionType: 'Generic' }) });

    expect(screen.queryByText('Show')).not.toBeInTheDocument();
  });

  it('shows the primary poster', () => {
    const { container } = renderView({
      collection: collection({
        images: [{ id: 'img-1', imageType: 'Poster', isPrimary: true }] as never,
      }),
    });

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'http://localhost/images/img-1?size=w400'
    );
  });

  it('falls back to a folder when there is no poster', () => {
    const { container } = renderView();

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('FolderIcon')).toBeInTheDocument();
  });

  it('ignores artwork that is not the primary poster', () => {
    const { container } = renderView({
      collection: collection({
        images: [{ id: 'img-1', imageType: 'Backdrop', isPrimary: true }] as never,
      }),
    });

    expect(container.querySelector('img')).toBeNull();
  });

  it('opens the options menu from its button', async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole('button', { name: /more options/i }));

    expect(onMenuOpen).toHaveBeenCalled();
  });

  it('offers to add the collection somewhere', async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(await screen.findByRole('menuitem', { name: /choose/i }));

    expect(onAddToCollection).toHaveBeenCalled();
  });

  it('only asks for the user collections once the menu is open', async () => {
    const user = userEvent.setup();
    renderView();
    expect(mockApi.getUserCollections).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(mockApi.getUserCollections).toHaveBeenCalled());
  });

  it('says when a collection holds nothing', () => {
    renderView();

    expect(screen.getByRole('alert')).toHaveTextContent(/empty/i);
  });

  it('lists the child collections', async () => {
    const user = userEvent.setup();
    renderView({
      childCollections: [
        { id: 'season-1', name: 'Season 1', collectionType: 'Season' },
        { id: 'season-2', name: 'Season 2', collectionType: 'Season' },
      ],
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByText('Season 1'));

    expect(onCollectionClick).toHaveBeenCalledWith('season-1');
  });

  it('lists the media', async () => {
    const user = userEvent.setup();
    renderView({
      collection: collection({ collectionType: 'Season' }),
      media: [
        { id: 'media-1', name: 'Pilot', type: 'Video', videoDetails: { episode: 1 } },
      ] as never,
    });

    await user.click(screen.getByText('Pilot'));

    expect(onMediaClick).toHaveBeenCalledWith('media-1');
  });

  describe('a season', () => {
    const season = (details: Record<string, unknown>) =>
      collection({
        name: 'Season 1',
        collectionType: 'Season',
        seasonDetails: details as never,
      });

    it('puts its title above the poster and its description beside it', () => {
      renderView({ collection: season({ description: 'The first season.' }) });

      expect(screen.getByRole('heading', { name: 'Season 1' })).toBeInTheDocument();
      expect(screen.getByText('The first season.')).toBeInTheDocument();
      expect(screen.getByText('Season')).toBeInTheDocument();
    });

    it('dates the season when it knows the date', () => {
      renderView({ collection: season({ releaseDate: '2008-01-20T00:00:00.000Z' }) });

      expect(screen.getByTestId('CalendarMonthIcon')).toBeInTheDocument();
      expect(screen.getByText(new Date('2008-01-20T00:00:00.000Z').toLocaleDateString())).toBeInTheDocument();
    });

    it('shows no panel at all when it knows neither', () => {
      renderView({ collection: season({}) });

      expect(screen.queryByTestId('CalendarMonthIcon')).not.toBeInTheDocument();
    });

    it('offers no expander for a description that fits', () => {
      renderView({ collection: season({ description: 'Short.' }) });

      expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument();
    });
  });
});
