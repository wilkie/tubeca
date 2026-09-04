import {
  useInfiniteQuery,
  useQuery,
  type QueryKey,
  type UseInfiniteQueryOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';

/** The shape every `apiClient` method resolves to. */
export interface ApiResult<T> {
  data?: T;
  error?: string;
}

/** Errors carrying the server's message, so pages can render `error.message`. */
export class ApiError extends Error {}

/**
 * Run an `apiClient` call as a query.
 *
 * The client reports failures as `{ error }` rather than by throwing, which is
 * convenient at a call site but leaves every page to keep its own loading and
 * error state. Turning the failure into a thrown `ApiError` hands both to the
 * query cache, so a page reads them instead of maintaining them, and repeated
 * calls for the same key are shared rather than duplicated.
 */
export function useApiQuery<T>(
  queryKey: QueryKey,
  call: () => Promise<ApiResult<T>>,
  options?: Omit<UseQueryOptions<T, Error, T, QueryKey>, 'queryKey' | 'queryFn'>
) {
  const query = useQuery<T, Error, T, QueryKey>({
    queryKey,
    queryFn: async () => {
      const result = await call();
      if (result.error) throw new ApiError(result.error);
      if (result.data === undefined) throw new ApiError('No data returned');
      return result.data;
    },
    ...options,
  });

  return {
    ...query,
    /** The server's message, or null. Pages render this directly. */
    errorMessage: query.error ? query.error.message : null,
  };
}

/**
 * The same adapter for a paginated call.
 *
 * Pages live in the cache, so returning to a list that was scrolled ten pages
 * deep re-renders all ten without asking the server again, and "load more" is
 * `fetchNextPage` rather than page state kept by the component.
 */
export function useApiInfiniteQuery<T extends { page: number; hasMore: boolean }>(
  queryKey: QueryKey,
  call: (page: number) => Promise<ApiResult<T>>,
  options?: Omit<
    UseInfiniteQueryOptions<T, Error, { pages: T[]; pageParams: number[] }, QueryKey, number>,
    'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam'
  >
) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const result = await call(pageParam);
      if (result.error) throw new ApiError(result.error);
      if (result.data === undefined) throw new ApiError('No data returned');
      return result.data;
    },
    initialPageParam: 1,
    getNextPageParam: (last: T) => (last.hasMore ? last.page + 1 : undefined),
    ...options,
  });

  return {
    ...query,
    pages: query.data?.pages ?? [],
    errorMessage: query.error ? query.error.message : null,
  };
}

/** Query keys, in one place so a mutation can invalidate what it changed. */
export const queryKeys = {
  libraries: ['libraries'] as const,
  library: (id: string) => ['library', id] as const,
  libraryCollections: (id: string, filters: unknown) => ['library', id, 'collections', filters] as const,
  libraryKeywords: (id: string) => ['library', id, 'keywords'] as const,
  collection: (id: string) => ['collection', id] as const,
  media: (id: string) => ['media', id] as const,
  person: (id: string) => ['person', id] as const,
  favorites: ['favorites'] as const,
  watchLater: ['watch-later'] as const,
  userCollections: ['user-collections'] as const,
  userCollection: (id: string) => ['user-collection', id] as const,
  publicCollections: ['public-collections'] as const,
  playbackQueue: ['playback-queue'] as const,
  continueWatching: ['continue-watching'] as const,
  users: ['users'] as const,
  groups: ['groups'] as const,
  settings: ['settings'] as const,
  transcodingSettings: ['settings', 'transcoding'] as const,
  scanStatus: (libraryId: string) => ['library', libraryId, 'scan-status'] as const,
};
