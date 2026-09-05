import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { LibraryScrapeStatusPage } from '../LibraryScrapeStatusPage';
import { apiClient } from '../../api/client';
import type { UnmatchedItem } from '../../api/client';

jest.mock('../../api/client', () => ({
  apiClient: {
    getLibrary: jest.fn(),
    getLibraryScrapeStatus: jest.fn(),
    getLibraryUnmatched: jest.fn(),
  },
}));

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useParams: () => ({ libraryId: 'lib-1' }),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

const counts = (over: Partial<Record<string, number>> = {}) => ({
  Matched: 0,
  NoMatch: 0,
  Failed: 0,
  Pending: 0,
  Unscraped: 0,
  ...over,
});

function item(over: Partial<UnmatchedItem> = {}): UnmatchedItem {
  return {
    id: 'col-1',
    kind: 'collection',
    name: 'The Thing',
    type: 'Film',
    parentName: null,
    status: 'NoMatch',
    message: 'Nothing scored high enough',
    scrapedAt: '2026-09-01T00:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getLibrary.mockResolvedValue({ data: { library: { name: 'Films' } } } as never);
  mockApi.getLibraryScrapeStatus.mockResolvedValue({
    data: { collections: counts({ Matched: 40, NoMatch: 2 }), media: counts({ Failed: 1 }) },
  } as never);
  mockApi.getLibraryUnmatched.mockResolvedValue({ data: { items: [item()], total: 1 } } as never);
});

describe('LibraryScrapeStatusPage', () => {
  it('sums collections and media, since a viewer counts items not tables', async () => {
    render(<LibraryScrapeStatusPage />);

    expect(await screen.findByText('40 matched')).toBeInTheDocument();
    expect(screen.getByText('2 unmatched')).toBeInTheDocument();
    expect(screen.getByText('1 failed')).toBeInTheDocument();
  });

  it('lists what did not match, with the reason', async () => {
    render(<LibraryScrapeStatusPage />);

    expect(await screen.findByText('The Thing')).toBeInTheDocument();
    expect(screen.getByText('Nothing scored high enough')).toBeInTheDocument();
    expect(screen.getByText('No match')).toBeInTheDocument();
  });

  it('shows what an episode sits under, so two "Pilot"s can be told apart', async () => {
    mockApi.getLibraryUnmatched.mockResolvedValue({
      data: {
        items: [item({ id: 'm-1', kind: 'media', name: 'Pilot', type: 'Video', parentName: 'Season 1' })],
        total: 1,
      },
    } as never);

    render(<LibraryScrapeStatusPage />);

    expect(await screen.findByText('Pilot')).toBeInTheDocument();
    expect(screen.getByText('Season 1')).toBeInTheDocument();
  });

  it('opens a collection or a media item at the right page', async () => {
    const user = userEvent.setup();
    render(<LibraryScrapeStatusPage />);
    await user.click(await screen.findByRole('button', { name: 'The Thing' }));
    expect(mockNavigate).toHaveBeenCalledWith('/collection/col-1');

    mockApi.getLibraryUnmatched.mockResolvedValue({
      data: { items: [item({ id: 'm-1', kind: 'media', name: 'Pilot' })], total: 1 },
    } as never);
    render(<LibraryScrapeStatusPage />);
    await user.click(await screen.findByRole('button', { name: 'Pilot' }));
    expect(mockNavigate).toHaveBeenCalledWith('/media/m-1');
  });

  it('narrows the list to a status when its chip is picked', async () => {
    const user = userEvent.setup();
    render(<LibraryScrapeStatusPage />);
    await screen.findByText('2 unmatched');

    await user.click(screen.getByText('1 failed'));

    await waitFor(() =>
      expect(mockApi.getLibraryUnmatched).toHaveBeenLastCalledWith('lib-1', {
        statuses: ['Failed'],
        skip: 0,
        take: 50,
      })
    );
  });

  it('will not filter by a status the library has none of', async () => {
    const user = userEvent.setup();
    mockApi.getLibraryScrapeStatus.mockResolvedValue({
      data: { collections: counts({ Matched: 40 }), media: counts() },
    } as never);

    render(<LibraryScrapeStatusPage />);
    const chip = (await screen.findByText('0 unmatched')).closest('.MuiChip-root');

    // Nothing to narrow to, so the chip is not something to press.
    expect(chip).toHaveClass('Mui-disabled');

    // The ones with something behind them still are.
    await user.click(screen.getByText('40 matched'));
    expect(screen.getByText('40 matched').closest('.MuiChip-root')).not.toHaveClass('Mui-disabled');
  });

  it('says so when a library has nothing outstanding', async () => {
    mockApi.getLibraryScrapeStatus.mockResolvedValue({
      data: { collections: counts({ Matched: 40 }), media: counts() },
    } as never);
    mockApi.getLibraryUnmatched.mockResolvedValue({ data: { items: [], total: 0 } } as never);

    render(<LibraryScrapeStatusPage />);

    expect(await screen.findByText(/has its metadata/i)).toBeInTheDocument();
  });

  it('pages once there is more than a page', async () => {
    const user = userEvent.setup();
    mockApi.getLibraryUnmatched.mockResolvedValue({ data: { items: [item()], total: 120 } } as never);

    render(<LibraryScrapeStatusPage />);
    await screen.findByText('The Thing');

    await user.click(screen.getByRole('button', { name: 'Go to page 2' }));

    await waitFor(() =>
      expect(mockApi.getLibraryUnmatched).toHaveBeenLastCalledWith('lib-1', {
        statuses: undefined,
        skip: 50,
        take: 50,
      })
    );
  });

  it('does not page when everything fits', async () => {
    render(<LibraryScrapeStatusPage />);
    await screen.findByText('The Thing');

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('shows the error when the list cannot be loaded', async () => {
    mockApi.getLibraryUnmatched.mockResolvedValue({ error: 'Server is down' } as never);

    render(<LibraryScrapeStatusPage />);

    expect(await screen.findByText('Server is down')).toBeInTheDocument();
  });
});
