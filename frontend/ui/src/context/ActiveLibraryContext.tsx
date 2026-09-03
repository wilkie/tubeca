import { createContext, useContext, useState, useMemo, useCallback, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { apiClient } from '../api/client';
import { queryKeys, useApiQuery } from '../hooks/useApiQuery';

interface ActiveLibraryContextValue {
  activeLibraryId: string | null;
  setActiveLibrary: (libraryId: string) => void;
}

const ActiveLibraryContext = createContext<ActiveLibraryContextValue | null>(null);

export function ActiveLibraryProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  // The library a collection or media route belongs to, applied once per
  // route, plus a manual choice that wins until the next route resolves.
  const [resolved, setResolved] = useState<{ routeId: string; libraryId: string } | null>(null);
  const [manualLibraryId, setManualLibraryId] = useState<string | null>(null);

  // Parse route info from pathname
  const routeInfo = useMemo(() => {
    const path = location.pathname;

    const libraryMatch = path.match(/^\/library\/([^/]+)/);
    if (libraryMatch) {
      return { type: 'library' as const, id: libraryMatch[1] };
    }

    const collectionMatch = path.match(/^\/collection\/([^/]+)/);
    if (collectionMatch) {
      return { type: 'collection' as const, id: collectionMatch[1] };
    }

    const mediaMatch = path.match(/^\/media\/([^/]+)/);
    if (mediaMatch) {
      return { type: 'media' as const, id: mediaMatch[1] };
    }

    return null;
  }, [location.pathname]);

  // Which library a collection or media route belongs to is only known from
  // the record itself. These are the same queries CollectionPage and MediaPage
  // run, so the cache answers them without a second request.
  const collectionQuery = useApiQuery(
    queryKeys.collection(routeInfo?.type === 'collection' ? routeInfo.id : ''),
    () => apiClient.getCollection(routeInfo!.id),
    { enabled: routeInfo?.type === 'collection' }
  );
  const mediaQuery = useApiQuery(
    queryKeys.media(routeInfo?.type === 'media' ? routeInfo.id : ''),
    () => apiClient.getMedia(routeInfo!.id),
    { enabled: routeInfo?.type === 'media' }
  );

  const routeLibraryId =
    collectionQuery.data?.collection?.library?.id ??
    (mediaQuery.data?.media as { collection?: { library?: { id: string } } } | undefined)?.collection?.library
      ?.id ??
    null;

  // Adjusted during render rather than in an effect, so the previous library
  // stays highlighted while the next route's record is still loading.
  if (routeLibraryId && routeInfo && resolved?.routeId !== routeInfo.id) {
    setResolved({ routeId: routeInfo.id, libraryId: routeLibraryId });
    setManualLibraryId(null);
  }

  // Active library ID:
  // - For library routes: use directly from URL
  // - For collection/media routes: use fetched info (persists during navigation)
  // - For other routes: null
  const activeLibraryId = useMemo(() => {
    if (!routeInfo) {
      return null;
    }
    if (routeInfo.type === 'library') {
      return routeInfo.id;
    }
    // For collection/media, the manual choice or the resolved library.
    return manualLibraryId ?? resolved?.libraryId ?? null;
  }, [routeInfo, manualLibraryId, resolved]);

  // Allow components to set the active library (e.g., when clicking a library tab)
  const setActiveLibrary = useCallback((libraryId: string) => {
    setManualLibraryId(libraryId);
  }, []);

  const value = useMemo(() => ({
    activeLibraryId,
    setActiveLibrary,
  }), [activeLibraryId, setActiveLibrary]);

  return (
    <ActiveLibraryContext.Provider value={value}>
      {children}
    </ActiveLibraryContext.Provider>
  );
}

export function useActiveLibrary() {
  const context = useContext(ActiveLibraryContext);
  if (!context) {
    throw new Error('useActiveLibrary must be used within an ActiveLibraryProvider');
  }
  return context;
}
