import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../SettingsPage';
import { apiClient } from '../../api/client';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
  },
}));

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

// Mock settings data
const mockSettings = {
  id: 'settings-1',
  instanceName: 'My Tubeca',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('SettingsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loading state', () => {
    it('shows loading spinner while fetching settings', () => {
      mockApiClient.getSettings.mockImplementation(() => new Promise(() => {}));

      render(<SettingsPage />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('hides loading spinner after settings load', async () => {
      mockApiClient.getSettings.mockResolvedValue({ data: { settings: mockSettings } });

      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });
  });

  describe('rendering', () => {
    beforeEach(() => {
      mockApiClient.getSettings.mockResolvedValue({ data: { settings: mockSettings } });
    });

    it('renders settings title', async () => {
      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument();
      });
    });

    it('renders general section', async () => {
      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByText(/general/i)).toBeInTheDocument();
      });
    });

    it('renders instance name field with loaded value', async () => {
      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByLabelText(/instance name/i)).toHaveValue('My Tubeca');
      });
    });

    it('renders helper text for instance name', async () => {
      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByText(/the name of this tubeca instance/i)).toBeInTheDocument();
      });
    });

    it('renders save button', async () => {
      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
      });
    });
  });

  describe('form interaction', () => {
    beforeEach(() => {
      mockApiClient.getSettings.mockResolvedValue({ data: { settings: mockSettings } });
    });

    it('allows changing instance name', async () => {
      const user = userEvent.setup();

      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByLabelText(/instance name/i)).toBeInTheDocument();
      });

      const input = screen.getByLabelText(/instance name/i);
      await user.clear(input);
      await user.type(input, 'New Instance Name');

      expect(input).toHaveValue('New Instance Name');
    });

    it('disables save button when value unchanged', async () => {
      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
      });
    });

    it('enables save button when value changed', async () => {
      const user = userEvent.setup();

      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByLabelText(/instance name/i)).toBeInTheDocument();
      });

      const input = screen.getByLabelText(/instance name/i);
      await user.clear(input);
      await user.type(input, 'Changed Name');

      expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
    });
  });

  describe('save flow', () => {
    beforeEach(() => {
      mockApiClient.getSettings.mockResolvedValue({ data: { settings: mockSettings } });
    });

    it('calls updateSettings on form submit', async () => {
      const user = userEvent.setup();
      mockApiClient.updateSettings.mockResolvedValue({
        data: { settings: { ...mockSettings, instanceName: 'Updated Name' } },
      });

      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByLabelText(/instance name/i)).toBeInTheDocument();
      });

      const input = screen.getByLabelText(/instance name/i);
      await user.clear(input);
      await user.type(input, 'Updated Name');
      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(mockApiClient.updateSettings).toHaveBeenCalledWith({ instanceName: 'Updated Name' });
    });

    it('shows success message on successful save', async () => {
      const user = userEvent.setup();
      mockApiClient.updateSettings.mockResolvedValue({
        data: { settings: { ...mockSettings, instanceName: 'Updated Name' } },
      });

      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByLabelText(/instance name/i)).toBeInTheDocument();
      });

      const input = screen.getByLabelText(/instance name/i);
      await user.clear(input);
      await user.type(input, 'Updated Name');
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(screen.getByText(/settings saved successfully/i)).toBeInTheDocument();
      });
    });

    it('shows error message on failed save', async () => {
      const user = userEvent.setup();
      mockApiClient.updateSettings.mockResolvedValue({ error: 'Failed to save settings' });

      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByLabelText(/instance name/i)).toBeInTheDocument();
      });

      const input = screen.getByLabelText(/instance name/i);
      await user.clear(input);
      await user.type(input, 'Updated Name');
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(screen.getByText('Failed to save settings')).toBeInTheDocument();
      });
    });

    it('shows loading spinner in button while saving', async () => {
      const user = userEvent.setup();
      mockApiClient.updateSettings.mockImplementation(() => new Promise(() => {}));

      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByLabelText(/instance name/i)).toBeInTheDocument();
      });

      const input = screen.getByLabelText(/instance name/i);
      await user.clear(input);
      await user.type(input, 'Updated Name');
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
      });
    });

    it('disables save button while saving', async () => {
      const user = userEvent.setup();
      mockApiClient.updateSettings.mockImplementation(() => new Promise(() => {}));

      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByLabelText(/instance name/i)).toBeInTheDocument();
      });

      const input = screen.getByLabelText(/instance name/i);
      await user.clear(input);
      await user.type(input, 'Updated Name');
      await user.click(screen.getByRole('button'));

      await waitFor(() => {
        expect(screen.getByRole('button')).toBeDisabled();
      });
    });

    it('clears error on new submit', async () => {
      const user = userEvent.setup();
      mockApiClient.updateSettings
        .mockResolvedValueOnce({ error: 'First error' })
        .mockResolvedValueOnce({ data: { settings: { ...mockSettings, instanceName: 'Updated Name' } } });

      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByLabelText(/instance name/i)).toBeInTheDocument();
      });

      // First save - fails
      const input = screen.getByLabelText(/instance name/i);
      await user.clear(input);
      await user.type(input, 'Updated Name');
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(screen.getByText('First error')).toBeInTheDocument();
      });

      // Second save - succeeds (need to change value again since it matched after first save)
      await user.clear(input);
      await user.type(input, 'Another Name');
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(screen.queryByText('First error')).not.toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows error when initial load fails', async () => {
      mockApiClient.getSettings.mockResolvedValue({ error: 'Failed to load settings' });

      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load settings')).toBeInTheDocument();
      });
    });
  });
});
