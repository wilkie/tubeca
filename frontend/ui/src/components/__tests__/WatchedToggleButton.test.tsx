import { render, screen } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { WatchedToggleButton } from '../WatchedToggleButton';

describe('WatchedToggleButton', () => {
  it('asks to mark unwatched items watched and vice versa', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn().mockResolvedValue(true);
    const { rerender } = render(<WatchedToggleButton mediaId="m1" watched={false} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /mark as watched/i }));
    expect(onChange).toHaveBeenCalledWith('m1', true);

    rerender(<WatchedToggleButton mediaId="m1" watched onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /mark as unwatched/i }));
    expect(onChange).toHaveBeenCalledWith('m1', false);
  });

  it('does not bubble the click to the card underneath', async () => {
    const user = userEvent.setup();
    const cardClick = jest.fn();
    render(
      <div onClick={cardClick}>
        <WatchedToggleButton mediaId="m1" watched={false} onChange={() => true} variant="button" />
      </div>
    );
    await user.click(screen.getByRole('button'));
    expect(cardClick).not.toHaveBeenCalled();
  });
});
