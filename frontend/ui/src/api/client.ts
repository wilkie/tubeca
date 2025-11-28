const API_BASE = '/api';

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

class ApiClient {
  private getToken(): string | null {
    return localStorage.getItem('token');
  }

  private setToken(token: string): void {
    localStorage.setItem('token', token);
  }

  clearToken(): void {
    localStorage.removeItem('token');
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const token = this.getToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        return { error: data.error || 'An error occurred' };
      }

      return { data };
    } catch {
      return { error: 'Network error' };
    }
  }

  async login(name: string, password: string): Promise<ApiResponse<LoginResponse>> {
    const result = await this.request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ name, password }),
    });

    if (result.data?.token) {
      this.setToken(result.data.token);
    }

    return result;
  }

  async getCurrentUser(): Promise<ApiResponse<UserResponse>> {
    return this.request<UserResponse>('/users/me');
  }

  async checkSetup(): Promise<ApiResponse<SetupStatusResponse>> {
    return this.request<SetupStatusResponse>('/auth/setup');
  }

  async setup(name: string, password: string): Promise<ApiResponse<LoginResponse>> {
    const result = await this.request<LoginResponse>('/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ name, password }),
    });

    if (result.data?.token) {
      this.setToken(result.data.token);
    }

    return result;
  }

  async getSettings(): Promise<ApiResponse<SettingsResponse>> {
    return this.request<SettingsResponse>('/settings');
  }

  async updateSettings(settings: { instanceName?: string }): Promise<ApiResponse<SettingsResponse>> {
    return this.request<SettingsResponse>('/settings', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    });
  }

  async getLibraries(): Promise<ApiResponse<LibrariesResponse>> {
    return this.request<LibrariesResponse>('/libraries');
  }

  async getLibrary(id: string): Promise<ApiResponse<LibraryResponse>> {
    return this.request<LibraryResponse>(`/libraries/${id}`);
  }

  async createLibrary(library: CreateLibraryInput): Promise<ApiResponse<LibraryResponse>> {
    return this.request<LibraryResponse>('/libraries', {
      method: 'POST',
      body: JSON.stringify(library),
    });
  }

  async updateLibrary(id: string, library: UpdateLibraryInput): Promise<ApiResponse<LibraryResponse>> {
    return this.request<LibraryResponse>(`/libraries/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(library),
    });
  }

  async deleteLibrary(id: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/libraries/${id}`, {
      method: 'DELETE',
    });
  }

  // Library scan methods
  async startLibraryScan(libraryId: string): Promise<ApiResponse<ScanStartResponse>> {
    return this.request<ScanStartResponse>(`/libraries/${libraryId}/scan`, {
      method: 'POST',
    });
  }

  async getLibraryScanStatus(libraryId: string): Promise<ApiResponse<ScanStatusResponse>> {
    return this.request<ScanStatusResponse>(`/libraries/${libraryId}/scan`);
  }

  async cancelLibraryScan(libraryId: string): Promise<ApiResponse<ScanCancelResponse>> {
    return this.request<ScanCancelResponse>(`/libraries/${libraryId}/scan`, {
      method: 'DELETE',
    });
  }

  // Collection methods
  async getCollectionsByLibrary(libraryId: string): Promise<ApiResponse<CollectionsResponse>> {
    return this.request<CollectionsResponse>(`/collections/library/${libraryId}`);
  }

  async getCollection(id: string): Promise<ApiResponse<CollectionResponse>> {
    return this.request<CollectionResponse>(`/collections/${id}`);
  }

  async createCollection(collection: CreateCollectionInput): Promise<ApiResponse<CollectionResponse>> {
    return this.request<CollectionResponse>('/collections', {
      method: 'POST',
      body: JSON.stringify(collection),
    });
  }

  async updateCollection(id: string, collection: UpdateCollectionInput): Promise<ApiResponse<CollectionResponse>> {
    return this.request<CollectionResponse>(`/collections/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(collection),
    });
  }

  async deleteCollection(id: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/collections/${id}`, {
      method: 'DELETE',
    });
  }

  hasToken(): boolean {
    return !!this.getToken();
  }
}

export interface Settings {
  id: string;
  instanceName: string;
  createdAt: string;
  updatedAt: string;
}

export interface SettingsResponse {
  settings: Settings;
}

export interface User {
  id: string;
  name: string;
  role: 'Admin' | 'Editor' | 'Viewer';
  groups: { id: string; name: string }[];
  createdAt: string;
}

export interface LoginResponse {
  user: User;
  token: string;
}

export interface UserResponse {
  user: User;
}

export interface SetupStatusResponse {
  needsSetup: boolean;
}

export type LibraryType = 'Television' | 'Film' | 'Music';

export interface Library {
  id: string;
  name: string;
  path: string;
  libraryType: LibraryType;
  groups: { id: string; name: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface LibraryResponse {
  library: Library;
}

export interface LibrariesResponse {
  libraries: Library[];
}

export interface CreateLibraryInput {
  name: string;
  path: string;
  libraryType: LibraryType;
  groupIds?: string[];
}

export interface UpdateLibraryInput {
  name?: string;
  path?: string;
  libraryType?: LibraryType;
  groupIds?: string[];
}

// Scan types
export interface ScanStartResponse {
  message: string;
  jobId: string;
}

export interface ScanStatusResponse {
  status: 'idle' | 'active' | 'waiting' | 'completed' | 'failed';
  scanning: boolean;
  progress: number;
  result?: {
    filesFound: number;
    filesProcessed: number;
    collectionsCreated: number;
    mediaCreated: number;
    errors: string[];
  };
  failedReason?: string;
}

export interface ScanCancelResponse {
  message: string;
  wasActive: boolean;
}

// Collection types
export interface Collection {
  id: string;
  name: string;
  libraryId: string;
  parentId: string | null;
  library?: { id: string; name: string };
  parent?: { id: string; name: string } | null;
  children?: { id: string; name: string }[];
  media?: { id: string; name: string; type: string }[];
  _count?: { media: number; children: number };
  createdAt: string;
  updatedAt: string;
}

export interface CollectionResponse {
  collection: Collection;
}

export interface CollectionsResponse {
  collections: Collection[];
}

export interface CreateCollectionInput {
  name: string;
  libraryId: string;
  parentId?: string;
}

export interface UpdateCollectionInput {
  name?: string;
  parentId?: string | null;
}

export const apiClient = new ApiClient();
