import { createContext, useContext, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { useNavigationType } from 'react-router-dom';

interface CachedPageState<T = unknown> {
  data: T;
  scrollY: number;
  timestamp: number;
}

// Module-level cache that persists across component re-renders
const pageCache = new Map<string, CachedPageState>();

// Cache expires after 10 minutes
const CACHE_TTL = 10 * 60 * 1000;

interface ScrollRestorationContextType {
  isBackNavigation: boolean;
}

const ScrollRestorationContext = createContext<ScrollRestorationContextType | null>(null);

export function ScrollRestorationProvider({ children }: { children: ReactNode }) {
  const navigationType = useNavigationType();
  const isBackNavigation = navigationType === 'POP';

  // Clean up expired cache entries periodically
  useEffect(() => {
    const cleanup = () => {
      const now = Date.now();
      for (const [key, value] of pageCache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
          pageCache.delete(key);
        }
      }
    };

    const interval = setInterval(cleanup, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <ScrollRestorationContext.Provider value={{ isBackNavigation }}>
      {children}
    </ScrollRestorationContext.Provider>
  );
}

function useScrollRestorationContext() {
  const context = useContext(ScrollRestorationContext);
  if (!context) {
    throw new Error('useScrollRestoration must be used within a ScrollRestorationProvider');
  }
  return context;
}

/**
 * Get cached state for a page. Call this at the top of your component
 * to get initial state if returning via back button.
 */
export function useCachedState<T>(cacheKey: string): {
  cachedState: T | null;
  isBackNavigation: boolean;
} {
  const { isBackNavigation } = useScrollRestorationContext();
  const cached = pageCache.get(cacheKey);

  // Only return cached state on back navigation
  // Note: We skip expiry check during render for purity - expired entries are cleaned up periodically
  if (isBackNavigation && cached) {
    return {
      cachedState: cached.data as T,
      isBackNavigation: true
    };
  }

  return { cachedState: null, isBackNavigation };
}

/**
 * Hook for managing scroll restoration. Returns a saveState function
 * that should be called before navigation.
 */
export function useScrollRestoration<T>(
  cacheKey: string,
  getCurrentState: () => T | null
) {
  const scrollPositionRef = useRef<number | null>(null);
  const hasRestoredRef = useRef(false);
  const { isBackNavigation } = useScrollRestorationContext();

  // Check for cached scroll position on mount
  useEffect(() => {
    if (isBackNavigation && !hasRestoredRef.current) {
      const cached = pageCache.get(cacheKey);
      if (cached) {
        hasRestoredRef.current = true;
        scrollPositionRef.current = cached.scrollY;
      }
    }
  }, [cacheKey, isBackNavigation]);

  // Restore scroll position after content renders
  useEffect(() => {
    if (scrollPositionRef.current === null) return;

    const targetScroll = scrollPositionRef.current;
    let attempts = 0;

    const attemptScroll = () => {
      attempts++;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;

      // Wait until page is tall enough or give up after 50 attempts
      if (maxScroll >= targetScroll * 0.9 || attempts > 50) {
        window.scrollTo(0, Math.min(targetScroll, maxScroll));
        scrollPositionRef.current = null;
      } else {
        requestAnimationFrame(attemptScroll);
      }
    };

    // Start after a brief delay to let React render
    requestAnimationFrame(() => requestAnimationFrame(attemptScroll));
  });

  // Save state function - call this before navigating
  const saveState = useCallback(() => {
    const state = getCurrentState();
    if (state !== null) {
      pageCache.set(cacheKey, {
        data: state,
        scrollY: window.scrollY,
        timestamp: Date.now(),
      });
    }
  }, [cacheKey, getCurrentState]);

  // Listen for clicks on navigation elements
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest('a');
      const cardAction = target.closest('[class*="MuiCardActionArea"]');
      const button = target.closest('button');

      // Save state when clicking navigable elements
      if ((link && link.href && !link.target) || cardAction || button) {
        saveState();
      }
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [saveState]);

  return { saveState };
}

// For backwards compatibility
export function usePageScrollRestoration<T>(
  cacheKey: string,
  currentState: T | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _onRestore: (state: T) => void
) {
  const getCurrentState = useCallback(() => currentState, [currentState]);
  return useScrollRestoration(cacheKey, getCurrentState);
}
