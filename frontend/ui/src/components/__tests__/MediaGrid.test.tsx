import { render, screen } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { MediaGrid } from '../MediaGrid';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    getImageUrl: jest.fn((id: string) => `http://localhost/api/images/${id}`),
  },
}));

// Use type assertion to avoid full Image type requirements in tests
const mockEpisodes = [
  {
    id: 'ep-1',
    name: 'Pilot',
    type: 'Video' as const,
    videoDetails: { episode: 1 },
    images: [{ id: 'img-1', imageType: 'Still' }],
  },
  {
    id: 'ep-2',
    name: "Cat's in the Bag",
    type: 'Video' as const,
    videoDetails: { episode: 2 },
    images: [],
  },
  {
    id: 'ep-3',
    name: 'And the Bag\'s in the River',
    type: 'Video' as const,
    videoDetails: { episode: 3 },
    images: [],
  },
] as Parameters<typeof MediaGrid>[0]['media'];

const mockTracks = [
  {
    id: 'track-1',
    name: 'Come Together',
    type: 'Audio' as const,
    audioDetails: { track: 1, disc: 1 },
    images: [],
  },
  {
    id: 'track-2',
    name: 'Something',
    type: 'Audio' as const,
    audioDetails: { track: 2, disc: 1 },
    images: [],
  },
] as Parameters<typeof MediaGrid>[0]['media'];

describe('MediaGrid', () => {
  const mockOnMediaClick = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rendering', () => {
    it('does not render when media array is empty', () => {
      const { container } = render(
        <MediaGrid media={[]} onMediaClick={mockOnMediaClick} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('renders media count', () => {
      render(
        <MediaGrid
          media={mockEpisodes}
          collectionType="Season"
          onMediaClick={mockOnMediaClick}
        />
      );

      expect(screen.getByText('Episodes (3)')).toBeInTheDocument();
    });

    it('renders custom title with count', () => {
      render(
        <MediaGrid
          media={mockEpisodes}
          onMediaClick={mockOnMediaClick}
          title="All Episodes"
        />
      );

      expect(screen.getByText('All Episodes (3)')).toBeInTheDocument();
    });

    it('renders media names', () => {
      render(
        <MediaGrid
          media={mockEpisodes}
          collectionType="Season"
          onMediaClick={mockOnMediaClick}
        />
      );

      expect(screen.getByText('Pilot')).toBeInTheDocument();
      expect(screen.getByText("Cat's in the Bag")).toBeInTheDocument();
    });
  });

  describe('collection type labels', () => {
    it('shows Episodes label for Season collection', () => {
      render(
        <MediaGrid
          media={mockEpisodes}
          collectionType="Season"
          onMediaClick={mockOnMediaClick}
        />
      );

      expect(screen.getByText(/episodes/i)).toBeInTheDocument();
    });

    it('shows Tracks label for Album collection', () => {
      render(
        <MediaGrid
          media={mockTracks}
          collectionType="Album"
          onMediaClick={mockOnMediaClick}
        />
      );

      expect(screen.getByText(/tracks/i)).toBeInTheDocument();
    });

    it('shows Media label for other collection types', () => {
      render(
        <MediaGrid
          media={mockEpisodes}
          collectionType="Film"
          onMediaClick={mockOnMediaClick}
        />
      );

      expect(screen.getByText(/media/i)).toBeInTheDocument();
    });
  });

  describe('episode numbers', () => {
    it('shows episode numbers for Season collection', () => {
      render(
        <MediaGrid
          media={mockEpisodes}
          collectionType="Season"
          onMediaClick={mockOnMediaClick}
        />
      );

      expect(screen.getByText('E1')).toBeInTheDocument();
      expect(screen.getByText('E2')).toBeInTheDocument();
      expect(screen.getByText('E3')).toBeInTheDocument();
    });
  });

  describe('track numbers', () => {
    it('shows track numbers for Album collection', () => {
      render(
        <MediaGrid
          media={mockTracks}
          collectionType="Album"
          onMediaClick={mockOnMediaClick}
        />
      );

      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  describe('icons', () => {
    it('shows VideoFile icon for video without image', () => {
      render(
        <MediaGrid
          media={[mockEpisodes[1]]}
          collectionType="Film"
          onMediaClick={mockOnMediaClick}
        />
      );

      expect(screen.getByTestId('VideoFileIcon')).toBeInTheDocument();
    });

    it('shows AudioFile icon for audio', () => {
      render(
        <MediaGrid
          media={mockTracks}
          collectionType="Album"
          onMediaClick={mockOnMediaClick}
        />
      );

      expect(screen.getAllByTestId('AudioFileIcon').length).toBe(2);
    });
  });

  describe('sorting', () => {
    it('sorts episodes by episode number', () => {
      const unorderedEpisodes = [
        { id: 'ep-3', name: 'Third', type: 'Video' as const, videoDetails: { episode: 3 }, images: [] },
        { id: 'ep-1', name: 'First', type: 'Video' as const, videoDetails: { episode: 1 }, images: [] },
        { id: 'ep-2', name: 'Second', type: 'Video' as const, videoDetails: { episode: 2 }, images: [] },
      ];

      render(
        <MediaGrid
          media={unorderedEpisodes}
          collectionType="Season"
          onMediaClick={mockOnMediaClick}
        />
      );

      const items = screen.getAllByText(/First|Second|Third/);
      expect(items[0]).toHaveTextContent('First');
      expect(items[1]).toHaveTextContent('Second');
      expect(items[2]).toHaveTextContent('Third');
    });

    it('sorts tracks by disc then track number', () => {
      const unorderedTracks = [
        { id: 't-3', name: 'Song Three', type: 'Audio' as const, audioDetails: { track: 3, disc: 1 }, images: [] },
        { id: 't-1', name: 'Song One', type: 'Audio' as const, audioDetails: { track: 1, disc: 1 }, images: [] },
        { id: 't-d2', name: 'Disc Two Song', type: 'Audio' as const, audioDetails: { track: 1, disc: 2 }, images: [] },
      ] as Parameters<typeof MediaGrid>[0]['media'];

      render(
        <MediaGrid
          media={unorderedTracks}
          collectionType="Album"
          onMediaClick={mockOnMediaClick}
        />
      );

      const items = screen.getAllByText(/Song/);
      expect(items[0]).toHaveTextContent('Song One');
      expect(items[1]).toHaveTextContent('Song Three');
      expect(items[2]).toHaveTextContent('Disc Two Song');
    });
  });

  describe('navigation', () => {
    it('calls onMediaClick when media clicked', async () => {
      const user = userEvent.setup();

      render(
        <MediaGrid
          media={mockEpisodes}
          collectionType="Season"
          onMediaClick={mockOnMediaClick}
        />
      );

      await user.click(screen.getByText('Pilot'));

      expect(mockOnMediaClick).toHaveBeenCalledWith('ep-1');
    });
  });
});
