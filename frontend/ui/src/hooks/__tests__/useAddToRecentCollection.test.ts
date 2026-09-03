import { act, renderHook, waitFor } from '@testing-library/react';
import { useAddToRecentCollection } from '../useAddToRecentCollection';
import { apiClient } from '../../api/client';

jest.mock('../../api/client', () => ({
  apiClient: {
    getUserCollections: jest.fn(),
    addUserCollectionItem: jest.fn(),
  },
}));
const mockApi = apiClient as jest.Mocked<typeof apiClient>;

const collection = (id: string, name: string) => ({
  id,
  name,
  userId: 'u',
  isPublic: false,
  createdAt: '',
  updatedAt: '',
});

describe('useAddToRecentCollection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getUserCollections.mockResolvedValue({
      data: { userCollections: [collection('c1', 'Watch tonight'), collection('c2', 'Older')] },
    } as never);
    mockApi.addUserCollectionItem.mockResolvedValue({ data: {} } as never);
  });

  it('asks for nothing until the menu opens', () => {
    renderHook(() => useAddToRecentCollection({ collectionId: 'col-1' }, false));

    expect(mockApi.getUserCollections).not.toHaveBeenCalled();
  });

  it('takes the first collection the API returns as the most recent', async () => {
    const { result } = renderHook(() => useAddToRecentCollection({ collectionId: 'col-1' }, true));

    await waitFor(() => expect(result.current.recentCollection?.name).toBe('Watch tonight'));
  });

  it('has no recent collection when the user has none', async () => {
    mockApi.getUserCollections.mockResolvedValue({ data: { userCollections: [] } } as never);
    const { result } = renderHook(() => useAddToRecentCollection({ collectionId: 'col-1' }, true));

    await waitFor(() => expect(mockApi.getUserCollections).toHaveBeenCalled());
    expect(result.current.recentCollection).toBeNull();
  });

  it('adds the target to that collection', async () => {
    const { result } = renderHook(() => useAddToRecentCollection({ mediaId: 'media-9' }, true));
    await waitFor(() => expect(result.current.recentCollection).not.toBeNull());

    let added: boolean | undefined;
    await act(async () => {
      added = await result.current.addToRecent();
    });

    expect(added).toBe(true);
    expect(mockApi.addUserCollectionItem).toHaveBeenCalledWith('c1', {
      collectionId: undefined,
      mediaId: 'media-9',
    });
  });

  it('does nothing before the collection is known', async () => {
    mockApi.getUserCollections.mockResolvedValue({ data: { userCollections: [] } } as never);
    const { result } = renderHook(() => useAddToRecentCollection({ mediaId: 'media-9' }, true));

    let added: boolean | undefined;
    await act(async () => {
      added = await result.current.addToRecent();
    });

    expect(added).toBe(false);
    expect(mockApi.addUserCollectionItem).not.toHaveBeenCalled();
  });

  it('reports a failed add rather than throwing', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockApi.addUserCollectionItem.mockRejectedValue(new Error('offline'));
      const { result } = renderHook(() => useAddToRecentCollection({ collectionId: 'col-1' }, true));
      await waitFor(() => expect(result.current.recentCollection).not.toBeNull());

      let added: boolean | undefined;
      await act(async () => {
        added = await result.current.addToRecent();
      });

      expect(added).toBe(false);
      expect(result.current.isAdding).toBe(false);
    } finally {
      error.mockRestore();
    }
  });
});
