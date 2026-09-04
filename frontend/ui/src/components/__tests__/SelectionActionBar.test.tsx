import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { SelectionActionBar } from '../SelectionActionBar';
import { apiClient } from '../../api/client';

jest.mock('../../api/client', () => ({
  apiClient: {
    getUserCollections: jest.fn(),
    addUserCollectionItem: jest.fn(),
    createUserCollection: jest.fn(),
  },
}));
const mockApi = apiClient as jest.Mocked<typeof apiClient>;

const onClear = jest.fn();
const onSelectAll = jest.fn();
const onAddComplete = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getUserCollections.mockResolvedValue({
    data: { userCollections: [{ id: 'c1', name: 'Watch tonight' }] },
  } as never);
  mockApi.addUserCollectionItem.mockResolvedValue({ data: {} } as never);
  mockApi.createUserCollection.mockResolvedValue({
    data: { userCollection: { id: 'c2', name: 'New list' } },
  } as never);
});

function renderBar(props: Partial<Parameters<typeof SelectionActionBar>[0]> = {}) {
  return render(
    <SelectionActionBar
      selectedCount={2}
      selectedCollectionIds={['col-1', 'col-2']}
      onClear={onClear}
      onSelectAll={onSelectAll}
      onAddComplete={onAddComplete}
      {...props}
    />
  );
}

describe('SelectionActionBar', () => {
  it('shows nothing when nothing is selected', () => {
    const { container } = renderBar({ selectedCount: 0 });

    expect(container).toBeEmptyDOMElement();
  });

  it('reports how many are selected', () => {
    renderBar();

    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('clears the selection', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole('button', { name: /clear selection/i }));

    expect(onClear).toHaveBeenCalled();
  });

  it('selects everything loaded', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole('button', { name: /select all/i }));

    expect(onSelectAll).toHaveBeenCalled();
  });

  it('loads the collections only when the menu opens', async () => {
    const user = userEvent.setup();
    renderBar();

    expect(mockApi.getUserCollections).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /add to collection/i }));

    await waitFor(() => expect(mockApi.getUserCollections).toHaveBeenCalled());
  });

  it('adds every selected item, one call each', async () => {
    const user = userEvent.setup();
    renderBar({ selectedCount: 3, selectedCollectionIds: ['col-1'], selectedMediaIds: ['m-1', 'm-2'] });

    await user.click(screen.getByRole('button', { name: /add to collection/i }));
    await user.click(await screen.findByText('Watch tonight'));

    await waitFor(() => expect(mockApi.addUserCollectionItem).toHaveBeenCalledTimes(3));
    expect(mockApi.addUserCollectionItem).toHaveBeenCalledWith('c1', { collectionId: 'col-1' });
    expect(mockApi.addUserCollectionItem).toHaveBeenCalledWith('c1', { mediaId: 'm-1' });
    expect(mockApi.addUserCollectionItem).toHaveBeenCalledWith('c1', { mediaId: 'm-2' });
    expect(onClear).toHaveBeenCalled();
    expect(onAddComplete).toHaveBeenCalled();
  });

  it('treats an item already in the collection as success', async () => {
    const user = userEvent.setup();
    mockApi.addUserCollectionItem.mockResolvedValue({ error: 'Item already exists in collection' } as never);
    renderBar();

    await user.click(screen.getByRole('button', { name: /add to collection/i }));
    await user.click(await screen.findByText('Watch tonight'));

    await waitFor(() => expect(onClear).toHaveBeenCalled());
  });

  it('keeps the selection when an add genuinely fails', async () => {
    const user = userEvent.setup();
    mockApi.addUserCollectionItem.mockResolvedValue({ error: 'Collection not found' } as never);
    renderBar();

    await user.click(screen.getByRole('button', { name: /add to collection/i }));
    await user.click(await screen.findByText('Watch tonight'));

    await waitFor(() => expect(mockApi.addUserCollectionItem).toHaveBeenCalled());
    expect(onClear).not.toHaveBeenCalled();
  });

  it('creates a collection and puts the selection in it', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole('button', { name: /add to collection/i }));
    // Wait for the list to arrive: it re-renders the menu, which would
    // otherwise take the focus off the name field mid-typing.
    await screen.findByText('Watch tonight');
    await user.click(screen.getByText('Create Collection'));
    // Typing has to work here: the field is inside a Menu whose list would
    // otherwise take the letters for type-ahead.
    await user.type(screen.getByLabelText(/name/i), 'New list');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(mockApi.createUserCollection).toHaveBeenCalledWith({ name: 'New list' }));
    expect(mockApi.addUserCollectionItem).toHaveBeenCalledWith('c2', { collectionId: 'col-1' });
  });

  it('will not create a collection with no name', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole('button', { name: /add to collection/i }));
    await screen.findByText('Watch tonight');
    await user.click(screen.getByText('Create Collection'));

    expect(screen.getByRole('button', { name: /^create$/i })).toBeDisabled();
    expect(mockApi.createUserCollection).not.toHaveBeenCalled();
  });
});
