import { createContext, useContext, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { useNavigationType } from 'react-router-dom';

/**
 * Where a page was scrolled to when it was left.
 *
 * This used to hold the page's rows as well, because coming back would
 * otherwise refetch from page one and lose everything below the fold. The
 * query cache holds the rows now, so all that is left is the offset, which
 * nothing else knows.
 */
interface SavedScroll {
  scrollY: number;
  timestamp: number;
}

// Module-level, so it survives the component unmounting on navigation.
const scrollPositions = new Map<string, SavedScroll>();

/** Long enough to cover a look at one title and back, short enough to forget. */
const CACHE_TTL = 10 * 60 * 1000;

interface ScrollRestorationContextType {
  isBackNavigation: boolean;
}

const ScrollRestorationContext = createContext<ScrollRestorationContextType | null>(null);

export function ScrollRestorationProvider({ children }: { children: ReactNode }) {
  const navigationType = useNavigationType();
  const isBackNavigation = navigationType === 'POP';

  useEffect(() => {
    const cleanup = () => {
      const now = Date.now();
      for (const [key, value] of scrollPositions.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
          scrollPositions.delete(key);
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
 * Remember this page's scroll offset, and put it back on a back navigation.
 *
 * Saving happens on any click that might navigate, because there is no event
 * for "about to leave". Restoring waits for the page to grow tall enough to
 * hold the offset, which it does once the cached rows have rendered.
 */
export function useScrollRestoration(cacheKey: string) {
  const scrollPositionRef = useRef<number | null>(null);
  const hasRestoredRef = useRef(false);
  const { isBackNavigation } = useScrollRestorationContext();

  useEffect(() => {
    if (isBackNavigation && !hasRestoredRef.current) {
      const saved = scrollPositions.get(cacheKey);
      if (saved) {
        hasRestoredRef.current = true;
        scrollPositionRef.current = saved.scrollY;
      }
    }
  }, [cacheKey, isBackNavigation]);

  // Restore after content renders.
  useEffect(() => {
    if (scrollPositionRef.current === null) return;

    const targetScroll = scrollPositionRef.current;
    let attempts = 0;

    const attemptScroll = () => {
      attempts++;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;

      // Wait until the page is tall enough, or give up.
      if (maxScroll >= targetScroll * 0.9 || attempts > 50) {
        window.scrollTo(0, Math.min(targetScroll, maxScroll));
        scrollPositionRef.current = null;
      } else {
        requestAnimationFrame(attemptScroll);
      }
    };

    requestAnimationFrame(() => requestAnimationFrame(attemptScroll));
  });

  const saveState = useCallback(() => {
    scrollPositions.set(cacheKey, { scrollY: window.scrollY, timestamp: Date.now() });
  }, [cacheKey]);

  // There is no "about to navigate" event, so save on anything clickable.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest('a');
      const cardAction = target.closest('[class*="MuiCardActionArea"]');
      const button = target.closest('button');

      if ((link && link.href && !link.target) || cardAction || button) {
        saveState();
      }
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [saveState]);

  return { saveState };
}
