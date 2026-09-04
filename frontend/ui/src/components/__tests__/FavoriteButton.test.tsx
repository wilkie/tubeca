import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { FavoriteButton } from '../FavoriteButton';
import { apiClient } from '../../api/client';

jest.mock('../../api/client', () => ({
  apiClient: {
    checkFavorites: jest.fn(),
    toggleFavorite: jest.fn(),
  },
}));
const mockApi = apiClient as jest.Mocked<typeof apiClient>;

const ready = () => waitFor(() => expect(screen.getByRole('button')).not.toBeDisabled());

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.checkFavorites.mockResolvedValue({ data: { collectionIds: [], mediaIds: [], userCollectionIds: [] } });
  mockApi.toggleFavorite.mockResolvedValue({ data: { favorited: true } });
});

describe('FavoriteButton', () => {
  it('asks about the collection it was given', async () => {
    render(<FavoriteButton collectionId="col-1" />);

    await waitFor(() => expect(mockApi.checkFavorites).toHaveBeenCalledWith(['col-1'], undefined));
  });

  it('asks about the media it was given', async () => {
    render(<FavoriteButton mediaId="media-1" />);

    await waitFor(() => expect(mockApi.checkFavorites).toHaveBeenCalledWith(undefined, ['media-1']));
  });

  it('cannot be pressed until the answer arrives', () => {
    mockApi.checkFavorites.mockImplementation(() => new Promise(() => {}));

    render(<FavoriteButton collectionId="col-1" />);

    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('offers to add what is not a favourite', async () => {
    render(<FavoriteButton collectionId="col-1" />);
    await ready();

    expect(screen.getByRole('button', { name: /add to favorites/i })).toBeInTheDocument();
    expect(screen.getByTestId('FavoriteBorderIcon')).toBeInTheDocument();
  });

  it('offers to remove what already is one', async () => {
    mockApi.checkFavorites.mockResolvedValue({ data: { collectionIds: ['col-1'], mediaIds: [], userCollectionIds: [] } });

    render(<FavoriteButton collectionId="col-1" />);
    await ready();

    expect(screen.getByRole('button', { name: /remove from favorites/i })).toBeInTheDocument();
    expect(screen.getByTestId('FavoriteIcon')).toBeInTheDocument();
  });

  it('fills in once it is favourited', async () => {
    const user = userEvent.setup();
    render(<FavoriteButton collectionId="col-1" />);
    await ready();

    await user.click(screen.getByRole('button'));

    expect(mockApi.toggleFavorite).toHaveBeenCalledWith({
      collectionId: 'col-1',
      mediaId: undefined,
    });
    expect(await screen.findByTestId('FavoriteIcon')).toBeInTheDocument();
  });

  it('empties again when it is unfavourited', async () => {
    const user = userEvent.setup();
    mockApi.checkFavorites.mockResolvedValue({ data: { collectionIds: ['col-1'], mediaIds: [], userCollectionIds: [] } });
    mockApi.toggleFavorite.mockResolvedValue({ data: { favorited: false } });
    render(<FavoriteButton collectionId="col-1" />);
    await ready();

    await user.click(screen.getByRole('button'));

    expect(await screen.findByTestId('FavoriteBorderIcon')).toBeInTheDocument();
  });

  it('takes only the first of a flurry of clicks', async () => {
    const user = userEvent.setup();
    mockApi.toggleFavorite.mockImplementation(() => new Promise(() => {}));
    render(<FavoriteButton collectionId="col-1" />);
    await ready();

    await user.click(screen.getByRole('button'));

    expect(screen.getByRole('button')).toBeDisabled();
    expect(mockApi.toggleFavorite).toHaveBeenCalledTimes(1);
  });

  it('keeps the click off the card underneath', async () => {
    const user = userEvent.setup();
    const onCardClick = jest.fn();
    render(
      <div onClick={onCardClick}>
        <FavoriteButton collectionId="col-1" />
      </div>
    );
    await ready();

    await user.click(screen.getByRole('button'));

    expect(onCardClick).not.toHaveBeenCalled();
  });

  it('does not favourite anything it was told nothing about', async () => {
    render(<FavoriteButton />);
    await ready();

    expect(screen.getByRole('button', { name: /add to favorites/i })).toBeInTheDocument();
  });
});
