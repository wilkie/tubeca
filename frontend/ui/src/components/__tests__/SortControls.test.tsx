import { render, screen } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { SortControls } from '../SortControls';

const onValueChange = jest.fn();
const onDirectionChange = jest.fn();

const options = [
  { value: 'name', label: 'Name' },
  { value: 'releaseDate', label: 'Release date' },
  { value: 'rating', label: 'Rating' },
];

beforeEach(() => jest.clearAllMocks());

function renderControls(props: Partial<Parameters<typeof SortControls>[0]> = {}) {
  return render(
    <SortControls
      options={options}
      value="name"
      direction="asc"
      onValueChange={onValueChange}
      onDirectionChange={onDirectionChange}
      {...props}
    />
  );
}

describe('SortControls', () => {
  it('shows the field it is sorting by', () => {
    renderControls({ value: 'rating' });

    expect(screen.getByRole('combobox')).toHaveTextContent('Rating');
  });

  it('offers every option', async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByRole('combobox'));

    expect(await screen.findByRole('option', { name: 'Release date' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('reports the field that was chosen', async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Rating' }));

    expect(onValueChange).toHaveBeenCalledWith('rating');
  });

  it('turns ascending into descending', async () => {
    const user = userEvent.setup();
    renderControls({ direction: 'asc' });

    await user.click(screen.getByRole('button', { name: /ascending/i }));

    expect(onDirectionChange).toHaveBeenCalledWith('desc');
  });

  it('turns descending back into ascending', async () => {
    const user = userEvent.setup();
    renderControls({ direction: 'desc' });

    await user.click(screen.getByRole('button', { name: /descending/i }));

    expect(onDirectionChange).toHaveBeenCalledWith('asc');
  });
});
