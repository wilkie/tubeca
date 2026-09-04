import { useCallback, useEffect, useState } from 'react';
import type { Keyword } from '../api/client';
import type { SortDirection } from '../components/SortControls';
import type { ViewMode } from '../components/ViewModeMenu';

export type SortField = 'name' | 'dateAdded' | 'releaseDate' | 'rating' | 'runtime';

export interface LibraryViewPreferences {
  viewMode: ViewMode;
  sortField: SortField;
  sortDirection: SortDirection;
  /** Content ratings the viewer has switched off. */
  excludedRatings: string[];
  /** Keywords the viewer is filtering to, by id and name. */
  selectedKeywords: Keyword[];
}

const STORAGE_PREFIX = 'tubeca_library_view';
const DEFAULTS: LibraryViewPreferences = {
  viewMode: 'poster',
  sortField: 'name',
  sortDirection: 'asc',
  excludedRatings: [],
  selectedKeywords: [],
};

const VIEW_MODES: ViewMode[] = ['poster', 'list'];
const SORT_FIELDS: SortField[] = ['name', 'dateAdded', 'releaseDate', 'rating', 'runtime'];
const SORT_DIRECTIONS: SortDirection[] = ['asc', 'desc'];

function storageKey(libraryId: string): string {
  return `${STORAGE_PREFIX}_${libraryId}`;
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/** Keywords are stored whole so the chips can be drawn before the list loads. */
const keywordList = (value: unknown): Keyword[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is Keyword =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as Keyword).id === 'string' &&
          typeof (entry as Keyword).name === 'string'
      )
    : [];

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
      excludedRatings: stringList(stored.excludedRatings),
      selectedKeywords: keywordList(stored.selectedKeywords),
    };
  } catch {
    // Private mode, cleared storage, or something else wrote the key.
    return DEFAULTS;
  }
}

/**
 * Remember how a viewer likes to look at one library.
 *
 * Posters or a list, which sort, and which filters are a per-library habit: a
 * film library reads well as posters by release date, a show library as a list
 * by name, and a household that hides 18-rated films wants them hidden every
 * time rather than once. They are stored per library id so switching between
 * them does not carry one library's choice into another, and they are only a
 * display preference, so losing them costs nothing.
 *
 * A stored keyword that has since been deleted still filters, and will simply
 * match nothing until it is cleared; the chip stays on screen, so it is
 * visible rather than mysterious.
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
    setExcludedRatings: useCallback(
      (excludedRatings: string[]) => update({ excludedRatings }),
      [update]
    ),
    setSelectedKeywords: useCallback(
      (selectedKeywords: Keyword[]) => update({ selectedKeywords }),
      [update]
    ),
  };
}
