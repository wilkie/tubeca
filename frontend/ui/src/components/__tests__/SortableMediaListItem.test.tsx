import { render, screen } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { Movie } from '@mui/icons-material';
import type { UserCollectionItem } from '../../api/client';
import { SortableMediaListItem } from '../SortableMediaListItem';

const onItemClick = jest.fn();
const onPlayItem = jest.fn();
const onRemoveItem = jest.fn();

beforeEach(() => jest.clearAllMocks());

const item = {
  id: 'item-1',
  media: { id: 'media-1', name: 'Pilot', duration: 3660 },
} as UserCollectionItem;

function renderItem(props: Partial<Parameters<typeof SortableMediaListItem>[0]> = {}) {
  const merged = {
    item,
    index: 2,
    onItemClick,
    onPlayItem,
    onRemoveItem,
    getItemImage: () => 'http://localhost/poster.jpg',
    getItemName: () => 'Pilot',
    getItemSubtitle: () => 'Breaking Bad',
    getItemIcon: () => <Movie data-testid="fallback" />,
    removeTooltip: 'Remove from playlist',
    ...props,
  };

  return render(
    <DndContext>
      <SortableContext items={[merged.item.id]}>
        <SortableMediaListItem {...merged} />
      </SortableContext>
    </DndContext>
  );
}

describe('SortableMediaListItem', () => {
  it('numbers the row from its place in the list', () => {
    renderItem();

    expect(screen.getByText('#3')).toBeInTheDocument();
  });

  it('shows the name, the subtitle and the artwork', () => {
    renderItem();

    expect(screen.getByText('Pilot')).toBeInTheDocument();
    expect(screen.getByText('Breaking Bad')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Pilot' })).toBeInTheDocument();
  });

  it('falls back to the icon when there is no artwork', () => {
    renderItem({ getItemImage: () => null });

    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });

  it('spells a duration over an hour in hours and minutes', () => {
    renderItem();

    expect(screen.getByText('1h 1m')).toBeInTheDocument();
  });

  it('spells a shorter one in minutes alone', () => {
    renderItem({ item: { ...item, media: { ...item.media, duration: 2400 } } as UserCollectionItem });

    expect(screen.getByText('40m')).toBeInTheDocument();
  });

  it('opens the item from the row', async () => {
    const user = userEvent.setup();
    renderItem();

    await user.click(screen.getByText('Pilot'));

    expect(onItemClick).toHaveBeenCalledWith(item);
  });

  it('plays from the play button, and says where in the list it was', async () => {
    const user = userEvent.setup();
    renderItem({ playLabel: 'Play' });

    await user.click(screen.getByRole('button', { name: 'Play' }));

    expect(onPlayItem).toHaveBeenCalledWith(item, 2, expect.anything());
    expect(onItemClick).not.toHaveBeenCalled();
  });

  it('offers no play button for an item with no media', () => {
    renderItem({ item: { id: 'item-2' } as UserCollectionItem });

    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
  });

  it('can be told to offer one anyway', () => {
    renderItem({ item: { id: 'item-2' } as UserCollectionItem, showPlayButton: true });

    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('removes the item from its own button', async () => {
    const user = userEvent.setup();
    renderItem();

    await user.click(screen.getByRole('button', { name: 'Remove from playlist' }));

    expect(onRemoveItem).toHaveBeenCalledWith(item, expect.anything());
  });

  it('shows a bin instead of a cross when asked', () => {
    renderItem({ useDeleteIcon: true });

    expect(screen.getByTestId('DeleteIcon')).toBeInTheDocument();
    expect(screen.queryByTestId('ClearIcon')).not.toBeInTheDocument();
  });

  it('can drop the drag handle and the remove button', () => {
    renderItem({ showDragHandle: false, showRemoveButton: false });

    expect(screen.queryByTestId('DragIndicatorIcon')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove from playlist' })).not.toBeInTheDocument();
  });

  it('carries a drag handle by default', () => {
    renderItem();

    expect(screen.getByTestId('DragIndicatorIcon')).toBeInTheDocument();
  });
});
