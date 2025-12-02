import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ActiveLibraryProvider, useActiveLibrary } from '../ActiveLibraryContext';
import { apiClient } from '../../api/client';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    getCollection: jest.fn(),
    getMedia: jest.fn(),
  },
}));

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

// Test component that displays the active library context values
function TestConsumer() {
  const { activeLibraryId, setActiveLibrary } = useActiveLibrary();
  return (
    <div>
      <span data-testid="active-library-id">{activeLibraryId ?? 'null'}</span>
      <button onClick={() => setActiveLibrary('manual-lib-id')}>Set Library</button>
    </div>
  );
}

describe('ActiveLibraryContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('useActiveLibrary hook', () => {
    it('throws error when used outside provider', () => {
      // Suppress console.error for this test since we expect an error
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<TestConsumer />);
      }).toThrow('useActiveLibrary must be used within an ActiveLibraryProvider');

      consoleSpy.mockRestore();
    });
  });

  describe('library routes', () => {
    it('returns library ID directly from /library/:id URL', () => {
      render(
        <MemoryRouter initialEntries={['/library/lib-123']}>
          <ActiveLibraryProvider>
            <TestConsumer />
          </ActiveLibraryProvider>
        </MemoryRouter>
      );

      expect(screen.getByTestId('active-library-id')).toHaveTextContent('lib-123');
    });

    it('handles nested library paths', () => {
      render(
        <MemoryRouter initialEntries={['/library/lib-456/some/nested/path']}>
          <ActiveLibraryProvider>
            <TestConsumer />
          </ActiveLibraryProvider>
        </MemoryRouter>
      );

      expect(screen.getByTestId('active-library-id')).toHaveTextContent('lib-456');
    });
  });

  describe('collection routes', () => {
    it('fetches library ID for /collection/:id routes', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockApiClient.getCollection.mockResolvedValue({
        data: {
          collection: {
            id: 'col-123',
            name: 'Test Collection',
            library: { id: 'fetched-lib-id' },
          },
        },
      } as any);

      render(
        <MemoryRouter initialEntries={['/collection/col-123']}>
          <ActiveLibraryProvider>
            <TestConsumer />
          </ActiveLibraryProvider>
        </MemoryRouter>
      );

      // Initially null while fetching
      expect(screen.getByTestId('active-library-id')).toHaveTextContent('null');

      // After fetch completes
      await waitFor(() => {
        expect(screen.getByTestId('active-library-id')).toHaveTextContent('fetched-lib-id');
      });

      expect(mockApiClient.getCollection).toHaveBeenCalledWith('col-123');
    });

    it('handles missing library in collection response', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockApiClient.getCollection.mockResolvedValue({
        data: {
          collection: {
            id: 'col-123',
            name: 'Test Collection',
            // No library field
          },
        },
      } as any);

      render(
        <MemoryRouter initialEntries={['/collection/col-123']}>
          <ActiveLibraryProvider>
            <TestConsumer />
          </ActiveLibraryProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockApiClient.getCollection).toHaveBeenCalled();
      });

      // Should remain null since no library was returned
      expect(screen.getByTestId('active-library-id')).toHaveTextContent('null');
    });
  });

  describe('media routes', () => {
    it('fetches library ID for /media/:id routes', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockApiClient.getMedia.mockResolvedValue({
        data: {
          media: {
            id: 'media-123',
            collection: {
              library: { id: 'media-lib-id' },
            },
          },
        },
      } as any);

      render(
        <MemoryRouter initialEntries={['/media/media-123']}>
          <ActiveLibraryProvider>
            <TestConsumer />
          </ActiveLibraryProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('active-library-id')).toHaveTextContent('media-lib-id');
      });

      expect(mockApiClient.getMedia).toHaveBeenCalledWith('media-123');
    });
  });

  describe('non-matching routes', () => {
    it('returns null for root path', () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <ActiveLibraryProvider>
            <TestConsumer />
          </ActiveLibraryProvider>
        </MemoryRouter>
      );

      expect(screen.getByTestId('active-library-id')).toHaveTextContent('null');
    });

    it('returns null for settings path', () => {
      render(
        <MemoryRouter initialEntries={['/settings']}>
          <ActiveLibraryProvider>
            <TestConsumer />
          </ActiveLibraryProvider>
        </MemoryRouter>
      );

      expect(screen.getByTestId('active-library-id')).toHaveTextContent('null');
    });

    it('returns null for users path', () => {
      render(
        <MemoryRouter initialEntries={['/users']}>
          <ActiveLibraryProvider>
            <TestConsumer />
          </ActiveLibraryProvider>
        </MemoryRouter>
      );

      expect(screen.getByTestId('active-library-id')).toHaveTextContent('null');
    });
  });

  describe('setActiveLibrary', () => {
    it('allows manually setting the active library on collection routes', async () => {
      const user = userEvent.setup();

      // Start with a collection route where fetched library ID would apply
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockApiClient.getCollection.mockResolvedValue({
        data: {
          collection: {
            id: 'col-123',
            name: 'Test Collection',
            library: { id: 'original-lib-id' },
          },
        },
      } as any);

      render(
        <MemoryRouter initialEntries={['/collection/col-123']}>
          <ActiveLibraryProvider>
            <TestConsumer />
          </ActiveLibraryProvider>
        </MemoryRouter>
      );

      // Wait for the initial fetch
      await waitFor(() => {
        expect(screen.getByTestId('active-library-id')).toHaveTextContent('original-lib-id');
      });

      // Click button to set library manually
      await user.click(screen.getByRole('button', { name: /set library/i }));

      // Should now have the manually set ID
      expect(screen.getByTestId('active-library-id')).toHaveTextContent('manual-lib-id');
    });
  });
});
