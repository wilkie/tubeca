import { render, screen, waitFor, within } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { KeywordFilter } from '../KeywordFilter';
import type { Keyword } from '../../api/client';

const mockKeywords: Keyword[] = [
  { id: 'kw-1', name: 'Action' },
  { id: 'kw-2', name: 'Comedy' },
  { id: 'kw-3', name: 'Drama' },
  { id: 'kw-4', name: 'Sci-Fi' },
  { id: 'kw-5', name: 'Thriller' },
];

describe('KeywordFilter', () => {
  const mockOnSelectionChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rendering', () => {
    it('returns null when keywords array is empty', () => {
      const { container } = render(
        <KeywordFilter
          keywords={[]}
          selectedKeywords={[]}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    it('renders when keywords are provided', () => {
      render(
        <KeywordFilter
          keywords={mockKeywords}
          selectedKeywords={[]}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      expect(screen.getByText(/tags/i)).toBeInTheDocument();
    });

    it('shows the autocomplete input', () => {
      render(
        <KeywordFilter
          keywords={mockKeywords}
          selectedKeywords={[]}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('shows placeholder when no keywords selected', () => {
      render(
        <KeywordFilter
          keywords={mockKeywords}
          selectedKeywords={[]}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      expect(screen.getByPlaceholderText(/search tags/i)).toBeInTheDocument();
    });

    it('does not show placeholder when keywords are selected', () => {
      render(
        <KeywordFilter
          keywords={mockKeywords}
          selectedKeywords={[mockKeywords[0]]}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      expect(screen.queryByPlaceholderText(/search tags/i)).not.toBeInTheDocument();
    });
  });

  describe('selected keywords display', () => {
    it('displays selected keywords as chips', () => {
      render(
        <KeywordFilter
          keywords={mockKeywords}
          selectedKeywords={[mockKeywords[0], mockKeywords[1]]}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      expect(screen.getByText('Action')).toBeInTheDocument();
      expect(screen.getByText('Comedy')).toBeInTheDocument();
    });

    it('shows clear button when keywords are selected', () => {
      render(
        <KeywordFilter
          keywords={mockKeywords}
          selectedKeywords={[mockKeywords[0]]}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      expect(screen.getByText(/clear/i)).toBeInTheDocument();
    });

    it('does not show clear button when no keywords are selected', () => {
      render(
        <KeywordFilter
          keywords={mockKeywords}
          selectedKeywords={[]}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      expect(screen.queryByText(/clear/i)).not.toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('opens dropdown when clicked', async () => {
      const user = userEvent.setup();

      render(
        <KeywordFilter
          keywords={mockKeywords}
          selectedKeywords={[]}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      await user.click(screen.getByRole('combobox'));

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });
    });

    it('shows all keywords in dropdown', async () => {
      const user = userEvent.setup();

      render(
        <KeywordFilter
          keywords={mockKeywords}
          selectedKeywords={[]}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      await user.click(screen.getByRole('combobox'));

      await waitFor(() => {
        const listbox = screen.getByRole('listbox');
        expect(within(listbox).getByText('Action')).toBeInTheDocument();
        expect(within(listbox).getByText('Comedy')).toBeInTheDocument();
        expect(within(listbox).getByText('Drama')).toBeInTheDocument();
        expect(within(listbox).getByText('Sci-Fi')).toBeInTheDocument();
        expect(within(listbox).getByText('Thriller')).toBeInTheDocument();
      });
    });

    it('calls onSelectionChange when a keyword is selected', async () => {
      const user = userEvent.setup();

      render(
        <KeywordFilter
          keywords={mockKeywords}
          selectedKeywords={[]}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      await user.click(screen.getByRole('combobox'));

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      await user.click(within(screen.getByRole('listbox')).getByText('Action'));

      expect(mockOnSelectionChange).toHaveBeenCalledWith([mockKeywords[0]]);
    });

    it('filters options based on input', async () => {
      const user = userEvent.setup();

      render(
        <KeywordFilter
          keywords={mockKeywords}
          selectedKeywords={[]}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      const input = screen.getByRole('combobox');
      await user.type(input, 'dra');

      await waitFor(() => {
        const listbox = screen.getByRole('listbox');
        expect(within(listbox).getByText('Drama')).toBeInTheDocument();
        expect(within(listbox).queryByText('Action')).not.toBeInTheDocument();
        expect(within(listbox).queryByText('Comedy')).not.toBeInTheDocument();
      });
    });

    it('clears all keywords when clear button clicked', async () => {
      const user = userEvent.setup();

      render(
        <KeywordFilter
          keywords={mockKeywords}
          selectedKeywords={[mockKeywords[0], mockKeywords[1]]}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      await user.click(screen.getByText(/clear/i));

      expect(mockOnSelectionChange).toHaveBeenCalledWith([]);
    });

    it('removes individual keyword when chip delete is clicked', async () => {
      const user = userEvent.setup();

      render(
        <KeywordFilter
          keywords={mockKeywords}
          selectedKeywords={[mockKeywords[0], mockKeywords[1]]}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      // Find the delete button on the Action chip
      const actionChip = screen.getByText('Action').closest('.MuiChip-root');
      const deleteButton = within(actionChip as HTMLElement).getByTestId('CancelIcon');

      await user.click(deleteButton);

      expect(mockOnSelectionChange).toHaveBeenCalledWith([mockKeywords[1]]);
    });
  });

  describe('case-insensitive filtering', () => {
    it('filters case-insensitively', async () => {
      const user = userEvent.setup();

      render(
        <KeywordFilter
          keywords={mockKeywords}
          selectedKeywords={[]}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      const input = screen.getByRole('combobox');
      await user.type(input, 'SCI');

      await waitFor(() => {
        const listbox = screen.getByRole('listbox');
        expect(within(listbox).getByText('Sci-Fi')).toBeInTheDocument();
      });
    });
  });

  describe('no options message', () => {
    it('shows no options text when filter matches nothing', async () => {
      const user = userEvent.setup();

      render(
        <KeywordFilter
          keywords={mockKeywords}
          selectedKeywords={[]}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      const input = screen.getByRole('combobox');
      await user.type(input, 'xyz');

      await waitFor(() => {
        expect(screen.getByText(/no tags found/i)).toBeInTheDocument();
      });
    });
  });
});
