import { apiClient, type Library } from '../api/client';
import { queryKeys, useApiQuery } from './useApiQuery';

/**
 * The libraries this user can see.
 *
 * The header, the sidebar and the home page all want this list, and before the
 * query cache each fetched it separately on every mount. One key means one
 * request.
 */
export function useLibraries(enabled = true) {
  const query = useApiQuery(queryKeys.libraries, () => apiClient.getLibraries(), { enabled });
  const libraries: Library[] = query.data?.libraries ?? [];
  return { ...query, libraries };
}
