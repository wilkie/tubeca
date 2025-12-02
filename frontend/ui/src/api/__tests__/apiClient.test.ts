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
import { apiClient } from '../client';

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

  describe('getAudioStreamUrl', () => {
    it('returns URL with token', () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');

      const url = apiClient.getAudioStreamUrl('media-1');

      expect(url).toBe('/api/stream/audio/media-1?token=test-token');
    });
  });

  describe('getSubtitleUrl', () => {
    it('returns URL with token and stream index', () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');

      const url = apiClient.getSubtitleUrl('media-1', 2);

      expect(url).toBe('/api/stream/subtitles/media-1?token=test-token&streamIndex=2');
    });
  });

  describe('updateUserRole', () => {
    it('sends patch request to update user role', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: { id: '1', name: 'user', role: 'Editor', groups: [], createdAt: '' } }),
      });

      const result = await apiClient.updateUserRole('user-1', 'Editor');

      expect(mockFetch).toHaveBeenCalledWith('/api/users/user-1/role', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({ role: 'Editor' }),
      });
      expect(result.data).toBeDefined();
    });
  });

  describe('updateUserGroups', () => {
    it('sends patch request to update user groups', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: { id: '1', name: 'user', role: 'Viewer', groups: [], createdAt: '' } }),
      });

      const result = await apiClient.updateUserGroups('user-1', ['group-1', 'group-2']);

      expect(mockFetch).toHaveBeenCalledWith('/api/users/user-1/groups', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({ groupIds: ['group-1', 'group-2'] }),
      });
      expect(result.data).toBeDefined();
    });
  });

  describe('Group management', () => {
    it('getGroups fetches all groups', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      const mockGroups = { groups: [{ id: '1', name: 'Group 1' }] };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGroups,
      });

      const result = await apiClient.getGroups();

      expect(mockFetch).toHaveBeenCalledWith('/api/groups', expect.any(Object));
      expect(result.data).toEqual(mockGroups);
    });

    it('createGroup sends create request', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ group: { id: '1', name: 'New Group' } }),
      });

      const result = await apiClient.createGroup({ name: 'New Group' });

      expect(mockFetch).toHaveBeenCalledWith('/api/groups', {
        method: 'POST',
        headers: expect.any(Object),
        body: JSON.stringify({ name: 'New Group' }),
      });
      expect(result.data).toBeDefined();
    });

    it('updateGroup sends patch request', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ group: { id: '1', name: 'Updated Group' } }),
      });

      const result = await apiClient.updateGroup('group-1', { name: 'Updated Group' });

      expect(mockFetch).toHaveBeenCalledWith('/api/groups/group-1', {
        method: 'PATCH',
        headers: expect.any(Object),
        body: JSON.stringify({ name: 'Updated Group' }),
      });
      expect(result.data).toBeDefined();
    });

    it('deleteGroup sends delete request', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await apiClient.deleteGroup('group-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/groups/group-1', {
        method: 'DELETE',
        headers: expect.any(Object),
      });
    });
  });

  describe('Setup and Settings', () => {
    it('checkSetup fetches setup status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ needsSetup: true }),
      });

      const result = await apiClient.checkSetup();

      expect(mockFetch).toHaveBeenCalledWith('/api/auth/setup', expect.any(Object));
      expect(result.data).toEqual({ needsSetup: true });
    });

    it('setup sends setup request and stores token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'new-token', user: { id: '1', name: 'admin', role: 'Admin' } }),
      });

      const result = await apiClient.setup('admin', 'password123');

      expect(mockFetch).toHaveBeenCalledWith('/api/auth/setup', {
        method: 'POST',
        headers: expect.any(Object),
        body: JSON.stringify({ name: 'admin', password: 'password123' }),
      });
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('token', 'new-token');
      expect(result.data).toBeDefined();
    });

    it('getSettings fetches settings', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ settings: { instanceName: 'My Server' } }),
      });

      const result = await apiClient.getSettings();

      expect(mockFetch).toHaveBeenCalledWith('/api/settings', expect.any(Object));
      expect(result.data).toBeDefined();
    });

    it('updateSettings sends patch request', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ settings: { instanceName: 'Updated Server' } }),
      });

      const result = await apiClient.updateSettings({ instanceName: 'Updated Server' });

      expect(mockFetch).toHaveBeenCalledWith('/api/settings', {
        method: 'PATCH',
        headers: expect.any(Object),
        body: JSON.stringify({ instanceName: 'Updated Server' }),
      });
      expect(result.data).toBeDefined();
    });
  });

  describe('Library management', () => {
    it('getLibraries fetches all libraries', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ libraries: [] }),
      });

      const result = await apiClient.getLibraries();

      expect(mockFetch).toHaveBeenCalledWith('/api/libraries', expect.any(Object));
      expect(result.data).toBeDefined();
    });

    it('getLibrary fetches a single library', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ library: { id: 'lib-1', name: 'Movies' } }),
      });

      const result = await apiClient.getLibrary('lib-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/libraries/lib-1', expect.any(Object));
      expect(result.data).toBeDefined();
    });

    it('createLibrary sends create request', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ library: { id: 'lib-1', name: 'Movies' } }),
      });

      const result = await apiClient.createLibrary({
        name: 'Movies',
        path: '/media/movies',
        libraryType: 'Film',
        watchForChanges: false,
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/libraries', {
        method: 'POST',
        headers: expect.any(Object),
        body: expect.any(String),
      });
      expect(result.data).toBeDefined();
    });

    it('updateLibrary sends patch request', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ library: { id: 'lib-1', name: 'Updated Movies' } }),
      });

      const result = await apiClient.updateLibrary('lib-1', { name: 'Updated Movies' });

      expect(mockFetch).toHaveBeenCalledWith('/api/libraries/lib-1', {
        method: 'PATCH',
        headers: expect.any(Object),
        body: JSON.stringify({ name: 'Updated Movies' }),
      });
      expect(result.data).toBeDefined();
    });

    it('deleteLibrary sends delete request', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await apiClient.deleteLibrary('lib-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/libraries/lib-1', {
        method: 'DELETE',
        headers: expect.any(Object),
      });
    });
  });

  describe('Library scan', () => {
    it('startLibraryScan sends POST request', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Scan started', jobId: 'job-1' }),
      });

      const result = await apiClient.startLibraryScan('lib-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/libraries/lib-1/scan', {
        method: 'POST',
        headers: expect.any(Object),
      });
      expect(result.data).toBeDefined();
    });

    it('getLibraryScanStatus fetches scan status', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'running', progress: 50 }),
      });

      const result = await apiClient.getLibraryScanStatus('lib-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/libraries/lib-1/scan', expect.any(Object));
      expect(result.data).toBeDefined();
    });

    it('cancelLibraryScan sends DELETE request', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Scan cancelled' }),
      });

      const result = await apiClient.cancelLibraryScan('lib-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/libraries/lib-1/scan', {
        method: 'DELETE',
        headers: expect.any(Object),
      });
      expect(result.data).toBeDefined();
    });
  });

  describe('Collection management', () => {
    it('getCollectionsByLibrary fetches collections', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ collections: [] }),
      });

      const result = await apiClient.getCollectionsByLibrary('lib-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/collections/library/lib-1', expect.any(Object));
      expect(result.data).toBeDefined();
    });

    it('getCollection fetches a single collection', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ collection: { id: 'col-1', name: 'Collection' } }),
      });

      const result = await apiClient.getCollection('col-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/collections/col-1', expect.any(Object));
      expect(result.data).toBeDefined();
    });

    it('deleteCollection sends delete request', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await apiClient.deleteCollection('col-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/collections/col-1', {
        method: 'DELETE',
        headers: expect.any(Object),
      });
    });

    it('refreshCollectionMetadata sends POST request', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Refresh started', jobId: 'job-1' }),
      });

      const result = await apiClient.refreshCollectionMetadata('col-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/collections/col-1/refresh-metadata', {
        method: 'POST',
        headers: expect.any(Object),
      });
      expect(result.data).toBeDefined();
    });

    it('refreshCollectionImages sends POST request', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Refresh started', jobId: 'job-1' }),
      });

      const result = await apiClient.refreshCollectionImages('col-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/collections/col-1/refresh-images', {
        method: 'POST',
        headers: expect.any(Object),
      });
      expect(result.data).toBeDefined();
    });
  });

  describe('Media management', () => {
    it('getMedia fetches a single media', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ media: { id: 'media-1', title: 'Movie' } }),
      });

      const result = await apiClient.getMedia('media-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/media/media-1', expect.any(Object));
      expect(result.data).toBeDefined();
    });

    it('deleteMedia sends delete request', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await apiClient.deleteMedia('media-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/media/media-1', {
        method: 'DELETE',
        headers: expect.any(Object),
      });
    });

    it('refreshMediaMetadata sends POST request', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Refresh started', jobId: 'job-1' }),
      });

      const result = await apiClient.refreshMediaMetadata('media-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/media/media-1/refresh-metadata', {
        method: 'POST',
        headers: expect.any(Object),
      });
      expect(result.data).toBeDefined();
    });

    it('refreshMediaImages sends POST request', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Refresh started', jobId: 'job-1' }),
      });

      const result = await apiClient.refreshMediaImages('media-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/media/media-1/refresh-images', {
        method: 'POST',
        headers: expect.any(Object),
      });
      expect(result.data).toBeDefined();
    });
  });

  describe('Person management', () => {
    it('getPerson fetches a single person', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ person: { id: 'person-1', name: 'Actor' } }),
      });

      const result = await apiClient.getPerson('person-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/persons/person-1', expect.any(Object));
      expect(result.data).toBeDefined();
    });

    it('searchPersons sends search query', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ persons: [] }),
      });

      const result = await apiClient.searchPersons('Tom Hanks');

      expect(mockFetch).toHaveBeenCalledWith('/api/persons/search?q=Tom%20Hanks', expect.any(Object));
      expect(result.data).toBeDefined();
    });

    it('refreshPersonMetadata sends POST request', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Refreshed', person: { id: 'person-1' } }),
      });

      const result = await apiClient.refreshPersonMetadata('person-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/persons/person-1/refresh', {
        method: 'POST',
        headers: expect.any(Object),
      });
      expect(result.data).toBeDefined();
    });
  });
});
