import { useCallback, useEffect, useState } from 'react';
import type { SortDirection } from '../components/SortControls';
import type { ViewMode } from '../components/ViewModeMenu';

export type SortField = 'name' | 'dateAdded' | 'releaseDate' | 'rating' | 'runtime';

export interface LibraryViewPreferences {
  viewMode: ViewMode;
  sortField: SortField;
  sortDirection: SortDirection;
}

const STORAGE_PREFIX = 'tubeca_library_view';
const DEFAULTS: LibraryViewPreferences = { viewMode: 'poster', sortField: 'name', sortDirection: 'asc' };

const VIEW_MODES: ViewMode[] = ['poster', 'list'];
const SORT_FIELDS: SortField[] = ['name', 'dateAdded', 'releaseDate', 'rating', 'runtime'];
const SORT_DIRECTIONS: SortDirection[] = ['asc', 'desc'];

function storageKey(libraryId: string): string {
  return `${STORAGE_PREFIX}_${libraryId}`;
}

/** Read a stored preference, ignoring anything that is not a value we wrote. */
export function readLibraryViewPreferences(libraryId: string | undefined): LibraryViewPreferences {
  if (!libraryId) return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(storageKey(libraryId));
    if (!raw) return DEFAULTS;
    const stored = JSON.parse(raw) as Partial<LibraryViewPreferences>;
    return {
      viewMode: VIEW_MODES.includes(stored.viewMode as ViewMode) ? (stored.viewMode as ViewMode) : DEFAULTS.viewMode,
      sortField: SORT_FIELDS.includes(stored.sortField as SortField)
        ? (stored.sortField as SortField)
        : DEFAULTS.sortField,
      sortDirection: SORT_DIRECTIONS.includes(stored.sortDirection as SortDirection)
        ? (stored.sortDirection as SortDirection)
        : DEFAULTS.sortDirection,
    };
  } catch {
    // Private mode, cleared storage, or something else wrote the key.
    return DEFAULTS;
  }
}

/**
 * Remember how a viewer likes to look at one library.
 *
 * Posters or a list, and which sort, are a per-library habit: a film library
 * reads well as posters by release date, a show library as a list by name.
 * They are stored per library id so switching between them does not carry one
 * library's choice into another, and they are only a display preference, so
 * losing them costs nothing.
 */
export function useLibraryViewPreferences(libraryId: string | undefined) {
  const [preferences, setPreferences] = useState<LibraryViewPreferences>(() =>
    readLibraryViewPreferences(libraryId)
  );

  // Switching libraries loads that library's own choice.
  useEffect(() => {
    setPreferences(readLibraryViewPreferences(libraryId));
  }, [libraryId]);

  const update = useCallback(
    (changes: Partial<LibraryViewPreferences>) => {
      setPreferences((prev) => {
        const next = { ...prev, ...changes };
        if (libraryId) {
          try {
            window.localStorage.setItem(storageKey(libraryId), JSON.stringify(next));
          } catch {
            // Storage is unavailable; the choice just will not outlive the page.
          }
        }
        return next;
      });
    },
    [libraryId]
  );

  return {
    ...preferences,
    setViewMode: useCallback((viewMode: ViewMode) => update({ viewMode }), [update]),
    setSortField: useCallback((sortField: SortField) => update({ sortField }), [update]),
    setSortDirection: useCallback((sortDirection: SortDirection) => update({ sortDirection }), [update]),
  };
}
