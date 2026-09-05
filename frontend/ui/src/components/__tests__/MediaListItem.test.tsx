import { DEFAULT_VIEWPORT_WIDTH, render, screen, setViewportWidth } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { Movie } from '@mui/icons-material';
import { MediaListItem, MediaListItemBadge, MediaListItemMeta } from '../MediaListItem';

const onClick = jest.fn();
const onPlay = jest.fn();

beforeEach(() => jest.clearAllMocks());

function renderItem(props: Partial<Parameters<typeof MediaListItem>[0]> = {}) {
  return render(
    <MediaListItem
      imageAlt="Heat poster"
      fallbackIcon={<Movie data-testid="fallback" />}
      title="Heat"
      {...props}
    />
  );
}

describe('MediaListItem', () => {
  it('shows the poster when there is one', () => {
    renderItem({ imageUrl: 'http://localhost/poster.jpg' });

    expect(screen.getByRole('img', { name: 'Heat poster' })).toHaveAttribute(
      'src',
      'http://localhost/poster.jpg'
    );
    expect(screen.queryByTestId('fallback')).not.toBeInTheDocument();
  });

  it('falls back to the icon when there is not', () => {
    renderItem({ imageUrl: null });

    expect(screen.getByTestId('fallback')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('opens the item when the card is clicked', async () => {
    const user = userEvent.setup();
    renderItem({ onClick });

    await user.click(screen.getByText('Heat'));

    expect(onClick).toHaveBeenCalled();
  });

  it('plays without opening when the play button is clicked', async () => {
    const user = userEvent.setup();
    renderItem({ onClick, onPlay });

    await user.click(screen.getByRole('button', { name: 'Play' }));

    expect(onPlay).toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('has no play button when there is nothing to play', () => {
    renderItem({ onClick });

    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
  });

  it('lays out badges, metadata and a description when given them', () => {
    renderItem({
      badges: <MediaListItemBadge>PG</MediaListItemBadge>,
      metadata: <MediaListItemMeta>1995</MediaListItemMeta>,
      description: 'A crew of thieves and the detective chasing them.',
      actions: <button type="button">Remove</button>,
    });

    expect(screen.getByText('PG')).toBeInTheDocument();
    expect(screen.getByText('1995')).toBeInTheDocument();
    expect(screen.getByText(/crew of thieves/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('leaves out the metadata row when there is neither badge nor metadata', () => {
    const { container } = renderItem();

    expect(container.querySelector('.MuiStack-root')).toBeNull();
  });

  describe('on a narrow screen', () => {
    afterEach(() => setViewportWidth(DEFAULT_VIEWPORT_WIDTH));

    it('drops the description, which leaves the title nothing to share with', () => {
      renderItem({ description: 'A long synopsis that would take two lines of its own.' });
      expect(screen.getByText(/long synopsis/)).toBeInTheDocument();

      setViewportWidth(400);

      expect(screen.queryByText(/long synopsis/)).not.toBeInTheDocument();
      // The title and any badges are what a row is for; they stay.
      expect(screen.getByText('Heat')).toBeInTheDocument();
    });
  });
});
