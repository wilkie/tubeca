import { useState, useEffect, useCallback } from 'react';

interface UseQuickSearchOptions {
  /** Whether the hook is active (default: true) */
  enabled?: boolean;
}

interface UseQuickSearchResult {
  /** The current search query */
  query: string;
  /** Clear the search query */
  clear: () => void;
  /** Whether there's an active search */
  isActive: boolean;
}

/**
 * Hook that captures keyboard input for quick filtering.
 * Typing alphanumeric characters builds a search query.
 * Backspace removes characters, Escape clears the query.
 */
export function useQuickSearch(options: UseQuickSearchOptions = {}): UseQuickSearchResult {
  const { enabled = true } = options;
  const [query, setQuery] = useState('');

  const clear = useCallback(() => {
    setQuery('');
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is typing in an input, textarea, or contenteditable
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.closest('[role="dialog"]') ||
        target.closest('[role="menu"]')
      ) {
        return;
      }

      // Ignore if modifier keys are pressed (except shift for uppercase)
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      // Escape clears the search
      if (event.key === 'Escape') {
        setQuery('');
        return;
      }

      // Backspace removes last character
      if (event.key === 'Backspace') {
        setQuery((prev) => prev.slice(0, -1));
        event.preventDefault();
        return;
      }

      // Add printable characters (letters, numbers, spaces)
      if (event.key.length === 1 && /[\w\s]/.test(event.key)) {
        setQuery((prev) => prev + event.key);
        event.preventDefault();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);

  return {
    query,
    clear,
    isActive: query.length > 0,
  };
}
