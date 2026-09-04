import { render, screen } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import type { UserCollection } from '../../api/client';
import { RecentCollectionMenuItem } from '../RecentCollectionMenuItem';

const onClick = jest.fn();
const collection = { id: 'c1', name: 'Watch tonight' } as UserCollection;

beforeEach(() => jest.clearAllMocks());

describe('RecentCollectionMenuItem', () => {
  it('names the collection it would add to', () => {
    render(<RecentCollectionMenuItem collection={collection} onClick={onClick} />);

    expect(screen.getByRole('menuitem', { name: 'Watch tonight' })).toBeInTheDocument();
  });

  it('renders nothing while the collection is unknown', () => {
    const { container } = render(<RecentCollectionMenuItem collection={null} onClick={onClick} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('adds to it when clicked', async () => {
    const user = userEvent.setup();
    render(<RecentCollectionMenuItem collection={collection} onClick={onClick} />);

    await user.click(screen.getByRole('menuitem'));

    expect(onClick).toHaveBeenCalled();
  });

  it('is out of reach while the first add is in flight', async () => {
    const user = userEvent.setup();
    render(<RecentCollectionMenuItem collection={collection} disabled onClick={onClick} />);

    expect(screen.getByRole('menuitem')).toHaveAttribute('aria-disabled', 'true');
    await expect(user.click(screen.getByRole('menuitem'))).rejects.toThrow(/pointer-events/);
    expect(onClick).not.toHaveBeenCalled();
  });
});
