/**
 * Tests for the API client
 */

// We need to test the actual apiClient, so we need to mock fetch
const mockFetch = jest.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

// Mock localStorage
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
  };
})();
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage });

// Import after mocks are set up
import { apiClient } from '../api/client';

describe('ApiClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalStorage.clear();
  });

  describe('login', () => {
    it('sends login request with credentials', async () => {
      const mockResponse = {
        token: 'test-token',
        user: { id: '1', name: 'testuser', role: 'Admin', groups: [], createdAt: '' },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await apiClient.login('testuser', 'password123');

      expect(mockFetch).toHaveBeenCalledWith('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'testuser', password: 'password123' }),
      });
      expect(result.data).toEqual(mockResponse);
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('token', 'test-token');
    });

    it('returns error on failed login', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Invalid credentials' }),
      });

      const result = await apiClient.login('testuser', 'wrongpassword');

      expect(result.error).toBe('Invalid credentials');
      expect(result.data).toBeUndefined();
    });

    it('handles network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await apiClient.login('testuser', 'password123');

      expect(result.error).toBe('Network error');
    });
  });

  describe('getCurrentUser', () => {
    it('sends request with auth token', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      const mockUser = { user: { id: '1', name: 'testuser', role: 'Admin', groups: [], createdAt: '' } };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockUser,
      });

      const result = await apiClient.getCurrentUser();

      expect(mockFetch).toHaveBeenCalledWith('/api/users/me', {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
      });
      expect(result.data).toEqual(mockUser);
    });
  });

  describe('getUsers', () => {
    it('fetches all users', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      const mockUsers = {
        users: [
          { id: '1', name: 'user1', role: 'Admin', groups: [], createdAt: '' },
          { id: '2', name: 'user2', role: 'Viewer', groups: [], createdAt: '' },
        ],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockUsers,
      });

      const result = await apiClient.getUsers();

      expect(mockFetch).toHaveBeenCalledWith('/api/users', expect.any(Object));
      expect(result.data).toEqual(mockUsers);
    });
  });

  describe('createUser', () => {
    it('sends create user request', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      const newUser = { name: 'newuser', password: 'password', role: 'Viewer' as const, groupIds: [] };
      const mockResponse = { user: { id: '3', ...newUser, groups: [], createdAt: '' } };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await apiClient.createUser(newUser);

      expect(mockFetch).toHaveBeenCalledWith('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify(newUser),
      });
      expect(result.data).toEqual(mockResponse);
    });
  });

  describe('updateUser', () => {
    it('sends patch request to update user', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      const updateData = { name: 'updatedname' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: { id: '1', name: 'updatedname', role: 'Admin', groups: [], createdAt: '' } }),
      });

      const result = await apiClient.updateUser('user-1', updateData);

      expect(mockFetch).toHaveBeenCalledWith('/api/users/user-1', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify(updateData),
      });
      expect(result.data).toBeDefined();
    });
  });

  describe('deleteUser', () => {
    it('sends delete request', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await apiClient.deleteUser('user-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/users/user-1', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
      });
    });
  });

  describe('clearToken', () => {
    it('removes token from localStorage', () => {
      apiClient.clearToken();

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('token');
    });
  });

  describe('hasToken', () => {
    it('returns true when token exists', () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');

      expect(apiClient.hasToken()).toBe(true);
    });

    it('returns false when token does not exist', () => {
      mockLocalStorage.getItem.mockReturnValue(null);

      expect(apiClient.hasToken()).toBe(false);
    });
  });

  describe('getVideoStreamUrl', () => {
    it('returns URL with token', () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');

      const url = apiClient.getVideoStreamUrl('media-1');

      expect(url).toBe('/api/stream/video/media-1?token=test-token');
    });

    it('includes start time when provided', () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');

      const url = apiClient.getVideoStreamUrl('media-1', 120);

      expect(url).toBe('/api/stream/video/media-1?token=test-token&start=120');
    });

    it('includes audio track when provided', () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');

      const url = apiClient.getVideoStreamUrl('media-1', 0, 2);

      expect(url).toBe('/api/stream/video/media-1?token=test-token&audioTrack=2');
    });
  });

  describe('getImageUrl', () => {
    it('returns URL with token', () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');

      const url = apiClient.getImageUrl('image-1');

      expect(url).toBe('/api/images/image-1/file?token=test-token');
    });
  });
});
