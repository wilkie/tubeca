import { render, screen } from '../../test-utils';
import { WatchBadge } from '../WatchBadge';

const progress = (position: number, completed = false) => ({
  id: 'p', userId: 'u', mediaId: 'm', position, duration: 100, completed, createdAt: '', updatedAt: '',
});

describe('WatchBadge', () => {
  it('renders nothing without state', () => {
    const { container } = render(<WatchBadge kind="media" progress={undefined} />);
    expect(container).toBeEmptyDOMElement();
    const { container: c2 } = render(<WatchBadge kind="collection" summary={{ total: 5, watched: 0, inProgress: 0 }} />);
    expect(c2).toBeEmptyDOMElement();
  });

  it('shows a check for watched media and a progress bar for partly watched media', () => {
    render(<WatchBadge kind="media" progress={progress(100, true)} />);
    expect(screen.getByTestId('watch-badge')).toBeInTheDocument();
    render(<WatchBadge kind="media" progress={progress(40)} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
  });

  it('shows remaining count, a check when complete, and a bar for single-item collections', () => {
    render(<WatchBadge kind="collection" summary={{ total: 10, watched: 3, inProgress: 1 }} />);
    expect(screen.getByTestId('watch-badge')).toHaveTextContent('7');

    render(<WatchBadge kind="collection" summary={{ total: 2, watched: 2, inProgress: 0 }} />);
    expect(screen.getAllByTestId('watch-badge')).toHaveLength(2);

    render(
      <WatchBadge kind="collection" summary={{ total: 1, watched: 0, inProgress: 1, resume: { mediaId: 'm', position: 25, duration: 100 } }} />
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  });
});
