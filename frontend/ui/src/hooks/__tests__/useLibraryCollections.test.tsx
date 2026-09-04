import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLibraryCollections } from '../useLibraryCollections';
import { apiClient } from '../../api/client';

jest.mock('../../api/client', () => ({
  apiClient: {
    getLibrary: jest.fn(),
    getCollectionsByLibrary: jest.fn(),
    checkFavorites: jest.fn(),
    checkWatchLater: jest.fn(),
    getKeywordsByLibrary: jest.fn(),
  },
}));
const mockApi = apiClient as jest.Mocked<typeof apiClient>;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const film = (id: string, contentRating?: string) => ({
  id,
  name: id,
  collectionType: 'Film',
  filmDetails: contentRating ? { contentRating } : undefined,
});

const noFilters = {
  sortField: 'name' as const,
  sortDirection: 'asc' as const,
  excludedRatings: new Set<string>(),
  selectedKeywords: [],
  nameFilter: '',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getLibrary.mockResolvedValue({ data: { library: { id: 'lib-1', name: 'Films' } } } as never);
  mockApi.checkFavorites.mockResolvedValue({ data: { collectionIds: [], mediaIds: [] } } as never);
  mockApi.checkWatchLater.mockResolvedValue({ data: { collectionIds: [], mediaIds: [] } } as never);
  mockApi.getKeywordsByLibrary.mockResolvedValue({ data: { keywords: [{ id: 'k1', name: 'heist' }] } } as never);
  mockApi.getCollectionsByLibrary.mockResolvedValue({
    data: { collections: [film('A', 'PG'), film('B', 'R')], total: 3, page: 1, hasMore: true },
  } as never);
});

describe('useLibraryCollections', () => {
  it('loads the library and its first page', async () => {
    const { result } = renderHook(() => useLibraryCollections('lib-1', noFilters), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.library?.name).toBe('Films');
    expect(result.current.collections.map((c) => c.id)).toEqual(['A', 'B']);
    expect(result.current.total).toBe(3);
    expect(result.current.hasMore).toBe(true);
  });

  it('appends the next page rather than replacing it', async () => {
    const { result } = renderHook(() => useLibraryCollections('lib-1', noFilters), { wrapper });
    await waitFor(() => expect(result.current.collections).toHaveLength(2));

    mockApi.getCollectionsByLibrary.mockResolvedValueOnce({
      data: { collections: [film('C')], total: 3, page: 2, hasMore: false },
    } as never);
    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.collections.map((c) => c.id)).toEqual(['A', 'B', 'C']));
    expect(result.current.hasMore).toBe(false);
  });

  it('collects content ratings from every page loaded, in viewing order', async () => {
    const { result } = renderHook(() => useLibraryCollections('lib-1', noFilters), { wrapper });
    await waitFor(() => expect(result.current.collections).toHaveLength(2));
    expect(result.current.availableContentRatings).toEqual(['PG', 'R']);

    mockApi.getCollectionsByLibrary.mockResolvedValueOnce({
      data: { collections: [film('C', 'G')], total: 3, page: 2, hasMore: false },
    } as never);
    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.availableContentRatings).toEqual(['G', 'PG', 'R']));
  });

  it('does not ask for keywords until the filter panel wants them', async () => {
    const { result } = renderHook(() => useLibraryCollections('lib-1', noFilters), { wrapper });
    await waitFor(() => expect(result.current.collections).toHaveLength(2));

    expect(mockApi.getKeywordsByLibrary).not.toHaveBeenCalled();

    act(() => result.current.loadKeywords());
    await waitFor(() => expect(result.current.availableKeywords).toHaveLength(1));
  });

  it('starts again from page one when a filter changes', async () => {
    const { result, rerender } = renderHook((filters) => useLibraryCollections('lib-1', filters), {
      wrapper,
      initialProps: noFilters,
    });
    await waitFor(() => expect(result.current.collections).toHaveLength(2));

    mockApi.getCollectionsByLibrary.mockResolvedValue({
      data: { collections: [film('Only')], total: 1, page: 1, hasMore: false },
    } as never);
    rerender({ ...noFilters, nameFilter: 'only' });

    await waitFor(() => expect(result.current.collections.map((c) => c.id)).toEqual(['Only']));
    expect(mockApi.getCollectionsByLibrary).toHaveBeenLastCalledWith(
      'lib-1',
      expect.objectContaining({ page: 1, nameFilter: 'only' })
    );
  });

  it('asks for nothing without a library', () => {
    renderHook(() => useLibraryCollections(undefined, noFilters), { wrapper });

    expect(mockApi.getLibrary).not.toHaveBeenCalled();
    expect(mockApi.getCollectionsByLibrary).not.toHaveBeenCalled();
  });

  it('reports the error message when a page fails', async () => {
    mockApi.getCollectionsByLibrary.mockResolvedValue({ error: 'Library is offline' } as never);

    const { result } = renderHook(() => useLibraryCollections('lib-1', noFilters), { wrapper });

    await waitFor(() => expect(result.current.error).toBe('Library is offline'));
  });
});
