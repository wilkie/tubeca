import { ReactElement, ReactNode } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';

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

// Provider wrapper for tests
function AllTheProviders({ children }: WrapperProps) {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={theme}>
        <MemoryRouter>
          {children}
        </MemoryRouter>
      </ThemeProvider>
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
