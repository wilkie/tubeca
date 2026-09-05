import { renderHook, act, waitFor } from '@testing-library/react';
import { useWatchState } from '../useWatchState';
import { apiClient } from '../../api/client';

jest.mock('../../api/client', () => ({
  apiClient: {
    getWatchProgressBatch: jest.fn(),
    getCollectionWatchSummaries: jest.fn(),
    markWatched: jest.fn(),
    clearWatchProgress: jest.fn(),
    markCollectionWatched: jest.fn(),
    clearCollectionWatchProgress: jest.fn(),
  },
}));
const mockApi = apiClient as jest.Mocked<typeof apiClient>;

const row = (mediaId: string, completed = false) => ({
  id: `p-${mediaId}`, userId: 'u', mediaId, position: 10, duration: 100, completed, createdAt: '', updatedAt: '',
});

describe('useWatchState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getWatchProgressBatch.mockResolvedValue({ data: { progress: { a: row('a') } } });
    mockApi.getCollectionWatchSummaries.mockResolvedValue({ data: { summaries: { c1: { total: 2, watched: 1, inProgress: 0 } } } });
  });

  it('loads progress and summaries for the given ids', async () => {
    const { result } = renderHook(() => useWatchState({ mediaIds: ['a', 'b'], collectionIds: ['c1'] }));
    await waitFor(() => expect(result.current.progress.a).toBeDefined());
    expect(mockApi.getWatchProgressBatch).toHaveBeenCalledWith(['a', 'b']);
    expect(result.current.summaries.c1.total).toBe(2);
  });

  it('skips the network when there is nothing to ask for', () => {
    renderHook(() => useWatchState({}));
    expect(mockApi.getWatchProgressBatch).not.toHaveBeenCalled();
    expect(mockApi.getCollectionWatchSummaries).not.toHaveBeenCalled();
  });

  it('marks watched, updates local progress and re-fetches summaries', async () => {
    mockApi.markWatched.mockResolvedValue({ data: { progress: row('b', true) } });
    const { result } = renderHook(() => useWatchState({ mediaIds: ['a', 'b'], collectionIds: ['c1'] }));
    await waitFor(() => expect(result.current.progress.a).toBeDefined());

    let ok = false;
    await act(async () => {
      ok = await result.current.setWatched('b', true);
    });
    expect(ok).toBe(true);
    expect(result.current.progress.b?.completed).toBe(true);
    await waitFor(() => expect(mockApi.getCollectionWatchSummaries).toHaveBeenCalledTimes(2));
  });

  it('clears progress when unmarking', async () => {
    mockApi.clearWatchProgress.mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useWatchState({ mediaIds: ['a'] }));
    await waitFor(() => expect(result.current.progress.a).toBeDefined());
    await act(async () => {
      await result.current.setWatched('a', false);
    });
    expect(result.current.progress.a).toBeUndefined();
  });

  describe('marking a whole collection', () => {
    it('reports how many items changed and re-reads both halves', async () => {
      mockApi.markCollectionWatched.mockResolvedValue({ data: { count: 12 } });
      const { result } = renderHook(() => useWatchState({ mediaIds: ['a'], collectionIds: ['c1'] }));
      await waitFor(() => expect(result.current.progress.a).toBeDefined());
      mockApi.getWatchProgressBatch.mockClear();
      mockApi.getCollectionWatchSummaries.mockClear();

      let count: number | null = null;
      await act(async () => {
        count = await result.current.setCollectionWatched('show-1', true);
      });

      expect(count).toBe(12);
      expect(mockApi.markCollectionWatched).toHaveBeenCalledWith('show-1');
      await waitFor(() => expect(mockApi.getWatchProgressBatch).toHaveBeenCalled());
      expect(mockApi.getCollectionWatchSummaries).toHaveBeenCalled();
    });

    it('clears a collection when asked to unmark it', async () => {
      mockApi.clearCollectionWatchProgress.mockResolvedValue({ data: { count: 3 } });
      const { result } = renderHook(() => useWatchState({ mediaIds: ['a'] }));
      await waitFor(() => expect(result.current.progress.a).toBeDefined());

      let count: number | null = null;
      await act(async () => {
        count = await result.current.setCollectionWatched('show-1', false);
      });

      expect(count).toBe(3);
      expect(mockApi.clearCollectionWatchProgress).toHaveBeenCalledWith('show-1');
      expect(mockApi.markCollectionWatched).not.toHaveBeenCalled();
    });

    it('says nothing changed when the call fails', async () => {
      mockApi.markCollectionWatched.mockResolvedValue({ error: 'Server is down' });
      const { result } = renderHook(() => useWatchState({ mediaIds: ['a'] }));
      await waitFor(() => expect(result.current.progress.a).toBeDefined());

      let count: number | null = 0;
      await act(async () => {
        count = await result.current.setCollectionWatched('show-1', true);
      });

      expect(count).toBeNull();
    });
  });
});
