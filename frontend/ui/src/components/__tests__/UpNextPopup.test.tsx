import { render, screen } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import type { NextItemInfo } from '../../context/PlayerContext';
import { UpNextPopup } from '../UpNextPopup';

const onStart = jest.fn();

const episode: NextItemInfo = {
  id: 'm2',
  name: 'Cat in the Bag...',
  type: 'episode',
  seasonNumber: 1,
  episodeNumber: 3,
};

beforeEach(() => jest.clearAllMocks());

function renderPopup(props: Partial<Parameters<typeof UpNextPopup>[0]> = {}) {
  return render(
    <UpNextPopup
      nextItem={episode}
      currentTime={1180}
      duration={1200}
      onStart={onStart}
      showControls={false}
      {...props}
    />
  );
}

describe('UpNextPopup', () => {
  it('keeps out of the way until the end is in sight', () => {
    const { container } = renderPopup({ currentTime: 600 });

    expect(container).toBeEmptyDOMElement();
  });

  it('appears in the last thirty seconds, counting down', () => {
    renderPopup({ currentTime: 1175 });

    expect(screen.getByText(/Up Next \(25s\)/)).toBeInTheDocument();
    expect(screen.getByText('Cat in the Bag...')).toBeInTheDocument();
  });

  it('goes away again once the video has ended', () => {
    const { container } = renderPopup({ currentTime: 1200 });

    expect(container).toBeEmptyDOMElement();
  });

  it('says which episode is next', () => {
    renderPopup();

    expect(screen.getByText('S1:E3')).toBeInTheDocument();
  });

  it('says when the next item comes from the queue instead', () => {
    renderPopup({ nextItem: { id: 'm2', name: 'Heat', type: 'queue' } });

    expect(screen.getByText(/from queue/i)).toBeInTheDocument();
  });

  it('offers two ways to dismiss it: the cross in the header and the button', () => {
    renderPopup();

    expect(screen.getAllByRole('button', { name: /^hide$/i })).toHaveLength(2);
  });

  it('starts the next item when asked', async () => {
    const user = userEvent.setup();
    renderPopup();

    await user.click(screen.getByRole('button', { name: /start/i }));

    expect(onStart).toHaveBeenCalled();
  });

  it('stays hidden once it has been dismissed', async () => {
    const user = userEvent.setup();
    const { rerender } = renderPopup({ currentTime: 1180 });

    await user.click(screen.getAllByRole('button', { name: /^hide$/i })[0]);

    expect(screen.queryByText('Cat in the Bag...')).not.toBeInTheDocument();
    rerender(
      <UpNextPopup
        nextItem={episode}
        currentTime={1190}
        duration={1200}
        onStart={onStart}
        showControls={false}
      />
    );
    expect(screen.queryByText('Cat in the Bag...')).not.toBeInTheDocument();
  });

  it('comes back for the item after the one that was dismissed', async () => {
    const user = userEvent.setup();
    const { rerender } = renderPopup();
    await user.click(screen.getAllByRole('button', { name: /^hide$/i })[1]);

    rerender(
      <UpNextPopup
        nextItem={{ ...episode, id: 'm3', name: 'And the Bag’s in the River' }}
        currentTime={1190}
        duration={1200}
        onStart={onStart}
        showControls={false}
      />
    );

    expect(screen.getByText('And the Bag’s in the River')).toBeInTheDocument();
  });

  it('sits above the controls while they are showing', () => {
    const { container } = renderPopup({ showControls: true });

    expect(container.firstElementChild).toHaveStyle('bottom: 100px');
  });
});
