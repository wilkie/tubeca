import { QueryClient } from '@tanstack/react-query';

/**
 * Shared query cache for the app.
 *
 * The library is a personal media server: the same libraries, collections and
 * favourites are read by several pages at once (the header, the sidebar and
 * the page itself all want the library list), and the data changes only when
 * this user or a scan changes it. So requests are shared and answers are held
 * briefly rather than re-fetched on every mount, and nothing refetches merely
 * because a window regained focus.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Long enough that navigating away and back is instant, short enough
        // that a scrape or a scan shows up without a reload.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

export const queryClient = createQueryClient();
