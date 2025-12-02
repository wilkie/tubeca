import { render, screen } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { CollectionBreadcrumbs, type BreadcrumbItem } from '../CollectionBreadcrumbs';

const mockBreadcrumbs: BreadcrumbItem[] = [
  { id: 'lib-1', name: 'Movies', type: 'library' },
  { id: 'col-1', name: 'The Matrix Collection', type: 'collection' },
];

describe('CollectionBreadcrumbs', () => {
  const mockOnNavigate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders breadcrumb items', () => {
      render(
        <CollectionBreadcrumbs
          breadcrumbs={mockBreadcrumbs}
          currentName="The Matrix"
          onNavigate={mockOnNavigate}
        />
      );

      expect(screen.getByText('Movies')).toBeInTheDocument();
      expect(screen.getByText('The Matrix Collection')).toBeInTheDocument();
    });

    it('renders current name', () => {
      render(
        <CollectionBreadcrumbs
          breadcrumbs={mockBreadcrumbs}
          currentName="The Matrix"
          onNavigate={mockOnNavigate}
        />
      );

      expect(screen.getByText('The Matrix')).toBeInTheDocument();
    });

    it('renders empty breadcrumbs with just current name', () => {
      render(
        <CollectionBreadcrumbs
          breadcrumbs={[]}
          currentName="Standalone Item"
          onNavigate={mockOnNavigate}
        />
      );

      expect(screen.getByText('Standalone Item')).toBeInTheDocument();
    });
  });

  describe('navigation', () => {
    it('calls onNavigate when library breadcrumb clicked', async () => {
      const user = userEvent.setup();

      render(
        <CollectionBreadcrumbs
          breadcrumbs={mockBreadcrumbs}
          currentName="The Matrix"
          onNavigate={mockOnNavigate}
        />
      );

      await user.click(screen.getByText('Movies'));

      expect(mockOnNavigate).toHaveBeenCalledWith({
        id: 'lib-1',
        name: 'Movies',
        type: 'library',
      });
    });

    it('calls onNavigate when collection breadcrumb clicked', async () => {
      const user = userEvent.setup();

      render(
        <CollectionBreadcrumbs
          breadcrumbs={mockBreadcrumbs}
          currentName="The Matrix"
          onNavigate={mockOnNavigate}
        />
      );

      await user.click(screen.getByText('The Matrix Collection'));

      expect(mockOnNavigate).toHaveBeenCalledWith({
        id: 'col-1',
        name: 'The Matrix Collection',
        type: 'collection',
      });
    });

    it('does not call onNavigate when current name clicked', async () => {
      const user = userEvent.setup();

      render(
        <CollectionBreadcrumbs
          breadcrumbs={mockBreadcrumbs}
          currentName="The Matrix"
          onNavigate={mockOnNavigate}
        />
      );

      await user.click(screen.getByText('The Matrix'));

      expect(mockOnNavigate).not.toHaveBeenCalled();
    });
  });

  describe('variants', () => {
    it('renders default variant', () => {
      render(
        <CollectionBreadcrumbs
          breadcrumbs={mockBreadcrumbs}
          currentName="The Matrix"
          onNavigate={mockOnNavigate}
          variant="default"
        />
      );

      expect(screen.getByText('Movies')).toBeInTheDocument();
    });

    it('renders hero variant', () => {
      render(
        <CollectionBreadcrumbs
          breadcrumbs={mockBreadcrumbs}
          currentName="The Matrix"
          onNavigate={mockOnNavigate}
          variant="hero"
        />
      );

      expect(screen.getByText('Movies')).toBeInTheDocument();
    });
  });
});
