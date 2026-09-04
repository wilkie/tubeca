import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { IdentifyDialog } from '../IdentifyDialog';
import { apiClient } from '../../api/client';

jest.mock('../../api/client', () => ({
  apiClient: {
    searchForIdentification: jest.fn(),
    identifyCollection: jest.fn(),
    getImageUrl: jest.fn((id: string) => `http://localhost/api/images/${id}`),
  },
}));
const mockApi = apiClient as jest.Mocked<typeof apiClient>;

const onClose = jest.fn();
const onIdentified = jest.fn();

const results = [
  { externalId: 'tv-1396', scraperId: 'tmdb', title: 'Breaking Bad', year: 2008, overview: 'A teacher' },
  { externalId: 'tv-999', scraperId: 'tmdb', title: 'Breaking Bad Better', year: 2015 },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.searchForIdentification.mockResolvedValue({ data: { results } } as never);
  mockApi.identifyCollection.mockResolvedValue({ data: { message: 'queued' } } as never);
});

function renderDialog(props: Partial<Parameters<typeof IdentifyDialog>[0]> = {}) {
  return render(
    <IdentifyDialog
      open
      onClose={onClose}
      collectionId="col-1"
      collectionName="Breaking Bad (2008)"
      collectionType="Show"
      onIdentified={onIdentified}
      {...props}
    />
  );
}

describe('IdentifyDialog', () => {
  it('pre-fills the title and year parsed out of the folder name', () => {
    renderDialog();

    expect(screen.getByLabelText(/search by title/i)).toHaveValue('Breaking Bad');
    expect(screen.getByLabelText(/year/i)).toHaveValue('2008');
  });

  it('prefers a year it already knows over the parsed one', () => {
    renderDialog({ year: 2010 });

    expect(screen.getByLabelText(/year/i)).toHaveValue('2010');
  });

  it('searches with the title, the type and the year', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() =>
      expect(mockApi.searchForIdentification).toHaveBeenCalledWith('Breaking Bad', 'Show', 2008)
    );
    expect(await screen.findByText('Breaking Bad')).toBeInTheDocument();
  });

  it('searches on Enter as well', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText(/search by title/i), '{Enter}');

    await waitFor(() => expect(mockApi.searchForIdentification).toHaveBeenCalled());
  });

  it('will not search with an empty title', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.clear(screen.getByLabelText(/search by title/i));

    expect(screen.getByRole('button', { name: /^search$/i })).toBeDisabled();
    await user.type(screen.getByLabelText(/search by title/i), '{Enter}');
    expect(mockApi.searchForIdentification).not.toHaveBeenCalled();
  });

  it('says when a search found nothing', async () => {
    const user = userEvent.setup();
    mockApi.searchForIdentification.mockResolvedValue({ data: { results: [] } } as never);
    renderDialog();

    await user.click(screen.getByRole('button', { name: /^search$/i }));

    expect(await screen.findByText(/no results found/i)).toBeInTheDocument();
  });

  it('shows the error when a search fails', async () => {
    const user = userEvent.setup();
    mockApi.searchForIdentification.mockResolvedValue({ error: 'TMDB is unreachable' } as never);
    renderDialog();

    await user.click(screen.getByRole('button', { name: /^search$/i }));

    expect(await screen.findByText('TMDB is unreachable')).toBeInTheDocument();
  });

  it('identifies the collection as the result that was picked', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    await user.click(await screen.findByText('Breaking Bad'));

    await waitFor(() =>
      expect(mockApi.identifyCollection).toHaveBeenCalledWith('col-1', 'tv-1396', 'tmdb')
    );
    expect(onIdentified).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('stays open and explains when identifying fails', async () => {
    const user = userEvent.setup();
    mockApi.identifyCollection.mockResolvedValue({ error: 'Collection not found' } as never);
    renderDialog();
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await user.click(await screen.findByText('Breaking Bad'));

    expect(await screen.findByText('Collection not found')).toBeInTheDocument();
    expect(onIdentified).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls a film a film', () => {
    renderDialog({ collectionType: 'Film', collectionName: 'Heat (1995)' });

    expect(screen.getByText(/identify film/i)).toBeInTheDocument();
  });
});
