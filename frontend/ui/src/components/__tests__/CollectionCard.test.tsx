import { render, screen } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import type { Collection } from '../../api/client';
import { CollectionListCard, CollectionPosterCard } from '../CollectionCard';
import { apiClient } from '../../api/client';

jest.mock('../../api/client', () => ({
  apiClient: {
    getImageUrl: jest.fn((id: string, size: string) => `http://localhost/images/${id}?size=${size}`),
    toggleFavorite: jest.fn(),
    toggleWatchLater: jest.fn(),
    getUserCollections: jest.fn(),
    addUserCollectionItem: jest.fn(),
  },
}));
const mockApi = apiClient as jest.Mocked<typeof apiClient>;

const onClick = jest.fn();
const onPlay = jest.fn();
const onAddToCollection = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getImageUrl.mockImplementation(
    (id: string, size?: string) => `http://localhost/images/${id}?size=${size}`
  );
  mockApi.getUserCollections.mockResolvedValue({ data: { userCollections: [] } } as never);
  mockApi.addUserCollectionItem.mockResolvedValue({ data: {} } as never);
});

function collection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 'col-1',
    name: 'Heat',
    collectionType: 'Film',
    images: [],
    ...overrides,
  } as Collection;
}

const shared = {
  isSelectionMode: false,
  isSelected: false,
  favorited: false,
  inWatchLater: false,
  onClick,
  onAddToCollection,
};

function renderPoster(props: Partial<Parameters<typeof CollectionPosterCard>[0]> = {}) {
  return render(
    <CollectionPosterCard collection={collection()} libraryType="Film" {...shared} {...props} />
  );
}

function renderList(props: Partial<Parameters<typeof CollectionListCard>[0]> = {}) {
  return render(
    <CollectionListCard
      collection={collection()}
      libraryType="Film"
      onPlay={onPlay}
      {...shared}
      {...props}
    />
  );
}

describe('CollectionPosterCard', () => {
  it('shows the poster a film has', () => {
    const { container } = renderPoster({
      collection: collection({ images: [{ id: 'img-1' }] as never }),
    });

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'http://localhost/images/img-1?size=w400'
    );
  });

  it('shows a show its poster too', () => {
    const { container } = renderPoster({
      libraryType: 'Television',
      collection: collection({ collectionType: 'Show', images: [{ id: 'img-1' }] as never }),
    });

    expect(container.querySelector('img')).toBeInTheDocument();
  });

  it('gives a season an icon rather than the show artwork', () => {
    const { container } = renderPoster({
      libraryType: 'Television',
      collection: collection({ collectionType: 'Season', images: [{ id: 'img-1' }] as never }),
    });

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('TvIcon')).toBeInTheDocument();
  });

  it('picks the icon from the kind of library', () => {
    const { unmount } = renderPoster({ libraryType: 'Film' });
    expect(screen.getByTestId('MovieIcon')).toBeInTheDocument();
    unmount();

    renderPoster({ libraryType: 'Music', collection: collection({ collectionType: 'Album' }) });
    expect(screen.getByTestId('AlbumIcon')).toBeInTheDocument();
  });

  it('opens the collection when clicked', async () => {
    const user = userEvent.setup();
    renderPoster();

    await user.click(screen.getByText('Heat'));

    expect(onClick).toHaveBeenCalledWith('col-1');
  });

  it('carries the rating and certificate for a hover overlay', () => {
    renderPoster({
      collection: collection({ filmDetails: { rating: 8.29, contentRating: 'R' } as never }),
    });

    expect(screen.getByText('R')).toBeInTheDocument();
    expect(screen.getByText(/8\.3/)).toBeInTheDocument();
  });

  it('counts seasons for a show and folders for anything else', () => {
    const { unmount } = renderPoster({
      libraryType: 'Television',
      collection: collection({
        collectionType: 'Show',
        _count: { children: 5, media: 0 } as never,
      }),
    });
    expect(screen.getByText('5 seasons')).toBeInTheDocument();
    unmount();

    renderPoster({
      libraryType: 'Television',
      collection: collection({
        collectionType: 'Season',
        _count: { children: 0, media: 13 } as never,
      }),
    });
    expect(screen.getByText('13 items')).toBeInTheDocument();
  });

  it('counts nothing for a film', () => {
    renderPoster({ collection: collection({ _count: { children: 0, media: 1 } as never }) });

    expect(screen.queryByText(/items/)).not.toBeInTheDocument();
  });

  it('marks the card only while selecting', () => {
    const { unmount } = renderPoster();
    expect(screen.queryByTestId('CheckBoxOutlineBlankIcon')).not.toBeInTheDocument();
    unmount();

    renderPoster({ isSelectionMode: true });
    expect(screen.getByTestId('CheckBoxOutlineBlankIcon')).toBeInTheDocument();
  });

  it('ticks the mark on a selected card', () => {
    renderPoster({ isSelectionMode: true, isSelected: true });

    expect(screen.getByTestId('CheckBoxIcon')).toBeInTheDocument();
  });
});

describe('CollectionListCard', () => {
  it('lays out the year, certificate, runtime, rating and description', () => {
    renderList({
      collection: collection({
        filmDetails: {
          releaseDate: '1995-12-15',
          contentRating: 'R',
          runtime: 170,
          rating: 8.29,
          description: 'A crew of thieves and the detective chasing them.',
        } as never,
      }),
    });

    expect(screen.getByText('1995')).toBeInTheDocument();
    expect(screen.getByText('R')).toBeInTheDocument();
    expect(screen.getByText('2h 50m')).toBeInTheDocument();
    expect(screen.getByText(/8\.3/)).toBeInTheDocument();
    expect(screen.getByText(/crew of thieves/)).toBeInTheDocument();
  });

  it('asks for a smaller image than the poster card does', () => {
    const { container } = renderList({
      collection: collection({ images: [{ id: 'img-1' }] as never }),
    });

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'http://localhost/images/img-1?size=w200'
    );
  });

  it('plays the collection without opening it', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole('button', { name: 'Play' }));

    expect(onPlay).toHaveBeenCalledWith('col-1');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('opens the collection from the row itself', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByText('Heat'));

    expect(onClick).toHaveBeenCalledWith('col-1');
  });

  it('offers to add the collection elsewhere', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole('button', { name: /add to collection/i }));
    await user.click(await screen.findByRole('menuitem', { name: /choose/i }));

    expect(onAddToCollection).toHaveBeenCalledWith(expect.objectContaining({ id: 'col-1' }));
  });
});
