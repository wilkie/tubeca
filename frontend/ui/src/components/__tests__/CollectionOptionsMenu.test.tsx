import { render, screen } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { CollectionOptionsMenu } from '../CollectionOptionsMenu';

describe('CollectionOptionsMenu', () => {
  const mockOnClose = jest.fn();
  const mockOnImagesClick = jest.fn();
  const mockOnRefreshMetadata = jest.fn();
  const mockOnRefreshImages = jest.fn();
  const mockOnDeleteClick = jest.fn();

  // Create a real anchor element for the menu
  let anchorEl: HTMLElement;

  beforeEach(() => {
    jest.clearAllMocks();
    anchorEl = document.createElement('button');
    document.body.appendChild(anchorEl);
  });

  afterEach(() => {
    document.body.removeChild(anchorEl);
  });

  describe('when closed', () => {
    it('does not render menu items when closed', () => {
      render(
        <CollectionOptionsMenu
          anchorEl={null}
          open={false}
          onClose={mockOnClose}
          onImagesClick={mockOnImagesClick}
          onRefreshMetadata={mockOnRefreshMetadata}
          onRefreshImages={mockOnRefreshImages}
          onDeleteClick={mockOnDeleteClick}
          canEdit={true}
          canIdentify={false}
          isRefreshing={false}
          isRefreshingImages={false}
        />
      );

      expect(screen.queryByText('Images')).not.toBeInTheDocument();
    });
  });

  describe('when open', () => {
    it('renders images option', () => {
      render(
        <CollectionOptionsMenu
          anchorEl={anchorEl}
          open={true}
          onClose={mockOnClose}
          onImagesClick={mockOnImagesClick}
          onRefreshMetadata={mockOnRefreshMetadata}
          onRefreshImages={mockOnRefreshImages}
          onDeleteClick={mockOnDeleteClick}
          canEdit={true}
          canIdentify={false}
          isRefreshing={false}
          isRefreshingImages={false}
        />
      );

      expect(screen.getByText('Images')).toBeInTheDocument();
    });

    it('renders admin options when canEdit is true', () => {
      render(
        <CollectionOptionsMenu
          anchorEl={anchorEl}
          open={true}
          onClose={mockOnClose}
          onImagesClick={mockOnImagesClick}
          onRefreshMetadata={mockOnRefreshMetadata}
          onRefreshImages={mockOnRefreshImages}
          onDeleteClick={mockOnDeleteClick}
          canEdit={true}
          canIdentify={false}
          isRefreshing={false}
          isRefreshingImages={false}
        />
      );

      expect(screen.getByText('Refresh metadata')).toBeInTheDocument();
      expect(screen.getByText('Refresh images')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('hides admin options when canEdit is false', () => {
      render(
        <CollectionOptionsMenu
          anchorEl={anchorEl}
          open={true}
          onClose={mockOnClose}
          onImagesClick={mockOnImagesClick}
          onRefreshMetadata={mockOnRefreshMetadata}
          onRefreshImages={mockOnRefreshImages}
          onDeleteClick={mockOnDeleteClick}
          canEdit={false}
          canIdentify={false}
          isRefreshing={false}
          isRefreshingImages={false}
        />
      );

      expect(screen.getByText('Images')).toBeInTheDocument();
      expect(screen.queryByText('Refresh metadata')).not.toBeInTheDocument();
      expect(screen.queryByText('Refresh images')).not.toBeInTheDocument();
      expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls onImagesClick when images clicked', async () => {
      const user = userEvent.setup();

      render(
        <CollectionOptionsMenu
          anchorEl={anchorEl}
          open={true}
          onClose={mockOnClose}
          onImagesClick={mockOnImagesClick}
          onRefreshMetadata={mockOnRefreshMetadata}
          onRefreshImages={mockOnRefreshImages}
          onDeleteClick={mockOnDeleteClick}
          canEdit={true}
          canIdentify={false}
          isRefreshing={false}
          isRefreshingImages={false}
        />
      );

      await user.click(screen.getByText('Images'));

      expect(mockOnImagesClick).toHaveBeenCalled();
    });

    it('calls onRefreshMetadata when refresh metadata clicked', async () => {
      const user = userEvent.setup();

      render(
        <CollectionOptionsMenu
          anchorEl={anchorEl}
          open={true}
          onClose={mockOnClose}
          onImagesClick={mockOnImagesClick}
          onRefreshMetadata={mockOnRefreshMetadata}
          onRefreshImages={mockOnRefreshImages}
          onDeleteClick={mockOnDeleteClick}
          canEdit={true}
          canIdentify={false}
          isRefreshing={false}
          isRefreshingImages={false}
        />
      );

      await user.click(screen.getByText('Refresh metadata'));

      expect(mockOnRefreshMetadata).toHaveBeenCalled();
    });

    it('calls onRefreshImages when refresh images clicked', async () => {
      const user = userEvent.setup();

      render(
        <CollectionOptionsMenu
          anchorEl={anchorEl}
          open={true}
          onClose={mockOnClose}
          onImagesClick={mockOnImagesClick}
          onRefreshMetadata={mockOnRefreshMetadata}
          onRefreshImages={mockOnRefreshImages}
          onDeleteClick={mockOnDeleteClick}
          canEdit={true}
          canIdentify={false}
          isRefreshing={false}
          isRefreshingImages={false}
        />
      );

      await user.click(screen.getByText('Refresh images'));

      expect(mockOnRefreshImages).toHaveBeenCalled();
    });

    it('calls onDeleteClick when delete clicked', async () => {
      const user = userEvent.setup();

      render(
        <CollectionOptionsMenu
          anchorEl={anchorEl}
          open={true}
          onClose={mockOnClose}
          onImagesClick={mockOnImagesClick}
          onRefreshMetadata={mockOnRefreshMetadata}
          onRefreshImages={mockOnRefreshImages}
          onDeleteClick={mockOnDeleteClick}
          canEdit={true}
          canIdentify={false}
          isRefreshing={false}
          isRefreshingImages={false}
        />
      );

      await user.click(screen.getByText('Delete'));

      expect(mockOnDeleteClick).toHaveBeenCalled();
    });
  });

  describe('refreshing states', () => {
    it('shows refreshing text when isRefreshing is true', () => {
      render(
        <CollectionOptionsMenu
          anchorEl={anchorEl}
          open={true}
          onClose={mockOnClose}
          onImagesClick={mockOnImagesClick}
          onRefreshMetadata={mockOnRefreshMetadata}
          onRefreshImages={mockOnRefreshImages}
          onDeleteClick={mockOnDeleteClick}
          canEdit={true}
          canIdentify={false}
          isRefreshing={true}
          isRefreshingImages={false}
        />
      );

      // The first "Refreshing..." should be for metadata
      const refreshingItems = screen.getAllByText('Refreshing...');
      expect(refreshingItems.length).toBeGreaterThanOrEqual(1);
    });

    it('shows refreshing text when isRefreshingImages is true', () => {
      render(
        <CollectionOptionsMenu
          anchorEl={anchorEl}
          open={true}
          onClose={mockOnClose}
          onImagesClick={mockOnImagesClick}
          onRefreshMetadata={mockOnRefreshMetadata}
          onRefreshImages={mockOnRefreshImages}
          onDeleteClick={mockOnDeleteClick}
          canEdit={true}
          canIdentify={false}
          isRefreshing={false}
          isRefreshingImages={true}
        />
      );

      const refreshingItems = screen.getAllByText('Refreshing...');
      expect(refreshingItems.length).toBeGreaterThanOrEqual(1);
    });
  });
});
