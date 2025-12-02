import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { PersonPage } from '../PersonPage';
import { apiClient } from '../../api/client';
import type { PersonWithFilmography } from '../../api/client';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    getPerson: jest.fn(),
    refreshPersonMetadata: jest.fn(),
    getImageUrl: jest.fn((id: string) => `http://localhost/api/images/${id}`),
  },
}));

// Mock useParams and useNavigate
let mockPersonId: string | undefined = 'person-123';
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ personId: mockPersonId }),
  useNavigate: () => mockNavigate,
}));

// Mock useAuth - default to Admin user
let mockUser: { id: string; name: string; role: 'Admin' | 'Editor' | 'Viewer' } = { id: 'user-1', name: 'Admin', role: 'Admin' };
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

// Mock person data - using type assertion for extended properties
const mockPerson = {
  id: 'person-123',
  name: 'Keanu Reeves',
  biography: 'Keanu Charles Reeves is a Canadian actor. Born in Beirut and raised in Toronto, Reeves began acting in theatre productions and in television films before making his feature film debut.',
  birthDate: '1964-09-02',
  deathDate: null,
  birthPlace: 'Beirut, Lebanon',
  knownFor: 'Acting',
  tmdbId: 6384,
  tvdbId: null,
  imdbId: 'nm0000206',
  createdAt: '',
  updatedAt: '',
  images: [
    {
      id: 'img-person-1',
      imageType: 'Photo',
      isPrimary: true,
    },
  ],
  filmography: {
    shows: [
      {
        collection: {
          id: 'col-show-1',
          name: 'Swedish Dicks',
          collectionType: 'Show',
          images: [{ id: 'img-show-1', imageType: 'Poster', isPrimary: true }],
        },
        credit: {
          id: 'credit-show-1',
          role: 'Tex Johnson',
          creditType: 'Actor',
        },
      },
    ],
    films: [
      {
        collection: {
          id: 'col-film-1',
          name: 'The Matrix',
          collectionType: 'Film',
          images: [{ id: 'img-film-1', imageType: 'Poster', isPrimary: true }],
        },
        credit: {
          id: 'credit-film-1',
          role: 'Neo',
          creditType: 'Actor',
        },
        media: { id: 'media-film-1', name: 'The Matrix' },
      },
      {
        collection: {
          id: 'col-film-2',
          name: 'John Wick',
          collectionType: 'Film',
          images: [],
        },
        credit: {
          id: 'credit-film-2',
          role: 'John Wick',
          creditType: 'Actor',
        },
        media: { id: 'media-film-2', name: 'John Wick' },
      },
    ],
    episodes: [
      {
        media: {
          id: 'media-ep-1',
          name: 'The One',
          collection: {
            id: 'col-season',
            name: 'Season 1',
            parent: {
              id: 'col-show-guest',
              name: 'Guest Show',
            },
          },
          videoDetails: {
            showName: 'Guest Show',
            season: 1,
            episode: 5,
          },
          images: [],
        },
        credit: {
          id: 'credit-ep-1',
          role: 'Guest Star',
          creditType: 'Actor',
        },
      },
    ],
  },
} as PersonWithFilmography;

// Person with death date
const mockDeceasedPerson: PersonWithFilmography = {
  ...mockPerson,
  id: 'person-deceased',
  name: 'Robin Williams',
  birthDate: '1951-07-21',
  deathDate: '2014-08-11',
  biography: 'Robin McLaurin Williams was an American actor and comedian.',
  birthPlace: 'Chicago, Illinois, USA',
};

// Person with minimal data
const mockMinimalPerson: PersonWithFilmography = {
  ...mockPerson,
  id: 'person-minimal',
  name: 'Unknown Actor',
  biography: null,
  birthDate: null,
  deathDate: null,
  birthPlace: null,
  knownFor: null,
  tmdbId: null,
  tvdbId: null,
  imdbId: null,
  images: [],
  filmography: {
    shows: [],
    films: [],
    episodes: [],
  },
};

// Person with director credits
const mockDirectorPerson: PersonWithFilmography = {
  ...mockPerson,
  id: 'person-director',
  name: 'Christopher Nolan',
  knownFor: 'Directing',
  filmography: {
    shows: [],
    films: [
      {
        collection: {
          id: 'col-inception',
          name: 'Inception',
          collectionType: 'Film',
          images: [],
        },
        credit: {
          id: 'credit-dir-1',
          role: null,
          creditType: 'Director',
        },
        media: { id: 'media-inception', name: 'Inception' },
      },
      {
        collection: {
          id: 'col-tenet',
          name: 'Tenet',
          collectionType: 'Film',
          images: [],
        },
        credit: {
          id: 'credit-writer-1',
          role: null,
          creditType: 'Writer',
        },
        media: { id: 'media-tenet', name: 'Tenet' },
      },
    ],
    episodes: [],
  },
};

describe('PersonPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPersonId = 'person-123';
    mockUser = { id: 'user-1', name: 'Admin', role: 'Admin' };
    mockApiClient.getPerson.mockResolvedValue({ data: { person: mockPerson } });
  });

  describe('loading state', () => {
    it('shows loading spinner while fetching', () => {
      mockApiClient.getPerson.mockImplementation(() => new Promise(() => {}));

      render(<PersonPage />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('shows loading text', () => {
      mockApiClient.getPerson.mockImplementation(() => new Promise(() => {}));

      render(<PersonPage />);

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('hides loading spinner after data loads', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows error message when fetch fails', async () => {
      mockApiClient.getPerson.mockResolvedValue({ error: 'Failed to load person' });

      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load person')).toBeInTheDocument();
      });
    });

    it('shows not found message when person is null', async () => {
      mockApiClient.getPerson.mockResolvedValue({ data: { person: null as unknown as PersonWithFilmography } });

      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });
  });

  describe('person details rendering', () => {
    it('shows person name', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Keanu Reeves' })).toBeInTheDocument();
      });
    });

    it('shows person photo', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByAltText('Keanu Reeves')).toBeInTheDocument();
      });
    });

    it('shows known for chip', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByText('Acting')).toBeInTheDocument();
      });
    });

    it('shows birth date', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        // Find the Born label specifically (the one with the date, not in biography)
        const bornElements = screen.getAllByText(/born/i);
        // At least one element should contain the formatted date
        const hasDate = bornElements.some(el => el.textContent?.includes('1964'));
        expect(hasDate).toBe(true);
      });
    });

    it('shows age for living person', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        // Should show age in parentheses
        expect(screen.getByText(/\(age \d+\)/i)).toBeInTheDocument();
      });
    });

    it('shows birth place', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByText('Beirut, Lebanon')).toBeInTheDocument();
      });
    });

    it('shows biography', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByText(/keanu charles reeves is a canadian actor/i)).toBeInTheDocument();
      });
    });

    it('shows placeholder when no photo', async () => {
      mockApiClient.getPerson.mockResolvedValue({ data: { person: mockMinimalPerson } });

      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByTestId('PersonIcon')).toBeInTheDocument();
      });
    });
  });

  describe('deceased person', () => {
    beforeEach(() => {
      mockApiClient.getPerson.mockResolvedValue({ data: { person: mockDeceasedPerson } });
    });

    it('shows death date', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        // Find Died label with the date
        const diedElement = screen.getByText(/died.*2014/i);
        expect(diedElement).toBeInTheDocument();
      });
    });

    it('shows age at death', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        // Should show age 63 (1951-2014)
        expect(screen.getByText(/\(age 63\)/i)).toBeInTheDocument();
      });
    });
  });

  describe('external links', () => {
    it('shows IMDb link', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByText('IMDb')).toBeInTheDocument();
      });
    });

    it('shows TMDB link', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByText('TMDB')).toBeInTheDocument();
      });
    });

    it('has correct IMDb href', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        const imdbLink = screen.getByText('IMDb').closest('a');
        expect(imdbLink).toHaveAttribute('href', 'https://www.imdb.com/name/nm0000206');
      });
    });

    it('has correct TMDB href', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        const tmdbLink = screen.getByText('TMDB').closest('a');
        expect(tmdbLink).toHaveAttribute('href', 'https://www.themoviedb.org/person/6384');
      });
    });

    it('does not show external links when not available', async () => {
      mockApiClient.getPerson.mockResolvedValue({ data: { person: mockMinimalPerson } });

      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Unknown Actor' })).toBeInTheDocument();
      });

      expect(screen.queryByText('IMDb')).not.toBeInTheDocument();
      expect(screen.queryByText('TMDB')).not.toBeInTheDocument();
    });
  });

  describe('filmography - shows', () => {
    it('shows Shows section with count', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByText(/shows \(1\)/i)).toBeInTheDocument();
      });
    });

    it('shows show name', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByText('Swedish Dicks')).toBeInTheDocument();
      });
    });

    it('shows role in show', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByText('Tex Johnson')).toBeInTheDocument();
      });
    });

    it('navigates to show when clicked', async () => {
      const user = userEvent.setup();

      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByText('Swedish Dicks')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Swedish Dicks'));

      expect(mockNavigate).toHaveBeenCalledWith('/collection/col-show-1');
    });
  });

  describe('filmography - films', () => {
    it('shows Films section with count', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByText(/films \(2\)/i)).toBeInTheDocument();
      });
    });

    it('shows film names', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByText('The Matrix')).toBeInTheDocument();
        // John Wick appears as both film name and role, so use getAllByText
        const johnWickElements = screen.getAllByText('John Wick');
        expect(johnWickElements.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('shows roles in films', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByText('Neo')).toBeInTheDocument();
        // John Wick appears as both film name and role
        const johnWickElements = screen.getAllByText('John Wick');
        expect(johnWickElements.length).toBeGreaterThanOrEqual(2); // Should be at least 2: name + role
      });
    });

    it('navigates to film when clicked', async () => {
      const user = userEvent.setup();

      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByText('The Matrix')).toBeInTheDocument();
      });

      await user.click(screen.getByText('The Matrix'));

      expect(mockNavigate).toHaveBeenCalledWith('/collection/col-film-1');
    });

    it('shows placeholder for films without images', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        // John Wick has no images, should show Movie icon
        expect(screen.getAllByTestId('MovieIcon').length).toBeGreaterThan(0);
      });
    });
  });

  describe('filmography - episodes', () => {
    it('shows Episodes section with count', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByText(/episode appearances \(1\)/i)).toBeInTheDocument();
      });
    });

    it('shows episode name', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByText('The One')).toBeInTheDocument();
      });
    });

    it('shows show name and episode number', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByText(/guest show.*s01e05/i)).toBeInTheDocument();
      });
    });

    it('shows role in episode', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByText('Guest Star')).toBeInTheDocument();
      });
    });

    it('navigates to episode when clicked', async () => {
      const user = userEvent.setup();

      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByText('The One')).toBeInTheDocument();
      });

      await user.click(screen.getByText('The One'));

      expect(mockNavigate).toHaveBeenCalledWith('/media/media-ep-1');
    });
  });

  describe('credit type grouping', () => {
    beforeEach(() => {
      mockApiClient.getPerson.mockResolvedValue({ data: { person: mockDirectorPerson } });
    });

    it('shows credit type label for directors', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByText(/directing \(1\)/i)).toBeInTheDocument();
      });
    });

    it('shows credit type label for writers', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByText(/writing \(1\)/i)).toBeInTheDocument();
      });
    });
  });

  describe('admin actions', () => {
    it('shows options menu button for admin', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
      });
    });

    it('opens menu when more button clicked', async () => {
      const user = userEvent.setup();

      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /more options/i }));

      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('shows refresh metadata option', async () => {
      const user = userEvent.setup();

      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /more options/i }));

      expect(screen.getByText(/refresh metadata/i)).toBeInTheDocument();
    });

    it('calls refresh metadata API when clicked', async () => {
      const user = userEvent.setup();
      mockApiClient.refreshPersonMetadata.mockResolvedValue({ data: { message: 'Success', person: mockPerson } });

      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /more options/i }));
      await user.click(screen.getByText(/refresh metadata/i));

      expect(mockApiClient.refreshPersonMetadata).toHaveBeenCalledWith('person-123');
    });

    it('shows error when refresh fails', async () => {
      const user = userEvent.setup();
      mockApiClient.refreshPersonMetadata.mockResolvedValue({ error: 'Refresh failed' });

      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /more options/i }));
      await user.click(screen.getByText(/refresh metadata/i));

      await waitFor(() => {
        expect(screen.getByText('Refresh failed')).toBeInTheDocument();
      });
    });

    it('hides options menu for viewer', async () => {
      mockUser = { id: 'user-2', name: 'Viewer', role: 'Viewer' };

      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Keanu Reeves' })).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /more options/i })).not.toBeInTheDocument();
    });

    it('shows options menu for editor', async () => {
      mockUser = { id: 'user-2', name: 'Editor', role: 'Editor' };

      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
      });
    });
  });

  describe('empty filmography', () => {
    beforeEach(() => {
      mockApiClient.getPerson.mockResolvedValue({ data: { person: mockMinimalPerson } });
    });

    it('does not show Shows section when empty', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Unknown Actor' })).toBeInTheDocument();
      });

      expect(screen.queryByText(/shows \(\d+\)/i)).not.toBeInTheDocument();
    });

    it('does not show Films section when empty', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Unknown Actor' })).toBeInTheDocument();
      });

      expect(screen.queryByText(/films \(\d+\)/i)).not.toBeInTheDocument();
    });

    it('does not show Episodes section when empty', async () => {
      render(<PersonPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Unknown Actor' })).toBeInTheDocument();
      });

      expect(screen.queryByText(/episode appearances/i)).not.toBeInTheDocument();
    });
  });

  describe('no personId', () => {
    it('does not fetch when personId is undefined', () => {
      mockPersonId = undefined;

      render(<PersonPage />);

      expect(mockApiClient.getPerson).not.toHaveBeenCalled();
    });
  });
});
