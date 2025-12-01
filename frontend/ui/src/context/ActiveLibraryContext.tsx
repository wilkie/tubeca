import { createContext, useContext, useState, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { apiClient } from '../api/client';

interface ActiveLibraryContextValue {
  activeLibraryId: string | null;
  setActiveLibrary: (libraryId: string) => void;
}

const ActiveLibraryContext = createContext<ActiveLibraryContextValue | null>(null);

export function ActiveLibraryProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [fetchedLibraryInfo, setFetchedLibraryInfo] = useState<{ libraryId: string } | null>(null);

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

  // Fetch library ID for collection/media pages (async only)
  useEffect(() => {
    if (!routeInfo || routeInfo.type === 'library') {
      // Skip for library routes - handled synchronously in activeLibraryId
      return;
    }

    if (routeInfo.type === 'collection') {
      apiClient.getCollection(routeInfo.id).then((result) => {
        if (result.data?.collection?.library?.id) {
          setFetchedLibraryInfo({ libraryId: result.data.collection.library.id });
        }
      });
      return;
    }

    if (routeInfo.type === 'media') {
      apiClient.getMedia(routeInfo.id).then((result) => {
        const media = result.data?.media as { collection?: { library?: { id: string } } };
        if (media?.collection?.library?.id) {
          setFetchedLibraryInfo({ libraryId: media.collection.library.id });
        }
      });
    }
  }, [routeInfo]);

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
    // For collection/media, use the last fetched library ID
    return fetchedLibraryInfo?.libraryId ?? null;
  }, [routeInfo, fetchedLibraryInfo]);

  // Allow components to set the active library (e.g., when clicking a library tab)
  const setActiveLibrary = useCallback((libraryId: string) => {
    setFetchedLibraryInfo({ libraryId });
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
