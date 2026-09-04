import { render, screen } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { ViewModeMenu } from '../ViewModeMenu';

const onChange = jest.fn();

beforeEach(() => jest.clearAllMocks());

describe('ViewModeMenu', () => {
  it('shows the mode it is in on the button', () => {
    const { rerender } = render(<ViewModeMenu value="poster" onChange={onChange} />);
    expect(screen.getByTestId('ViewModuleIcon')).toBeInTheDocument();

    rerender(<ViewModeMenu value="list" onChange={onChange} />);
    expect(screen.getByTestId('ViewListIcon')).toBeInTheDocument();
  });

  it('offers both views', async () => {
    const user = userEvent.setup();
    render(<ViewModeMenu value="poster" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /change view/i }));

    expect(await screen.findByRole('menuitem', { name: /poster/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /list/i })).toBeInTheDocument();
  });

  it('ticks the one in use', async () => {
    const user = userEvent.setup();
    render(<ViewModeMenu value="list" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /change view/i }));

    const list = await screen.findByRole('menuitem', { name: /list/i });
    expect(list.querySelector('[data-testid="CheckIcon"]')).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: /poster/i }).querySelector('[data-testid="CheckIcon"]')
    ).toBeNull();
  });

  it('reports the view that was chosen and closes', async () => {
    const user = userEvent.setup();
    render(<ViewModeMenu value="poster" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /change view/i }));

    await user.click(await screen.findByRole('menuitem', { name: /list/i }));

    expect(onChange).toHaveBeenCalledWith('list');
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });
});
