import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { DirectoryPickerDialog } from '../DirectoryPickerDialog';
import { apiClient } from '../../api/client';

jest.mock('../../api/client', () => ({
  apiClient: { browseDirectories: jest.fn() },
}));
const mockApi = apiClient as jest.Mocked<typeof apiClient>;

const onClose = jest.fn();
const onSelect = jest.fn();

const listings: Record<string, unknown> = {
  '/media': {
    path: '/media',
    parent: '/',
    directories: [
      { name: 'films', path: '/media/films' },
      { name: 'shows', path: '/media/shows' },
    ],
  },
  '/media/films': { path: '/media/films', parent: '/media', directories: [] },
  '/': { path: '/', parent: null, directories: [{ name: 'media', path: '/media' }] },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.browseDirectories.mockImplementation(async (dirPath?: string) => ({
    data: listings[dirPath ?? '/media'],
  }) as never);
});

function renderDialog(props: Partial<Parameters<typeof DirectoryPickerDialog>[0]> = {}) {
  return render(
    <DirectoryPickerDialog open initialPath="/media" onClose={onClose} onSelect={onSelect} {...props} />
  );
}

describe('DirectoryPickerDialog', () => {
  it('lists the folders where it starts', async () => {
    renderDialog();

    expect(await screen.findByText('films')).toBeInTheDocument();
    expect(screen.getByText('shows')).toBeInTheDocument();
    expect(mockApi.browseDirectories).toHaveBeenCalledWith('/media');
  });

  it('descends into a folder that is clicked', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByText('films'));

    await waitFor(() => expect(mockApi.browseDirectories).toHaveBeenCalledWith('/media/films'));
    expect(await screen.findByText(/no folders here/i)).toBeInTheDocument();
  });

  it('climbs back to the parent', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText('films');

    await user.click(screen.getByRole('button', { name: /up/i }));

    await waitFor(() => expect(mockApi.browseDirectories).toHaveBeenCalledWith('/'));
  });

  it('has nowhere to climb from the root', async () => {
    renderDialog({ initialPath: '/' });
    await screen.findByText('media');

    expect(screen.getByRole('button', { name: /up/i })).toBeDisabled();
  });

  it('hands back the folder it is showing', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText('films');

    await user.click(screen.getByRole('button', { name: /use this folder/i }));

    expect(onSelect).toHaveBeenCalledWith('/media');
    expect(onClose).toHaveBeenCalled();
  });

  it('hands back the folder it descended into', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByText('films'));
    await screen.findByText(/no folders here/i);

    await user.click(screen.getByRole('button', { name: /use this folder/i }));

    expect(onSelect).toHaveBeenCalledWith('/media/films');
  });

  it('shows what went wrong when browsing fails', async () => {
    mockApi.browseDirectories.mockResolvedValue({ error: 'Permission denied' } as never);
    renderDialog();

    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
  });

  it('closes without choosing anything', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText('films');

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('browses nothing while it is closed', () => {
    renderDialog({ open: false });

    expect(mockApi.browseDirectories).not.toHaveBeenCalled();
  });
});
