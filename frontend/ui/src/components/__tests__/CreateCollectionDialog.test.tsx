import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { CreateCollectionDialog } from '../CreateCollectionDialog';

describe('CreateCollectionDialog', () => {
  const mockOnClose = jest.fn();
  const mockOnCreate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('when closed', () => {
    it('does not render dialog content when open is false', () => {
      render(
        <CreateCollectionDialog
          open={false}
          onClose={mockOnClose}
          onCreate={mockOnCreate}
        />
      );

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('when open', () => {
    it('renders the dialog', () => {
      render(
        <CreateCollectionDialog
          open={true}
          onClose={mockOnClose}
          onCreate={mockOnCreate}
        />
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('shows the dialog title', () => {
      render(
        <CreateCollectionDialog
          open={true}
          onClose={mockOnClose}
          onCreate={mockOnCreate}
        />
      );

      expect(screen.getByRole('heading')).toBeInTheDocument();
    });

    it('shows name input field', () => {
      render(
        <CreateCollectionDialog
          open={true}
          onClose={mockOnClose}
          onCreate={mockOnCreate}
        />
      );

      expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    });

    it('shows description input field', () => {
      render(
        <CreateCollectionDialog
          open={true}
          onClose={mockOnClose}
          onCreate={mockOnCreate}
        />
      );

      expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    });

    it('shows public/private toggle', () => {
      render(
        <CreateCollectionDialog
          open={true}
          onClose={mockOnClose}
          onCreate={mockOnCreate}
        />
      );

      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    it('shows cancel and create buttons', () => {
      render(
        <CreateCollectionDialog
          open={true}
          onClose={mockOnClose}
          onCreate={mockOnCreate}
        />
      );

      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
    });
  });

  describe('form interactions', () => {
    it('allows typing in name field', async () => {
      const user = userEvent.setup();

      render(
        <CreateCollectionDialog
          open={true}
          onClose={mockOnClose}
          onCreate={mockOnCreate}
        />
      );

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'My Collection');

      expect(nameInput).toHaveValue('My Collection');
    });

    it('allows typing in description field', async () => {
      const user = userEvent.setup();

      render(
        <CreateCollectionDialog
          open={true}
          onClose={mockOnClose}
          onCreate={mockOnCreate}
        />
      );

      const descInput = screen.getByLabelText(/description/i);
      await user.type(descInput, 'A great collection');

      expect(descInput).toHaveValue('A great collection');
    });

    it('toggles public/private switch', async () => {
      const user = userEvent.setup();

      render(
        <CreateCollectionDialog
          open={true}
          onClose={mockOnClose}
          onCreate={mockOnCreate}
        />
      );

      const toggle = screen.getByRole('switch');
      expect(toggle).not.toBeChecked();

      await user.click(toggle);

      expect(toggle).toBeChecked();
    });
  });

  describe('form submission', () => {
    it('calls onCreate with form data when submitted', async () => {
      const user = userEvent.setup();

      render(
        <CreateCollectionDialog
          open={true}
          onClose={mockOnClose}
          onCreate={mockOnCreate}
        />
      );

      await user.type(screen.getByLabelText(/name/i), 'My Collection');
      await user.type(screen.getByLabelText(/description/i), 'A description');
      await user.click(screen.getByRole('switch'));
      await user.click(screen.getByRole('button', { name: /create/i }));

      expect(mockOnCreate).toHaveBeenCalledWith('My Collection', 'A description', true);
    });

    it('trims whitespace from name and description', async () => {
      const user = userEvent.setup();

      render(
        <CreateCollectionDialog
          open={true}
          onClose={mockOnClose}
          onCreate={mockOnCreate}
        />
      );

      await user.type(screen.getByLabelText(/name/i), '  My Collection  ');
      await user.type(screen.getByLabelText(/description/i), '  A description  ');
      await user.click(screen.getByRole('button', { name: /create/i }));

      expect(mockOnCreate).toHaveBeenCalledWith('My Collection', 'A description', false);
    });

    it('calls onClose after successful creation', async () => {
      const user = userEvent.setup();

      render(
        <CreateCollectionDialog
          open={true}
          onClose={mockOnClose}
          onCreate={mockOnCreate}
        />
      );

      await user.type(screen.getByLabelText(/name/i), 'My Collection');
      await user.click(screen.getByRole('button', { name: /create/i }));

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('validation', () => {
    it('shows error when name is empty', async () => {
      const user = userEvent.setup();

      render(
        <CreateCollectionDialog
          open={true}
          onClose={mockOnClose}
          onCreate={mockOnCreate}
        />
      );

      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        // Error should be shown (helper text on the name field)
        const nameInput = screen.getByLabelText(/name/i);
        expect(nameInput).toHaveAttribute('aria-invalid', 'true');
      });

      expect(mockOnCreate).not.toHaveBeenCalled();
    });

    it('shows error when name is only whitespace', async () => {
      const user = userEvent.setup();

      render(
        <CreateCollectionDialog
          open={true}
          onClose={mockOnClose}
          onCreate={mockOnCreate}
        />
      );

      await user.type(screen.getByLabelText(/name/i), '   ');
      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        const nameInput = screen.getByLabelText(/name/i);
        expect(nameInput).toHaveAttribute('aria-invalid', 'true');
      });

      expect(mockOnCreate).not.toHaveBeenCalled();
    });

    it('clears error when user types in name field', async () => {
      const user = userEvent.setup();

      render(
        <CreateCollectionDialog
          open={true}
          onClose={mockOnClose}
          onCreate={mockOnCreate}
        />
      );

      // Trigger error
      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toHaveAttribute('aria-invalid', 'true');
      });

      // Start typing to clear error
      await user.type(screen.getByLabelText(/name/i), 'Test');

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toHaveAttribute('aria-invalid', 'false');
      });
    });
  });

  describe('cancel button', () => {
    it('calls onClose when cancel is clicked', async () => {
      const user = userEvent.setup();

      render(
        <CreateCollectionDialog
          open={true}
          onClose={mockOnClose}
          onCreate={mockOnCreate}
        />
      );

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('clears form fields when cancelled', async () => {
      const user = userEvent.setup();

      const { rerender } = render(
        <CreateCollectionDialog
          open={true}
          onClose={mockOnClose}
          onCreate={mockOnCreate}
        />
      );

      // Fill in form
      await user.type(screen.getByLabelText(/name/i), 'My Collection');
      await user.type(screen.getByLabelText(/description/i), 'Description');
      await user.click(screen.getByRole('switch'));

      // Cancel
      await user.click(screen.getByRole('button', { name: /cancel/i }));

      // Reopen
      rerender(
        <CreateCollectionDialog
          open={true}
          onClose={mockOnClose}
          onCreate={mockOnCreate}
        />
      );

      // Fields should be cleared
      expect(screen.getByLabelText(/name/i)).toHaveValue('');
      expect(screen.getByLabelText(/description/i)).toHaveValue('');
      expect(screen.getByRole('switch')).not.toBeChecked();
    });
  });

  describe('public/private label', () => {
    it('shows private label when toggle is off', () => {
      render(
        <CreateCollectionDialog
          open={true}
          onClose={mockOnClose}
          onCreate={mockOnCreate}
        />
      );

      expect(screen.getByText(/private/i)).toBeInTheDocument();
    });

    it('shows public label when toggle is on', async () => {
      const user = userEvent.setup();

      render(
        <CreateCollectionDialog
          open={true}
          onClose={mockOnClose}
          onCreate={mockOnCreate}
        />
      );

      await user.click(screen.getByRole('switch'));

      expect(screen.getByText(/public/i)).toBeInTheDocument();
    });
  });
});
