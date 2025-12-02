import { render, screen } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { DeleteCollectionDialog } from '../DeleteCollectionDialog';

describe('DeleteCollectionDialog', () => {
  const mockOnCancel = jest.fn();
  const mockOnConfirm = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('when closed', () => {
    it('does not render when open is false', () => {
      render(
        <DeleteCollectionDialog
          open={false}
          collectionName="Test Collection"
          isDeleting={false}
          onCancel={mockOnCancel}
          onConfirm={mockOnConfirm}
        />
      );

      expect(screen.queryByText('Delete Collection?')).not.toBeInTheDocument();
    });
  });

  describe('when open', () => {
    it('renders dialog title', () => {
      render(
        <DeleteCollectionDialog
          open={true}
          collectionName="Test Collection"
          isDeleting={false}
          onCancel={mockOnCancel}
          onConfirm={mockOnConfirm}
        />
      );

      expect(screen.getByText('Delete Collection?')).toBeInTheDocument();
    });

    it('renders collection name in confirmation message', () => {
      render(
        <DeleteCollectionDialog
          open={true}
          collectionName="My Movie"
          isDeleting={false}
          onCancel={mockOnCancel}
          onConfirm={mockOnConfirm}
        />
      );

      expect(screen.getByText(/My Movie/)).toBeInTheDocument();
    });

    it('renders cancel button', () => {
      render(
        <DeleteCollectionDialog
          open={true}
          collectionName="Test Collection"
          isDeleting={false}
          onCancel={mockOnCancel}
          onConfirm={mockOnConfirm}
        />
      );

      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('renders delete button', () => {
      render(
        <DeleteCollectionDialog
          open={true}
          collectionName="Test Collection"
          isDeleting={false}
          onCancel={mockOnCancel}
          onConfirm={mockOnConfirm}
        />
      );

      expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls onCancel when cancel button clicked', async () => {
      const user = userEvent.setup();

      render(
        <DeleteCollectionDialog
          open={true}
          collectionName="Test Collection"
          isDeleting={false}
          onCancel={mockOnCancel}
          onConfirm={mockOnConfirm}
        />
      );

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      expect(mockOnCancel).toHaveBeenCalled();
    });

    it('calls onConfirm when delete button clicked', async () => {
      const user = userEvent.setup();

      render(
        <DeleteCollectionDialog
          open={true}
          collectionName="Test Collection"
          isDeleting={false}
          onCancel={mockOnCancel}
          onConfirm={mockOnConfirm}
        />
      );

      await user.click(screen.getByRole('button', { name: /^delete$/i }));

      expect(mockOnConfirm).toHaveBeenCalled();
    });
  });

  describe('deleting state', () => {
    it('shows deleting text when isDeleting is true', () => {
      render(
        <DeleteCollectionDialog
          open={true}
          collectionName="Test Collection"
          isDeleting={true}
          onCancel={mockOnCancel}
          onConfirm={mockOnConfirm}
        />
      );

      expect(screen.getByRole('button', { name: /deleting/i })).toBeInTheDocument();
    });

    it('disables cancel button when deleting', () => {
      render(
        <DeleteCollectionDialog
          open={true}
          collectionName="Test Collection"
          isDeleting={true}
          onCancel={mockOnCancel}
          onConfirm={mockOnConfirm}
        />
      );

      expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
    });

    it('disables delete button when deleting', () => {
      render(
        <DeleteCollectionDialog
          open={true}
          collectionName="Test Collection"
          isDeleting={true}
          onCancel={mockOnCancel}
          onConfirm={mockOnConfirm}
        />
      );

      expect(screen.getByRole('button', { name: /deleting/i })).toBeDisabled();
    });
  });
});
