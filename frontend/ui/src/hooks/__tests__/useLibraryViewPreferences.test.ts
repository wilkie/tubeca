import { act, renderHook } from '@testing-library/react';
import { readLibraryViewPreferences, useLibraryViewPreferences } from '../useLibraryViewPreferences';

describe('readLibraryViewPreferences', () => {
  beforeEach(() => window.localStorage.clear());

  it('falls back to posters sorted by name', () => {
    expect(readLibraryViewPreferences('lib-1')).toEqual({
      viewMode: 'poster',
      sortField: 'name',
      sortDirection: 'asc',
      excludedRatings: [],
      selectedKeywords: [],
    });
  });

  it('ignores a stored value that is not one of ours', () => {
    window.localStorage.setItem(
      'tubeca_library_view_lib-1',
      JSON.stringify({ viewMode: 'carousel', sortField: 'colour', sortDirection: 'sideways' })
    );

    expect(readLibraryViewPreferences('lib-1')).toEqual({
      viewMode: 'poster',
      sortField: 'name',
      sortDirection: 'asc',
      excludedRatings: [],
      selectedKeywords: [],
    });
  });

  it('ignores unparseable storage', () => {
    window.localStorage.setItem('tubeca_library_view_lib-1', 'not json');

    expect(readLibraryViewPreferences('lib-1').viewMode).toBe('poster');
  });

  it('has no preferences without a library', () => {
    expect(readLibraryViewPreferences(undefined).sortField).toBe('name');
  });
});

describe('useLibraryViewPreferences', () => {
  beforeEach(() => window.localStorage.clear());

  it('remembers a choice for next time', () => {
    const first = renderHook(() => useLibraryViewPreferences('lib-1'));
    act(() => first.result.current.setViewMode('list'));
    act(() => first.result.current.setSortField('releaseDate'));
    act(() => first.result.current.setSortDirection('desc'));

    const second = renderHook(() => useLibraryViewPreferences('lib-1'));
    expect(second.result.current.viewMode).toBe('list');
    expect(second.result.current.sortField).toBe('releaseDate');
    expect(second.result.current.sortDirection).toBe('desc');
  });

  it('keeps each library on its own choice', () => {
    const films = renderHook(() => useLibraryViewPreferences('films'));
    act(() => films.result.current.setViewMode('list'));

    const shows = renderHook(() => useLibraryViewPreferences('shows'));
    expect(shows.result.current.viewMode).toBe('poster');
  });

  it('loads the new library choice when the id changes', () => {
    window.localStorage.setItem('tubeca_library_view_shows', JSON.stringify({ viewMode: 'list' }));

    const { result, rerender } = renderHook(({ id }) => useLibraryViewPreferences(id), {
      initialProps: { id: 'films' },
    });
    expect(result.current.viewMode).toBe('poster');

    rerender({ id: 'shows' });
    expect(result.current.viewMode).toBe('list');
  });

  it('still works when storage refuses to save', () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    try {
      const { result } = renderHook(() => useLibraryViewPreferences('lib-1'));
      act(() => result.current.setViewMode('list'));
      expect(result.current.viewMode).toBe('list');
    } finally {
      setItem.mockRestore();
    }
  });

  it('does not write anything without a library id', () => {
    const { result } = renderHook(() => useLibraryViewPreferences(undefined));
    act(() => result.current.setViewMode('list'));

    expect(result.current.viewMode).toBe('list');
    expect(window.localStorage.length).toBe(0);
  });
});

describe('the stored filters', () => {
  it('remembers excluded ratings and selected keywords', () => {
    const { result } = renderHook(() => useLibraryViewPreferences('lib-1'));

    act(() => result.current.setExcludedRatings(['R', 'NC-17']));
    act(() => result.current.setSelectedKeywords([{ id: 'k1', name: 'heist' }]));

    expect(readLibraryViewPreferences('lib-1')).toMatchObject({
      excludedRatings: ['R', 'NC-17'],
      selectedKeywords: [{ id: 'k1', name: 'heist' }],
    });
  });

  it('keeps each library\'s filters to itself', () => {
    const { result } = renderHook(() => useLibraryViewPreferences('lib-1'));
    act(() => result.current.setExcludedRatings(['R']));

    expect(readLibraryViewPreferences('lib-2').excludedRatings).toEqual([]);
  });

  it('drops entries that are not the shape we wrote', () => {
    window.localStorage.setItem(
      'tubeca_library_view_lib-1',
      JSON.stringify({
        excludedRatings: ['R', 7, null],
        selectedKeywords: [{ id: 'k1', name: 'heist' }, 'heist', { id: 5 }],
      })
    );

    expect(readLibraryViewPreferences('lib-1')).toMatchObject({
      excludedRatings: ['R'],
      selectedKeywords: [{ id: 'k1', name: 'heist' }],
    });
  });

  it('survives a stored value that is not an array at all', () => {
    window.localStorage.setItem(
      'tubeca_library_view_lib-1',
      JSON.stringify({ excludedRatings: 'R', selectedKeywords: 42 })
    );

    expect(readLibraryViewPreferences('lib-1')).toMatchObject({
      excludedRatings: [],
      selectedKeywords: [],
    });
  });
});
