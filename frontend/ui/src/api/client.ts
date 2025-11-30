import type {
  User,
  UserRole,
  UserGroup,
  LoginResponse,
  UserResponse,
  SetupStatusResponse,
  Settings,
  SettingsResponse,
  Library,
  LibraryType,
  LibraryResponse,
  LibrariesResponse,
  CreateLibraryInput,
  UpdateLibraryInput,
  ScanStartResponse,
  ScanStatusResponse,
  ScanCancelResponse,
  Collection,
  CollectionType,
  CollectionResponse,
  CollectionsResponse,
  CreateCollectionInput,
  UpdateCollectionInput,
  Media,
  MediaType,
  MediaResponse,
  VideoDetails,
  AudioDetails,
  Credit,
  CreditType,
  ShowDetails,
  ShowCredit,
  SeasonDetails,
  ArtistDetails,
  ArtistMember,
  AlbumDetails,
  AlbumCredit,
  Image,
  ImageType,
  Person,
  PersonWithFilmography,
  PersonResponse,
  PersonsResponse,
  PersonFilmographyShow,
  PersonFilmographyFilm,
  PersonFilmographyEpisode,
} from '@tubeca/shared-types';

// Re-export types for convenience
export type {
  User,
  UserRole,
  UserGroup,
  LoginResponse,
  UserResponse,
  SetupStatusResponse,
  Settings,
  SettingsResponse,
  Library,
  LibraryType,
  LibraryResponse,
  LibrariesResponse,
  CreateLibraryInput,
  UpdateLibraryInput,
  ScanStartResponse,
  ScanStatusResponse,
  ScanCancelResponse,
  Collection,
  CollectionType,
  CollectionResponse,
  CollectionsResponse,
  CreateCollectionInput,
  UpdateCollectionInput,
  Media,
  MediaType,
  MediaResponse,
  VideoDetails,
  AudioDetails,
  Credit,
  CreditType,
  ShowDetails,
  ShowCredit,
  SeasonDetails,
  ArtistDetails,
  ArtistMember,
  AlbumDetails,
  AlbumCredit,
  Image,
  ImageType,
  Person,
  PersonWithFilmography,
  PersonResponse,
  PersonsResponse,
  PersonFilmographyShow,
  PersonFilmographyFilm,
  PersonFilmographyEpisode,
};

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

  async refreshCollectionMetadata(id: string): Promise<ApiResponse<{ message: string; jobId: string }>> {
    return this.request<{ message: string; jobId: string }>(`/collections/${id}/refresh-metadata`, {
      method: 'POST',
    });
  }

  async refreshCollectionImages(id: string): Promise<ApiResponse<{ message: string; jobId: string }>> {
    return this.request<{ message: string; jobId: string }>(`/collections/${id}/refresh-images`, {
      method: 'POST',
    });
  }

  // Media methods
  async getMedia(id: string): Promise<ApiResponse<MediaResponse>> {
    return this.request<MediaResponse>(`/media/${id}`);
  }

  async deleteMedia(id: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/media/${id}`, {
      method: 'DELETE',
    });
  }

  async refreshMediaMetadata(id: string): Promise<ApiResponse<{ message: string; jobId: string }>> {
    return this.request<{ message: string; jobId: string }>(`/media/${id}/refresh-metadata`, {
      method: 'POST',
    });
  }

  async refreshMediaImages(id: string): Promise<ApiResponse<{ message: string; jobId: string }>> {
    return this.request<{ message: string; jobId: string }>(`/media/${id}/refresh-images`, {
      method: 'POST',
    });
  }

  // Get streaming URL for video (includes auth token)
  getVideoStreamUrl(mediaId: string, startTime?: number): string {
    const token = this.getToken();
    let url = `${API_BASE}/stream/video/${mediaId}?token=${token}`;
    if (startTime && startTime > 0) {
      url += `&start=${startTime}`;
    }
    return url;
  }

  // Get streaming URL for audio (includes auth token)
  getAudioStreamUrl(mediaId: string): string {
    const token = this.getToken();
    return `${API_BASE}/stream/audio/${mediaId}?token=${token}`;
  }

  hasToken(): boolean {
    return !!this.getToken();
  }

  // Get URL for an image (includes auth token)
  getImageUrl(imageId: string): string {
    const token = this.getToken();
    return `${API_BASE}/images/${imageId}/file?token=${token}`;
  }

  // Person methods
  async getPerson(id: string): Promise<ApiResponse<PersonResponse>> {
    return this.request<PersonResponse>(`/persons/${id}`);
  }

  async searchPersons(query: string): Promise<ApiResponse<PersonsResponse>> {
    return this.request<PersonsResponse>(`/persons/search?q=${encodeURIComponent(query)}`);
  }

  async refreshPersonMetadata(id: string): Promise<ApiResponse<{ message: string; person: PersonWithFilmography }>> {
    return this.request<{ message: string; person: PersonWithFilmography }>(`/persons/${id}/refresh`, {
      method: 'POST',
    });
  }
}

export const apiClient = new ApiClient();
