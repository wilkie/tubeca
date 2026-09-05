import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { QueuePage } from '../QueuePage';
import { apiClient } from '../../api/client';
import type { UserCollection, UserCollectionItem } from '../../api/client';

jest.mock('../../api/client', () => ({
  apiClient: {
    // Rows carry watched badges.
    getWatchProgressBatch: jest.fn().mockResolvedValue({ data: { progress: {} } }),
    getCollectionWatchSummaries: jest.fn().mockResolvedValue({ data: { summaries: {} } }),
    getPlaybackQueue: jest.fn(),
    setPlaybackQueue: jest.fn(),
    clearPlaybackQueue: jest.fn(),
    getImageUrl: jest.fn((id: string) => `http://localhost/api/images/${id}`),
  },
}));

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const mockPlayMedia = jest.fn();
const mockRefreshQueue = jest.fn();
jest.mock('../../context/PlayerContext', () => ({
  usePlayer: () => ({ playMedia: mockPlayMedia, refreshQueue: mockRefreshQueue }),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;
const mockWatch = apiClient as unknown as {
  getWatchProgressBatch: jest.Mock;
  getCollectionWatchSummaries: jest.Mock;
};

function queueItem(id: string, mediaId: string, name: string): UserCollectionItem {
  return {
    id,
    userCollectionId: 'queue',
    mediaId,
    position: 0,
    media: { id: mediaId, name, type: 'Video', duration: 1200 },
  } as unknown as UserCollectionItem;
}

function queueOf(items: UserCollectionItem[]): UserCollection {
  return { id: 'queue', name: 'PlaybackQueue', isSystem: true, items } as unknown as UserCollection;
}

const twoItems = [queueItem('item-1', 'media-1', 'First'), queueItem('item-2', 'media-2', 'Second')];

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks drops the resolved values set at mock time.
  mockWatch.getWatchProgressBatch.mockResolvedValue({ data: { progress: {} } });
  mockWatch.getCollectionWatchSummaries.mockResolvedValue({ data: { summaries: {} } });
  mockApi.getPlaybackQueue.mockResolvedValue({ data: { userCollection: queueOf(twoItems) } } as never);
  mockApi.setPlaybackQueue.mockResolvedValue({ data: { userCollection: queueOf([twoItems[1]]) } } as never);
  mockApi.clearPlaybackQueue.mockResolvedValue({ data: { userCollection: queueOf([]) } } as never);
});

describe('QueuePage', () => {
  it('lists what is queued, in order', async () => {
    render(<QueuePage />);

    expect(await screen.findByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('says so when the queue is empty, and offers nothing to clear', async () => {
    mockApi.getPlaybackQueue.mockResolvedValue({ data: { userCollection: queueOf([]) } } as never);

    render(<QueuePage />);

    expect(await screen.findByText(/queue is empty/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear queue/i })).not.toBeInTheDocument();
  });

  it('shows the error when the queue cannot be loaded', async () => {
    mockApi.getPlaybackQueue.mockResolvedValue({ error: 'Server is down' } as never);

    render(<QueuePage />);

    expect(await screen.findByText('Server is down')).toBeInTheDocument();
  });

  it('removes an item by sending the queue that should remain', async () => {
    const user = userEvent.setup();
    render(<QueuePage />);
    await screen.findByText('First');

    await user.click(screen.getAllByRole('button', { name: /remove from queue/i })[0]);

    // The queue is replaced wholesale, with media ids only.
    await waitFor(() =>
      expect(mockApi.setPlaybackQueue).toHaveBeenCalledWith([{ mediaId: 'media-2' }])
    );
    expect(mockRefreshQueue).toHaveBeenCalled();
  });

  it('empties the queue', async () => {
    const user = userEvent.setup();
    render(<QueuePage />);
    await screen.findByText('First');

    await user.click(screen.getByRole('button', { name: /clear queue/i }));

    await waitFor(() => expect(mockApi.clearPlaybackQueue).toHaveBeenCalled());
    expect(mockRefreshQueue).toHaveBeenCalled();
    expect(await screen.findByText(/queue is empty/i)).toBeInTheDocument();
  });

  it('plays an item and opens the player', async () => {
    const user = userEvent.setup();
    render(<QueuePage />);
    await screen.findByText('First');

    await user.click(screen.getAllByRole('button', { name: /play/i })[0]);

    await waitFor(() => expect(mockPlayMedia).toHaveBeenCalledWith('media-1'));
    expect(mockNavigate).toHaveBeenCalledWith('/play/media-1');
  });

  it('opens the media page when a row is clicked', async () => {
    const user = userEvent.setup();
    render(<QueuePage />);

    await user.click(await screen.findByText('First'));

    expect(mockNavigate).toHaveBeenCalledWith('/media/media-1');
  });

  it('opens the film rather than the file for a film library item', async () => {
    const filmItem = {
      ...queueItem('item-3', 'media-3', 'A Film'),
      media: {
        id: 'media-3',
        name: 'A Film',
        type: 'Video',
        duration: 5000,
        collection: { id: 'col-9', name: 'A Film', library: { libraryType: 'Film' } },
      },
    } as unknown as UserCollectionItem;
    mockApi.getPlaybackQueue.mockResolvedValue({ data: { userCollection: queueOf([filmItem]) } } as never);
    const user = userEvent.setup();
    render(<QueuePage />);

    // The name shows as both the title and the subtitle for a film.
    await user.click((await screen.findAllByText('A Film'))[0]);

    expect(mockNavigate).toHaveBeenCalledWith('/collection/col-9');
  });

  describe('watch state', () => {
    it('marks a queued episode the viewer has already seen', async () => {
      mockWatch.getWatchProgressBatch.mockResolvedValue({
        data: { progress: { 'media-1': { mediaId: 'media-1', position: 1200, duration: 1200, completed: true } } },
      });

      render(<QueuePage />);
      await screen.findByText('First');

      expect(await screen.findByTestId('watch-badge')).toBeInTheDocument();
    });

    it('asks about exactly what it has queued', async () => {
      render(<QueuePage />);
      await screen.findByText('First');

      await waitFor(() =>
        expect(mockWatch.getWatchProgressBatch).toHaveBeenCalledWith(['media-1', 'media-2'])
      );
    });
  });
});
