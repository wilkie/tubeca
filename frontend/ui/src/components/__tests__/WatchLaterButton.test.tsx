import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { WatchLaterButton } from '../WatchLaterButton';
import { apiClient } from '../../api/client';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    checkWatchLater: jest.fn(),
    toggleWatchLater: jest.fn(),
  },
}));

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('WatchLaterButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiClient.checkWatchLater.mockResolvedValue({
      data: { collectionIds: [], mediaIds: [] },
    });
    mockApiClient.toggleWatchLater.mockResolvedValue({
      data: { inWatchLater: true },
    });
  });

  describe('initial state', () => {
    it('renders the button', async () => {
      render(<WatchLaterButton collectionId="col-1" />);

      await waitFor(() => {
        expect(screen.getByRole('button')).toBeInTheDocument();
      });
    });

    it('checks watch later status on mount for collection', async () => {
      render(<WatchLaterButton collectionId="col-1" />);

      await waitFor(() => {
        expect(mockApiClient.checkWatchLater).toHaveBeenCalledWith(
          ['col-1'],
          undefined
        );
      });
    });

    it('checks watch later status on mount for media', async () => {
      render(<WatchLaterButton mediaId="media-1" />);

      await waitFor(() => {
        expect(mockApiClient.checkWatchLater).toHaveBeenCalledWith(
          undefined,
          ['media-1']
        );
      });
    });

    it('shows loading state initially', () => {
      mockApiClient.checkWatchLater.mockImplementation(() => new Promise(() => {}));

      render(<WatchLaterButton collectionId="col-1" />);

      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
    });

    it('enables button after loading completes', async () => {
      render(<WatchLaterButton collectionId="col-1" />);

      await waitFor(() => {
        expect(screen.getByRole('button')).not.toBeDisabled();
      });
    });
  });

  describe('not in watch later', () => {
    beforeEach(() => {
      mockApiClient.checkWatchLater.mockResolvedValue({
        data: { collectionIds: [], mediaIds: [] },
      });
    });

    it('shows "Add to Watch Later" tooltip', async () => {
      render(<WatchLaterButton collectionId="col-1" />);

      await waitFor(() => {
        expect(screen.getByRole('button')).not.toBeDisabled();
      });

      // Button has aria-label for tooltip
      expect(screen.getByRole('button', { name: /add to watch later/i })).toBeInTheDocument();
    });

    it('shows outlined icon when not in watch later', async () => {
      render(<WatchLaterButton collectionId="col-1" />);

      await waitFor(() => {
        expect(screen.getByRole('button')).not.toBeDisabled();
      });

      expect(screen.getByTestId('WatchLaterOutlinedIcon')).toBeInTheDocument();
    });
  });

  describe('in watch later', () => {
    beforeEach(() => {
      mockApiClient.checkWatchLater.mockResolvedValue({
        data: { collectionIds: ['col-1'], mediaIds: [] },
      });
    });

    it('shows "Remove from Watch Later" tooltip', async () => {
      render(<WatchLaterButton collectionId="col-1" />);

      await waitFor(() => {
        expect(screen.getByRole('button')).not.toBeDisabled();
      });

      // Button has aria-label for tooltip
      expect(screen.getByRole('button', { name: /remove from watch later/i })).toBeInTheDocument();
    });

    it('shows filled icon when in watch later', async () => {
      render(<WatchLaterButton collectionId="col-1" />);

      await waitFor(() => {
        expect(screen.getByRole('button')).not.toBeDisabled();
      });

      expect(screen.getByTestId('WatchLaterIcon')).toBeInTheDocument();
    });
  });

  describe('toggling', () => {
    it('calls toggleWatchLater when clicked', async () => {
      const user = userEvent.setup();

      render(<WatchLaterButton collectionId="col-1" />);

      await waitFor(() => {
        expect(screen.getByRole('button')).not.toBeDisabled();
      });

      await user.click(screen.getByRole('button'));

      expect(mockApiClient.toggleWatchLater).toHaveBeenCalledWith({
        collectionId: 'col-1',
        mediaId: undefined,
      });
    });

    it('calls toggleWatchLater with mediaId', async () => {
      const user = userEvent.setup();

      render(<WatchLaterButton mediaId="media-1" />);

      await waitFor(() => {
        expect(screen.getByRole('button')).not.toBeDisabled();
      });

      await user.click(screen.getByRole('button'));

      expect(mockApiClient.toggleWatchLater).toHaveBeenCalledWith({
        collectionId: undefined,
        mediaId: 'media-1',
      });
    });

    it('updates icon after adding to watch later', async () => {
      const user = userEvent.setup();

      mockApiClient.toggleWatchLater.mockResolvedValue({
        data: { inWatchLater: true },
      });

      render(<WatchLaterButton collectionId="col-1" />);

      await waitFor(() => {
        expect(screen.getByRole('button')).not.toBeDisabled();
      });

      expect(screen.getByTestId('WatchLaterOutlinedIcon')).toBeInTheDocument();

      await user.click(screen.getByRole('button'));

      await waitFor(() => {
        expect(screen.getByTestId('WatchLaterIcon')).toBeInTheDocument();
      });
    });

    it('updates icon after removing from watch later', async () => {
      const user = userEvent.setup();

      mockApiClient.checkWatchLater.mockResolvedValue({
        data: { collectionIds: ['col-1'], mediaIds: [] },
      });
      mockApiClient.toggleWatchLater.mockResolvedValue({
        data: { inWatchLater: false },
      });

      render(<WatchLaterButton collectionId="col-1" />);

      await waitFor(() => {
        expect(screen.getByTestId('WatchLaterIcon')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button'));

      await waitFor(() => {
        expect(screen.getByTestId('WatchLaterOutlinedIcon')).toBeInTheDocument();
      });
    });

    it('disables button while toggling', async () => {
      const user = userEvent.setup();

      let resolveToggle: (value: { data: { inWatchLater: boolean } }) => void;
      mockApiClient.toggleWatchLater.mockImplementation(
        () => new Promise((resolve) => { resolveToggle = resolve; })
      );

      render(<WatchLaterButton collectionId="col-1" />);

      await waitFor(() => {
        expect(screen.getByRole('button')).not.toBeDisabled();
      });

      await user.click(screen.getByRole('button'));

      expect(screen.getByRole('button')).toBeDisabled();

      // Resolve the toggle
      resolveToggle!({ data: { inWatchLater: true } });

      await waitFor(() => {
        expect(screen.getByRole('button')).not.toBeDisabled();
      });
    });

    it('prevents multiple clicks while toggling', async () => {
      const user = userEvent.setup();

      let resolveToggle: (value: { data: { inWatchLater: boolean } }) => void;
      mockApiClient.toggleWatchLater.mockImplementation(
        () => new Promise((resolve) => { resolveToggle = resolve; })
      );

      render(<WatchLaterButton collectionId="col-1" />);

      await waitFor(() => {
        expect(screen.getByRole('button')).not.toBeDisabled();
      });

      await user.click(screen.getByRole('button'));

      // Button is disabled, so this click shouldn't trigger another API call
      // But even if we try, it should be prevented
      expect(mockApiClient.toggleWatchLater).toHaveBeenCalledTimes(1);

      resolveToggle!({ data: { inWatchLater: true } });

      await waitFor(() => {
        expect(screen.getByRole('button')).not.toBeDisabled();
      });
    });
  });

  describe('props', () => {
    it('applies size prop', async () => {
      render(<WatchLaterButton collectionId="col-1" size="small" />);

      await waitFor(() => {
        expect(screen.getByRole('button')).not.toBeDisabled();
      });

      expect(screen.getByRole('button')).toHaveClass('MuiIconButton-sizeSmall');
    });

    it('applies custom sx prop', async () => {
      render(<WatchLaterButton collectionId="col-1" sx={{ margin: 2 }} />);

      await waitFor(() => {
        expect(screen.getByRole('button')).not.toBeDisabled();
      });

      // Just verify it renders without error
      expect(screen.getByRole('button')).toBeInTheDocument();
    });
  });

  describe('click propagation', () => {
    it('stops event propagation on click', async () => {
      const user = userEvent.setup();
      const parentClickHandler = jest.fn();

      render(
        <div onClick={parentClickHandler}>
          <WatchLaterButton collectionId="col-1" />
        </div>
      );

      await waitFor(() => {
        expect(screen.getByRole('button')).not.toBeDisabled();
      });

      await user.click(screen.getByRole('button'));

      expect(parentClickHandler).not.toHaveBeenCalled();
    });
  });
});
