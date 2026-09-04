import { render, screen } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { FilterChips } from '../FilterChips';

const onToggle = jest.fn();
const onClear = jest.fn();
const onSelectOnly = jest.fn();

beforeEach(() => jest.clearAllMocks());

function renderChips(props: Partial<Parameters<typeof FilterChips>[0]> = {}) {
  return render(
    <FilterChips
      label="Rating"
      options={['G', 'PG', 'R']}
      excluded={new Set()}
      onToggle={onToggle}
      onClear={onClear}
      {...props}
    />
  );
}

describe('FilterChips', () => {
  it('shows the label and a chip per option', () => {
    renderChips();

    expect(screen.getByText('Rating:')).toBeInTheDocument();
    expect(screen.getByText('G')).toBeInTheDocument();
    expect(screen.getByText('R')).toBeInTheDocument();
  });

  it('renders nothing at all when there is nothing to filter on', () => {
    const { container } = renderChips({ options: [] });

    expect(container).toBeEmptyDOMElement();
  });

  it('toggles the option that was clicked', async () => {
    const user = userEvent.setup();
    renderChips();

    await user.click(screen.getByText('PG'));

    expect(onToggle).toHaveBeenCalledWith('PG');
  });

  it('strikes through what is excluded', () => {
    renderChips({ excluded: new Set(['R']) });

    expect(screen.getByText('R').closest('.MuiChip-root')).toHaveStyle('text-decoration: line-through');
    expect(screen.getByText('G').closest('.MuiChip-root')).toHaveStyle('text-decoration: none');
  });

  it('offers a clear chip only while something is excluded', async () => {
    const user = userEvent.setup();
    const { rerender } = renderChips();
    expect(screen.queryByText('Clear')).not.toBeInTheDocument();

    rerender(
      <FilterChips
        label="Rating"
        options={['G', 'PG', 'R']}
        excluded={new Set(['R'])}
        onToggle={onToggle}
        onClear={onClear}
      />
    );
    await user.click(screen.getByText('Clear'));

    expect(onClear).toHaveBeenCalled();
  });

  it('narrows to one option on a double click', async () => {
    const user = userEvent.setup();
    renderChips({ onSelectOnly });

    await user.dblClick(screen.getByText('PG'));

    expect(onSelectOnly).toHaveBeenCalledWith('PG');
  });

  it('does not offer narrowing when nobody is listening for it', async () => {
    const user = userEvent.setup();
    renderChips();

    await user.dblClick(screen.getByText('PG'));

    expect(onSelectOnly).not.toHaveBeenCalled();
  });
});
