import { render, screen } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { FilmHeroView } from '../FilmHeroView';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    getImageUrl: jest.fn((id: string) => `http://localhost/api/images/${id}`),
  },
}));

// Use type assertion for mock props to avoid full type requirements
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createMockProps = (overrides: Record<string, any> = {}): any => ({
  collection: {
    id: 'film-1',
    name: 'The Matrix',
    collectionType: 'Film',
    images: [
      { id: 'poster-1', imageType: 'Poster' },
      { id: 'backdrop-1', imageType: 'Backdrop' },
    ],
    library: { id: 'lib-1', name: 'Films', libraryType: 'Film' },
  },
  primaryMedia: {
    id: 'media-1',
    name: 'The Matrix',
    type: 'Video',
    duration: 8160,
    videoDetails: {
      description: 'A computer hacker learns the truth about reality.',
      releaseDate: '1999-03-31',
      rating: '8.7',
      credits: [],
    },
    images: [],
  },
  additionalMedia: [],
  breadcrumbs: [{ id: 'lib-1', name: 'Films', type: 'library' }],
  menuOpen: false,
  onBreadcrumbNavigate: jest.fn(),
  onPlay: jest.fn(),
  onMediaClick: jest.fn(),
  onPersonClick: jest.fn(),
  onMenuOpen: jest.fn(),
  ...overrides,
});

describe('FilmHeroView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('basic rendering', () => {
    it('renders collection name as heading when no logo', () => {
      const props = createMockProps({
        collection: {
          id: 'film-1',
          name: 'The Matrix',
          collectionType: 'Film',
          images: [{ id: 'backdrop-1', imageType: 'Backdrop' }],
          library: { id: 'lib-1', name: 'Films', libraryType: 'Film' },
        },
      });

      render(<FilmHeroView {...props} />);

      expect(screen.getByRole('heading', { name: 'The Matrix' })).toBeInTheDocument();
    });

    it('renders logo image when available', () => {
      const props = createMockProps({
        collection: {
          id: 'film-1',
          name: 'The Matrix',
          collectionType: 'Film',
          images: [
            { id: 'backdrop-1', imageType: 'Backdrop' },
            { id: 'logo-1', imageType: 'Logo' },
          ],
          library: { id: 'lib-1', name: 'Films', libraryType: 'Film' },
        },
      });

      render(<FilmHeroView {...props} />);

      // Logo renders as an img with alt text
      const images = screen.getAllByRole('img');
      expect(images.some(img => img.getAttribute('alt') === 'The Matrix')).toBe(true);
    });

    it('renders description text', () => {
      const props = createMockProps();

      render(<FilmHeroView {...props} />);

      expect(screen.getByText('A computer hacker learns the truth about reality.')).toBeInTheDocument();
    });

    it('renders play button', () => {
      const props = createMockProps();

      render(<FilmHeroView {...props} />);

      expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
    });
  });

  describe('metadata display', () => {
    it('renders release year', () => {
      const props = createMockProps();

      render(<FilmHeroView {...props} />);

      expect(screen.getByText('1999')).toBeInTheDocument();
    });

    it('renders duration', () => {
      const props = createMockProps();

      render(<FilmHeroView {...props} />);

      // formatDuration outputs "Xh Xm Xs" format
      expect(screen.getByText('2h 16m 0s')).toBeInTheDocument();
    });

    it('renders rating', () => {
      const props = createMockProps();

      render(<FilmHeroView {...props} />);

      expect(screen.getByText('8.7')).toBeInTheDocument();
    });

    it('does not render metadata when not provided', () => {
      const props = createMockProps({
        primaryMedia: {
          id: 'media-1',
          name: 'The Matrix',
          type: 'Video',
          videoDetails: {},
          images: [],
        },
      });

      render(<FilmHeroView {...props} />);

      expect(screen.queryByText('1999')).not.toBeInTheDocument();
    });
  });

  describe('director credits', () => {
    it('renders director section with clickable name when personId exists', async () => {
      const user = userEvent.setup();
      const onPersonClick = jest.fn();
      const props = createMockProps({
        onPersonClick,
        primaryMedia: {
          id: 'media-1',
          name: 'The Matrix',
          type: 'Video',
          videoDetails: {
            credits: [
              { id: 'cred-1', name: 'Lana Wachowski', creditType: 'Director', personId: 'person-1' },
              { id: 'cred-2', name: 'Lilly Wachowski', creditType: 'Director', personId: 'person-2' },
            ],
          },
          images: [],
        },
      });

      render(<FilmHeroView {...props} />);

      // Director label appears in the summary box
      expect(screen.getAllByText('Director').length).toBeGreaterThanOrEqual(1);

      // Click on the first director link in summary box (first occurrence)
      const directorButtons = screen.getAllByRole('button', { name: 'Lana Wachowski' });
      await user.click(directorButtons[0]);
      expect(onPersonClick).toHaveBeenCalledWith('person-1');
    });

    it('renders director name without link when no personId', () => {
      const props = createMockProps({
        primaryMedia: {
          id: 'media-1',
          name: 'The Matrix',
          type: 'Video',
          videoDetails: {
            credits: [
              { id: 'cred-1', name: 'Unknown Director', creditType: 'Director', personId: null },
            ],
          },
          images: [],
        },
      });

      render(<FilmHeroView {...props} />);

      // Director name without personId is rendered as text, not a button
      expect(screen.getAllByText('Unknown Director').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('writer credits', () => {
    it('renders writer section with clickable name when personId exists', async () => {
      const user = userEvent.setup();
      const onPersonClick = jest.fn();
      const props = createMockProps({
        onPersonClick,
        primaryMedia: {
          id: 'media-1',
          name: 'The Matrix',
          type: 'Video',
          videoDetails: {
            credits: [
              { id: 'cred-1', name: 'Lana Wachowski', creditType: 'Writer', personId: 'person-1' },
            ],
          },
          images: [],
        },
      });

      render(<FilmHeroView {...props} />);

      // Writer label appears in the summary box
      expect(screen.getAllByText('Writer').length).toBeGreaterThanOrEqual(1);

      const writerButtons = screen.getAllByRole('button', { name: 'Lana Wachowski' });
      await user.click(writerButtons[0]);
      expect(onPersonClick).toHaveBeenCalledWith('person-1');
    });

    it('renders writer name without link when no personId', () => {
      const props = createMockProps({
        primaryMedia: {
          id: 'media-1',
          name: 'The Matrix',
          type: 'Video',
          videoDetails: {
            credits: [
              { id: 'cred-1', name: 'Unknown Writer', creditType: 'Writer', personId: null },
            ],
          },
          images: [],
        },
      });

      render(<FilmHeroView {...props} />);

      // Writer name without personId is rendered as text
      expect(screen.getAllByText('Unknown Writer').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('cast credits', () => {
    it('renders cast section with clickable names', async () => {
      const user = userEvent.setup();
      const onPersonClick = jest.fn();
      const props = createMockProps({
        onPersonClick,
        primaryMedia: {
          id: 'media-1',
          name: 'The Matrix',
          type: 'Video',
          videoDetails: {
            credits: [
              { id: 'cred-1', name: 'Keanu Reeves', role: 'Neo', creditType: 'Actor', personId: 'person-1' },
            ],
          },
          images: [],
        },
      });

      render(<FilmHeroView {...props} />);

      // Cast label appears in summary
      expect(screen.getAllByText('Cast').length).toBeGreaterThanOrEqual(1);

      // Actor with role shown as "Name (Role)" in the summary box
      const actorButtons = screen.getAllByRole('button', { name: 'Keanu Reeves (Neo)' });
      await user.click(actorButtons[0]);
      expect(onPersonClick).toHaveBeenCalledWith('person-1');
    });

    it('renders actor without role when role is null', () => {
      const props = createMockProps({
        primaryMedia: {
          id: 'media-1',
          name: 'The Matrix',
          type: 'Video',
          videoDetails: {
            credits: [
              { id: 'cred-1', name: 'Extra Actor', role: null, creditType: 'Actor', personId: 'person-1' },
            ],
          },
          images: [],
        },
      });

      render(<FilmHeroView {...props} />);

      // Actor without role shown as just name (multiple occurrences possible from summary + CastCrewGrid)
      const actorButtons = screen.getAllByRole('button', { name: 'Extra Actor' });
      expect(actorButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('renders actor without link when no personId', () => {
      const props = createMockProps({
        primaryMedia: {
          id: 'media-1',
          name: 'The Matrix',
          type: 'Video',
          videoDetails: {
            credits: [
              { id: 'cred-1', name: 'Unknown Actor', role: 'Background', creditType: 'Actor', personId: null },
            ],
          },
          images: [],
        },
      });

      render(<FilmHeroView {...props} />);

      // Actor without personId shown as "Name (Role)" text
      expect(screen.getAllByText('Unknown Actor (Background)').length).toBeGreaterThanOrEqual(1);
    });

    it('renders actor name only when no personId and no role', () => {
      const props = createMockProps({
        primaryMedia: {
          id: 'media-1',
          name: 'The Matrix',
          type: 'Video',
          videoDetails: {
            credits: [
              { id: 'cred-1', name: 'Anonymous Extra', role: null, creditType: 'Actor', personId: null },
            ],
          },
          images: [],
        },
      });

      render(<FilmHeroView {...props} />);

      // Actor name appears as text
      expect(screen.getAllByText('Anonymous Extra').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('special features', () => {
    it('renders special features section when additionalMedia exists', () => {
      const props = createMockProps({
        additionalMedia: [
          { id: 'extra-1', name: 'Behind the Scenes', type: 'Video', images: [] },
          { id: 'extra-2', name: 'Making Of', type: 'Video', images: [] },
        ],
      });

      render(<FilmHeroView {...props} />);

      expect(screen.getByText('Special Features (2)')).toBeInTheDocument();
      expect(screen.getByText('Behind the Scenes')).toBeInTheDocument();
      expect(screen.getByText('Making Of')).toBeInTheDocument();
    });

    it('renders special feature with image', () => {
      const props = createMockProps({
        additionalMedia: [
          {
            id: 'extra-1',
            name: 'Behind the Scenes',
            type: 'Video',
            images: [{ id: 'still-1', imageType: 'Still' }]
          },
        ],
      });

      render(<FilmHeroView {...props} />);

      // Should have an image with the feature name as alt text
      expect(screen.getByAltText('Behind the Scenes')).toBeInTheDocument();
    });

    it('renders special feature without image shows icon', () => {
      const props = createMockProps({
        additionalMedia: [
          { id: 'extra-1', name: 'Deleted Scenes', type: 'Video', images: [] },
        ],
      });

      render(<FilmHeroView {...props} />);

      expect(screen.getByTestId('VideoFileIcon')).toBeInTheDocument();
    });

    it('calls onMediaClick when special feature clicked', async () => {
      const user = userEvent.setup();
      const onMediaClick = jest.fn();
      const props = createMockProps({
        onMediaClick,
        additionalMedia: [
          { id: 'extra-1', name: 'Behind the Scenes', type: 'Video', images: [] },
        ],
      });

      render(<FilmHeroView {...props} />);

      await user.click(screen.getByText('Behind the Scenes'));
      expect(onMediaClick).toHaveBeenCalledWith('extra-1');
    });

    it('does not render special features when empty', () => {
      const props = createMockProps({ additionalMedia: [] });

      render(<FilmHeroView {...props} />);

      expect(screen.queryByText(/special features/i)).not.toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls onPlay when play button clicked', async () => {
      const user = userEvent.setup();
      const onPlay = jest.fn();
      const props = createMockProps({ onPlay });

      render(<FilmHeroView {...props} />);

      await user.click(screen.getByRole('button', { name: /play/i }));
      expect(onPlay).toHaveBeenCalledWith('media-1');
    });

    it('calls onMenuOpen when options button clicked', async () => {
      const user = userEvent.setup();
      const onMenuOpen = jest.fn();
      const props = createMockProps({ onMenuOpen });

      render(<FilmHeroView {...props} />);

      await user.click(screen.getByRole('button', { name: /more options/i }));
      expect(onMenuOpen).toHaveBeenCalled();
    });

    it('calls onBreadcrumbNavigate when breadcrumb clicked', async () => {
      const user = userEvent.setup();
      const onBreadcrumbNavigate = jest.fn();
      const props = createMockProps({ onBreadcrumbNavigate });

      render(<FilmHeroView {...props} />);

      await user.click(screen.getByText('Films'));
      expect(onBreadcrumbNavigate).toHaveBeenCalledWith({ id: 'lib-1', name: 'Films', type: 'library' });
    });
  });

  describe('no description or credits', () => {
    it('does not render description box when no description and no credits', () => {
      const props = createMockProps({
        primaryMedia: {
          id: 'media-1',
          name: 'The Matrix',
          type: 'Video',
          videoDetails: {
            description: null,
            credits: [],
          },
          images: [],
        },
      });

      render(<FilmHeroView {...props} />);

      // The description Paper element should not be rendered
      expect(screen.queryByText('Director')).not.toBeInTheDocument();
      expect(screen.queryByText('Writer')).not.toBeInTheDocument();
      expect(screen.queryByText('Cast')).not.toBeInTheDocument();
    });
  });

  describe('mixed credits', () => {
    it('renders all credit types when present', async () => {
      const user = userEvent.setup();
      const onPersonClick = jest.fn();
      const props = createMockProps({
        onPersonClick,
        primaryMedia: {
          id: 'media-1',
          name: 'The Matrix',
          type: 'Video',
          videoDetails: {
            description: 'Test description',
            credits: [
              { id: 'cred-1', name: 'Director Person', creditType: 'Director', personId: 'person-1' },
              { id: 'cred-2', name: 'Writer Person', creditType: 'Writer', personId: 'person-2' },
              { id: 'cred-3', name: 'Actor Person', role: 'Lead', creditType: 'Actor', personId: 'person-3' },
            ],
          },
          images: [],
        },
      });

      render(<FilmHeroView {...props} />);

      // All credit type labels appear
      expect(screen.getAllByText('Director').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Writer').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Cast').length).toBeGreaterThanOrEqual(1);

      // Click on director (first occurrence in summary box)
      const directorButtons = screen.getAllByRole('button', { name: 'Director Person' });
      await user.click(directorButtons[0]);
      expect(onPersonClick).toHaveBeenCalledWith('person-1');

      // Click on writer (first occurrence)
      const writerButtons = screen.getAllByRole('button', { name: 'Writer Person' });
      await user.click(writerButtons[0]);
      expect(onPersonClick).toHaveBeenCalledWith('person-2');

      // Click on actor (first occurrence)
      const actorButtons = screen.getAllByRole('button', { name: 'Actor Person (Lead)' });
      await user.click(actorButtons[0]);
      expect(onPersonClick).toHaveBeenCalledWith('person-3');
    });
  });
});
