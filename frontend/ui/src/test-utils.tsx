import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { ScrollRestorationProvider } from './context/ScrollRestorationContext';
import { I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from './i18n';

// Create a test theme
const theme = createTheme({
  palette: {
    mode: 'dark',
  },
});

interface WrapperProps {
  children: ReactNode;
}

// Mock AuthContext for testing
interface MockAuthContextValue {
  user: { id: string; name: string; role: 'Admin' | 'Editor' | 'Viewer'; groups: { id: string; name: string }[]; createdAt: string } | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  needsSetup: boolean;
  login: jest.Mock;
  setup: jest.Mock;
  logout: jest.Mock;
}

export const createMockAuthContext = (overrides: Partial<MockAuthContextValue> = {}): MockAuthContextValue => ({
  user: null,
  isLoading: false,
  isAuthenticated: false,
  needsSetup: false,
  login: jest.fn(),
  setup: jest.fn(),
  logout: jest.fn(),
  ...overrides,
});

export const mockAdminUser = {
  id: 'user-1',
  name: 'admin',
  role: 'Admin' as const,
  groups: [],
  createdAt: '2024-01-01T00:00:00Z',
};

export const mockViewerUser = {
  id: 'user-2',
  name: 'viewer',
  role: 'Viewer' as const,
  groups: [{ id: 'group-1', name: 'Test Group' }],
  createdAt: '2024-01-01T00:00:00Z',
};

// Provider wrapper for tests. Each render gets its own query cache so one
// test's data never leaks into the next, and failures surface immediately
// instead of being retried.
function AllTheProviders({ children }: WrapperProps) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });

  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <MemoryRouter>
            <ScrollRestorationProvider>
              {children}
            </ScrollRestorationProvider>
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

// Custom render function
const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, { wrapper: AllTheProviders, ...options });

// Re-export everything
export * from '@testing-library/react';
export { customRender as render };
