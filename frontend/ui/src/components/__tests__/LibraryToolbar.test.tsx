import { render, screen } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { LibraryToolbar, type LibraryToolbarProps } from '../LibraryToolbar';

const handlers = {
  onToggleFilters: jest.fn(),
  onClearFilters: jest.fn(),
  onToggleSelectionMode: jest.fn(),
  onViewModeChange: jest.fn(),
  onSortFieldChange: jest.fn(),
  onSortDirectionChange: jest.fn(),
};

beforeEach(() => jest.clearAllMocks());

function renderToolbar(props: Partial<LibraryToolbarProps> = {}) {
  return render(
    <LibraryToolbar
      libraryName="Films"
      total={42}
      showFilterButton
      activeFilterCount={0}
      filtersOpen={false}
      isSelectionMode={false}
      viewMode="poster"
      sortOptions={[
        { value: 'name', label: 'Name' },
        { value: 'releaseDate', label: 'Release date' },
      ]}
      sortField="name"
      sortDirection="asc"
      {...handlers}
      {...props}
    />
  );
}

describe('LibraryToolbar', () => {
  it('heads the library with its name and count', () => {
    renderToolbar();

    expect(screen.getByRole('heading', { name: /films/i })).toBeInTheDocument();
    expect(screen.getByText('(42)')).toBeInTheDocument();
  });

  it('leaves the count off an empty library', () => {
    renderToolbar({ total: 0 });

    expect(screen.queryByText('(0)')).not.toBeInTheDocument();
  });

  it('hides the filter button when there is nothing to filter on', () => {
    renderToolbar({ showFilterButton: false });

    expect(screen.queryByRole('button', { name: /toggle filters/i })).not.toBeInTheDocument();
  });

  it('opens the filters', async () => {
    const user = userEvent.setup();
    renderToolbar();

    await user.click(screen.getByRole('button', { name: /toggle filters/i }));

    expect(handlers.onToggleFilters).toHaveBeenCalled();
  });

  it('counts the active filters on the badge', () => {
    renderToolbar({ activeFilterCount: 3 });

    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('clears the filters from the badge', async () => {
    const user = userEvent.setup();
    const { container } = renderToolbar({ activeFilterCount: 3 });
    const badge = container.querySelector('.MuiBadge-badge')!;

    await user.hover(badge);
    await user.click(badge);

    expect(handlers.onClearFilters).toHaveBeenCalled();
    expect(handlers.onToggleFilters).not.toHaveBeenCalled();
  });

  it('does not offer to clear when no filter is active', async () => {
    const user = userEvent.setup();
    const { container } = renderToolbar({ activeFilterCount: 0 });
    const badge = container.querySelector('.MuiBadge-badge')!;

    await user.hover(badge);
    await user.click(badge);

    expect(handlers.onClearFilters).not.toHaveBeenCalled();
  });

  it('turns selection mode on and off', async () => {
    const user = userEvent.setup();
    const { rerender } = renderToolbar();

    await user.click(screen.getByRole('button', { name: /select/i }));
    expect(handlers.onToggleSelectionMode).toHaveBeenCalled();

    rerender(
      <LibraryToolbar
        libraryName="Films"
        total={42}
        showFilterButton
        activeFilterCount={0}
        filtersOpen={false}
        isSelectionMode
        viewMode="poster"
        sortOptions={[{ value: 'name', label: 'Name' }]}
        sortField="name"
        sortDirection="asc"
        {...handlers}
      />
    );
    expect(screen.getByRole('button', { name: /exit/i })).toBeInTheDocument();
  });

  it('passes the sort options through', async () => {
    const user = userEvent.setup();
    renderToolbar();

    await user.click(screen.getByRole('combobox'));

    await user.click(await screen.findByRole('option', { name: /release date/i }));
    expect(handlers.onSortFieldChange).toHaveBeenCalledWith('releaseDate');
  });

  it('flips the sort direction', async () => {
    const user = userEvent.setup();
    renderToolbar();

    await user.click(screen.getByRole('button', { name: /ascending/i }));

    expect(handlers.onSortDirectionChange).toHaveBeenCalledWith('desc');
  });
});
