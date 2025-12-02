import { render, screen } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { CastCrewGrid } from '../CastCrewGrid';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    getImageUrl: jest.fn((id: string) => `http://localhost/api/images/${id}`),
  },
}));

// Use type assertion to avoid full type requirements in tests
const mockCredits = [
  {
    id: 'cred-1',
    name: 'Keanu Reeves',
    role: 'Neo',
    creditType: 'Actor',
    personId: 'person-1',
    person: { id: 'person-1', images: [{ id: 'img-1', imageType: 'Photo' }] },
  },
  {
    id: 'cred-2',
    name: 'Laurence Fishburne',
    role: 'Morpheus',
    creditType: 'Actor',
    personId: 'person-2',
    person: { id: 'person-2', images: [] },
  },
  {
    id: 'cred-3',
    name: 'The Wachowskis',
    role: null,
    creditType: 'Director',
    personId: 'person-3',
    person: null,
  },
  {
    id: 'cred-4',
    name: 'Andrew Mason',
    role: null,
    creditType: 'Writer',
    personId: null,
    person: null,
  },
] as Parameters<typeof CastCrewGrid>[0]['credits'];

describe('CastCrewGrid', () => {
  const mockOnPersonClick = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders section title', () => {
      render(
        <CastCrewGrid credits={mockCredits} onPersonClick={mockOnPersonClick} />
      );

      expect(screen.getByText('Cast & Crew')).toBeInTheDocument();
    });

    it('renders custom title', () => {
      render(
        <CastCrewGrid
          credits={mockCredits}
          onPersonClick={mockOnPersonClick}
          title="Movie Credits"
        />
      );

      expect(screen.getByText('Movie Credits')).toBeInTheDocument();
    });

    it('renders actor names', () => {
      render(
        <CastCrewGrid credits={mockCredits} onPersonClick={mockOnPersonClick} />
      );

      expect(screen.getByText('Keanu Reeves')).toBeInTheDocument();
      expect(screen.getByText('Laurence Fishburne')).toBeInTheDocument();
    });

    it('renders actor roles', () => {
      render(
        <CastCrewGrid credits={mockCredits} onPersonClick={mockOnPersonClick} />
      );

      expect(screen.getByText('Neo')).toBeInTheDocument();
      expect(screen.getByText('Morpheus')).toBeInTheDocument();
    });

    it('renders director names', () => {
      render(
        <CastCrewGrid credits={mockCredits} onPersonClick={mockOnPersonClick} />
      );

      expect(screen.getByText('The Wachowskis')).toBeInTheDocument();
    });

    it('renders credit type label for non-actors', () => {
      render(
        <CastCrewGrid credits={mockCredits} onPersonClick={mockOnPersonClick} />
      );

      expect(screen.getByText('Director')).toBeInTheDocument();
      expect(screen.getByText('Writer')).toBeInTheDocument();
    });

    it('renders placeholder for credits without images', () => {
      render(
        <CastCrewGrid credits={mockCredits} onPersonClick={mockOnPersonClick} />
      );

      // Should have PersonIcon placeholders
      expect(screen.getAllByTestId('PersonIcon').length).toBeGreaterThan(0);
    });

    it('does not render when credits array is empty', () => {
      const { container } = render(
        <CastCrewGrid credits={[]} onPersonClick={mockOnPersonClick} />
      );

      expect(container.firstChild).toBeNull();
    });
  });

  describe('ordering', () => {
    it('orders actors first, then directors, then writers', () => {
      render(
        <CastCrewGrid credits={mockCredits} onPersonClick={mockOnPersonClick} />
      );

      const names = screen.getAllByText(
        /Keanu Reeves|Laurence Fishburne|The Wachowskis|Andrew Mason/
      );

      // Actors should come before Directors and Writers
      expect(names[0]).toHaveTextContent('Keanu Reeves');
      expect(names[1]).toHaveTextContent('Laurence Fishburne');
    });
  });

  describe('max actors limit', () => {
    it('limits actors to maxActors prop', () => {
      const manyActors = Array.from({ length: 15 }, (_, i) => ({
        id: `cred-actor-${i}`,
        name: `Actor ${i}`,
        role: `Role ${i}`,
        creditType: 'Actor',
        personId: `person-${i}`,
        person: null,
      }));

      render(
        <CastCrewGrid
          credits={manyActors}
          onPersonClick={mockOnPersonClick}
          maxActors={5}
        />
      );

      // Should only show 5 actors
      expect(screen.getByText('Actor 0')).toBeInTheDocument();
      expect(screen.getByText('Actor 4')).toBeInTheDocument();
      expect(screen.queryByText('Actor 5')).not.toBeInTheDocument();
    });
  });

  describe('navigation', () => {
    it('calls onPersonClick when credit with personId clicked', async () => {
      const user = userEvent.setup();

      render(
        <CastCrewGrid credits={mockCredits} onPersonClick={mockOnPersonClick} />
      );

      await user.click(screen.getByText('Keanu Reeves'));

      expect(mockOnPersonClick).toHaveBeenCalledWith('person-1');
    });

    it('disables click on credit without personId', () => {
      render(
        <CastCrewGrid credits={mockCredits} onPersonClick={mockOnPersonClick} />
      );

      // Find the card containing Andrew Mason (who has no personId)
      const andrewMasonText = screen.getByText('Andrew Mason');
      // The CardActionArea should have pointer-events: none when disabled
      const cardActionArea = andrewMasonText.closest('.MuiCardActionArea-root');
      expect(cardActionArea).toHaveStyle({ pointerEvents: 'none' });
    });
  });
});
