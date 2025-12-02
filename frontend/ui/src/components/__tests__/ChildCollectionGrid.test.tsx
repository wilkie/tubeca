import { render, screen } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { ChildCollectionGrid } from '../ChildCollectionGrid';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    getImageUrl: jest.fn((id: string) => `http://localhost/api/images/${id}`),
  },
}));

// Use type assertion to avoid full Image type requirements
const mockSeasons = [
  {
    id: 'season-1',
    name: 'Season 1',
    collectionType: 'Season' as const,
    images: [{ id: 'img-1', imageType: 'Poster' }],
  },
  {
    id: 'season-2',
    name: 'Season 2',
    collectionType: 'Season' as const,
    images: [],
  },
] as Parameters<typeof ChildCollectionGrid>[0]['collections'];

const mockAlbums = [
  {
    id: 'album-1',
    name: 'Abbey Road',
    collectionType: 'Album' as const,
    images: [],
  },
  {
    id: 'album-2',
    name: 'Let It Be',
    collectionType: 'Album' as const,
    images: [],
  },
] as Parameters<typeof ChildCollectionGrid>[0]['collections'];

describe('ChildCollectionGrid', () => {
  const mockOnCollectionClick = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rendering', () => {
    it('does not render when children array is empty', () => {
      const { container } = render(
        <ChildCollectionGrid
          collections={[]}
          onCollectionClick={mockOnCollectionClick}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    it('renders collection count', () => {
      render(
        <ChildCollectionGrid
          collections={mockSeasons}
          parentCollectionType="Show"
          onCollectionClick={mockOnCollectionClick}
        />
      );

      expect(screen.getByText('Seasons (2)')).toBeInTheDocument();
    });

    it('renders custom title with count', () => {
      render(
        <ChildCollectionGrid
          collections={mockSeasons}
          onCollectionClick={mockOnCollectionClick}
          title="All Seasons"
        />
      );

      expect(screen.getByText('All Seasons (2)')).toBeInTheDocument();
    });

    it('renders collection names', () => {
      render(
        <ChildCollectionGrid
          collections={mockSeasons}
          parentCollectionType="Show"
          onCollectionClick={mockOnCollectionClick}
        />
      );

      expect(screen.getByText('Season 1')).toBeInTheDocument();
      expect(screen.getByText('Season 2')).toBeInTheDocument();
    });
  });

  describe('parent collection type labels', () => {
    it('shows Seasons label for Show parent', () => {
      render(
        <ChildCollectionGrid
          collections={mockSeasons}
          parentCollectionType="Show"
          onCollectionClick={mockOnCollectionClick}
        />
      );

      expect(screen.getByText(/seasons/i)).toBeInTheDocument();
    });

    it('shows Albums label for Artist parent', () => {
      render(
        <ChildCollectionGrid
          collections={mockAlbums}
          parentCollectionType="Artist"
          onCollectionClick={mockOnCollectionClick}
        />
      );

      expect(screen.getByText(/albums/i)).toBeInTheDocument();
    });

    it('shows Subfolders label for other parent types', () => {
      render(
        <ChildCollectionGrid
          collections={mockSeasons}
          parentCollectionType="Film"
          onCollectionClick={mockOnCollectionClick}
        />
      );

      expect(screen.getByText(/subfolders/i)).toBeInTheDocument();
    });
  });

  describe('icons', () => {
    it('shows Folder icon for season without image', () => {
      render(
        <ChildCollectionGrid
          collections={[mockSeasons[1]]}
          parentCollectionType="Show"
          onCollectionClick={mockOnCollectionClick}
        />
      );

      expect(screen.getByTestId('FolderIcon')).toBeInTheDocument();
    });

    it('shows Album icon for album collection', () => {
      render(
        <ChildCollectionGrid
          collections={mockAlbums}
          parentCollectionType="Artist"
          onCollectionClick={mockOnCollectionClick}
        />
      );

      expect(screen.getAllByTestId('AlbumIcon').length).toBe(2);
    });

    it('shows Tv icon for show collection', () => {
      const shows = [
        { id: 'show-1', name: 'Breaking Bad', collectionType: 'Show' as const, images: [] },
      ];

      render(
        <ChildCollectionGrid
          collections={shows}
          onCollectionClick={mockOnCollectionClick}
        />
      );

      expect(screen.getByTestId('TvIcon')).toBeInTheDocument();
    });

    it('shows Person icon for artist collection', () => {
      const artists = [
        { id: 'artist-1', name: 'The Beatles', collectionType: 'Artist' as const, images: [] },
      ];

      render(
        <ChildCollectionGrid
          collections={artists}
          onCollectionClick={mockOnCollectionClick}
        />
      );

      expect(screen.getByTestId('PersonIcon')).toBeInTheDocument();
    });
  });

  describe('navigation', () => {
    it('calls onCollectionClick when collection clicked', async () => {
      const user = userEvent.setup();

      render(
        <ChildCollectionGrid
          collections={mockSeasons}
          parentCollectionType="Show"
          onCollectionClick={mockOnCollectionClick}
        />
      );

      await user.click(screen.getByText('Season 1'));

      expect(mockOnCollectionClick).toHaveBeenCalledWith('season-1');
    });
  });
});
