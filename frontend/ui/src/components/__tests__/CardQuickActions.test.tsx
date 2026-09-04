import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { CardQuickActions } from '../CardQuickActions';
import { apiClient } from '../../api/client';

jest.mock('../../api/client', () => ({
  apiClient: {
    toggleFavorite: jest.fn(),
    toggleWatchLater: jest.fn(),
    getUserCollections: jest.fn(),
    addUserCollectionItem: jest.fn(),
  },
}));
const mockApi = apiClient as jest.Mocked<typeof apiClient>;

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.toggleFavorite.mockResolvedValue({ data: { favorited: true } } as never);
  mockApi.toggleWatchLater.mockResolvedValue({ data: { inWatchLater: true } } as never);
  mockApi.getUserCollections.mockResolvedValue({
    data: { userCollections: [{ id: 'c1', name: 'Watch tonight' }] },
  } as never);
  mockApi.addUserCollectionItem.mockResolvedValue({ data: {} } as never);
});

describe('CardQuickActions', () => {
  it('favourites the item it was given', async () => {
    const user = userEvent.setup();
    render(<CardQuickActions collectionId="col-1" />);

    await user.click(screen.getByRole('button', { name: /add to favorites/i }));

    expect(mockApi.toggleFavorite).toHaveBeenCalledWith({ collectionId: 'col-1', mediaId: undefined });
    // The button reflects the answer, not the click.
    expect(await screen.findByRole('button', { name: /remove from favorites/i })).toBeInTheDocument();
  });

  it('leaves the button alone when the server refuses', async () => {
    const user = userEvent.setup();
    mockApi.toggleFavorite.mockResolvedValue({ error: 'Nope' } as never);
    render(<CardQuickActions mediaId="media-1" />);

    await user.click(screen.getByRole('button', { name: /add to favorites/i }));

    await waitFor(() => expect(mockApi.toggleFavorite).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /add to favorites/i })).toBeInTheDocument();
  });

  it('starts from the state the card was given', () => {
    render(<CardQuickActions collectionId="col-1" initialFavorited initialInWatchLater />);

    expect(screen.getByRole('button', { name: /remove from favorites/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove from watch later/i })).toBeInTheDocument();
  });

  it('adds to watch later', async () => {
    const user = userEvent.setup();
    render(<CardQuickActions mediaId="media-1" />);

    await user.click(screen.getByRole('button', { name: /add to watch later/i }));

    expect(mockApi.toggleWatchLater).toHaveBeenCalledWith({ collectionId: undefined, mediaId: 'media-1' });
    expect(await screen.findByRole('button', { name: /remove from watch later/i })).toBeInTheDocument();
  });

  it('does not fetch the collections list until the add menu is opened', async () => {
    const user = userEvent.setup();
    render(<CardQuickActions collectionId="col-1" />);

    expect(mockApi.getUserCollections).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /add to collection/i }));

    await waitFor(() => expect(mockApi.getUserCollections).toHaveBeenCalled());
  });

  it('adds to the most recent collection in one click', async () => {
    const user = userEvent.setup();
    render(<CardQuickActions collectionId="col-1" />);

    await user.click(screen.getByRole('button', { name: /add to collection/i }));
    await user.click(await screen.findByText('Watch tonight'));

    expect(mockApi.addUserCollectionItem).toHaveBeenCalledWith('c1', {
      collectionId: 'col-1',
      mediaId: undefined,
    });
  });

  it('offers the full chooser as well', async () => {
    const user = userEvent.setup();
    const onAddToCollection = jest.fn();
    render(<CardQuickActions collectionId="col-1" onAddToCollection={onAddToCollection} />);

    await user.click(screen.getByRole('button', { name: /add to collection/i }));
    await user.click(await screen.findByText(/choose/i));

    expect(onAddToCollection).toHaveBeenCalled();
  });

  it('does not let a click through to the card behind it', async () => {
    const user = userEvent.setup();
    const onCardClick = jest.fn();
    render(
      <div onClick={onCardClick}>
        <CardQuickActions collectionId="col-1" />
      </div>
    );

    await user.click(screen.getByRole('button', { name: /add to favorites/i }));

    await waitFor(() => expect(mockApi.toggleFavorite).toHaveBeenCalled());
    expect(onCardClick).not.toHaveBeenCalled();
  });
});
