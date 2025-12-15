import type {
  User,
  UserRole,
  UserGroup,
  LoginResponse,
  UserResponse,
  UsersResponse,
  CreateUserInput,
  UpdateUserInput,
  Group,
  GroupResponse,
  GroupsResponse,
  CreateGroupInput,
  UpdateGroupInput,
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
  PaginatedCollectionsResponse,
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
  FilmDetails,
  FilmCredit,
  ArtistDetails,
  ArtistMember,
  AlbumDetails,
  AlbumCredit,
  Keyword,
  KeywordsResponse,
  Image,
  ImageType,
  Person,
  PersonWithFilmography,
  PersonResponse,
  PersonsResponse,
  PersonFilmographyShow,
  PersonFilmographyFilm,
  PersonFilmographyEpisode,
  TrickplayInfo,
  TrickplayResolution,
  TrickplayInfoResponse,
  SearchResponse,
  UserCollection,
  UserCollectionItem,
  UserCollectionItemCollection,
  UserCollectionItemMedia,
  UserCollectionItemUserCollection,
  UserCollectionsResponse,
  UserCollectionResponse,
  UserCollectionItemResponse,
  UserCollectionType,
  CreateUserCollectionInput,
  UpdateUserCollectionInput,
  AddUserCollectionItemInput,
  CheckFavoritesResponse,
  ToggleFavoriteResponse,
  CheckWatchLaterResponse,
  ToggleWatchLaterResponse,
  SetPlaybackQueueInput,
} from '@tubeca/shared-types';

// Re-export types for convenience
export type {
  User,
  UserRole,
  UserGroup,
  LoginResponse,
  UserResponse,
  UsersResponse,
  CreateUserInput,
  UpdateUserInput,
  Group,
  GroupResponse,
  GroupsResponse,
  CreateGroupInput,
  UpdateGroupInput,
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
  PaginatedCollectionsResponse,
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
  FilmDetails,
  FilmCredit,
  ArtistDetails,
  ArtistMember,
  AlbumDetails,
  AlbumCredit,
  Keyword,
  KeywordsResponse,
  Image,
  ImageType,
  Person,
  PersonWithFilmography,
  PersonResponse,
  PersonsResponse,
  PersonFilmographyShow,
  PersonFilmographyFilm,
  PersonFilmographyEpisode,
  TrickplayInfo,
  TrickplayResolution,
  TrickplayInfoResponse,
  SearchResponse,
  UserCollection,
  UserCollectionItem,
  UserCollectionItemCollection,
  UserCollectionItemMedia,
  UserCollectionItemUserCollection,
  UserCollectionsResponse,
  UserCollectionResponse,
  UserCollectionItemResponse,
  UserCollectionType,
  CreateUserCollectionInput,
  UpdateUserCollectionInput,
  AddUserCollectionItemInput,
  CheckFavoritesResponse,
  ToggleFavoriteResponse,
  CheckWatchLaterResponse,
  ToggleWatchLaterResponse,
  SetPlaybackQueueInput,
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

      // Handle 204 No Content responses (e.g., successful DELETE)
      if (response.status === 204) {
        return { data: undefined as T };
      }

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

  // User management methods (Admin only)
  async getUsers(): Promise<ApiResponse<UsersResponse>> {
    return this.request<UsersResponse>('/users');
  }

  async createUser(user: CreateUserInput): Promise<ApiResponse<UserResponse>> {
    return this.request<UserResponse>('/users', {
      method: 'POST',
      body: JSON.stringify(user),
    });
  }

  async updateUser(id: string, user: UpdateUserInput): Promise<ApiResponse<UserResponse>> {
    return this.request<UserResponse>(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(user),
    });
  }

  async updateUserRole(id: string, role: UserRole): Promise<ApiResponse<UserResponse>> {
    return this.request<UserResponse>(`/users/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  }

  async updateUserGroups(id: string, groupIds: string[]): Promise<ApiResponse<UserResponse>> {
    return this.request<UserResponse>(`/users/${id}/groups`, {
      method: 'PATCH',
      body: JSON.stringify({ groupIds }),
    });
  }

  async deleteUser(id: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/users/${id}`, {
      method: 'DELETE',
    });
  }

  // Group management methods (Admin only)
  async getGroups(): Promise<ApiResponse<GroupsResponse>> {
    return this.request<GroupsResponse>('/groups');
  }

  async createGroup(group: CreateGroupInput): Promise<ApiResponse<GroupResponse>> {
    return this.request<GroupResponse>('/groups', {
      method: 'POST',
      body: JSON.stringify(group),
    });
  }

  async updateGroup(id: string, group: UpdateGroupInput): Promise<ApiResponse<GroupResponse>> {
    return this.request<GroupResponse>(`/groups/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(group),
    });
  }

  async deleteGroup(id: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/groups/${id}`, {
      method: 'DELETE',
    });
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
  async startLibraryScan(libraryId: string, options?: { fullScan?: boolean }): Promise<ApiResponse<ScanStartResponse>> {
    return this.request<ScanStartResponse>(`/libraries/${libraryId}/scan`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
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
  async getCollectionsByLibrary(
    libraryId: string,
    options?: {
      page?: number;
      limit?: number;
      sortField?: 'name' | 'dateAdded' | 'releaseDate' | 'rating' | 'runtime';
      sortDirection?: 'asc' | 'desc';
      excludedRatings?: string[];
      keywordIds?: string[];
      nameFilter?: string;
    }
  ): Promise<ApiResponse<PaginatedCollectionsResponse>> {
    const params = new URLSearchParams();
    if (options?.page) params.set('page', options.page.toString());
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.sortField) params.set('sortField', options.sortField);
    if (options?.sortDirection) params.set('sortDirection', options.sortDirection);
    if (options?.excludedRatings?.length) params.set('excludedRatings', options.excludedRatings.join(','));
    if (options?.keywordIds?.length) params.set('keywordIds', options.keywordIds.join(','));
    if (options?.nameFilter) params.set('nameFilter', options.nameFilter);

    const queryString = params.toString();
    const url = `/collections/library/${libraryId}${queryString ? `?${queryString}` : ''}`;
    return this.request<PaginatedCollectionsResponse>(url);
  }

  async getKeywordsByLibrary(libraryId: string): Promise<ApiResponse<KeywordsResponse>> {
    return this.request<KeywordsResponse>(`/collections/library/${libraryId}/keywords`);
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

  // Search for shows/films to identify a collection
  async searchForIdentification(
    query: string,
    type: 'Show' | 'Film',
    year?: number
  ): Promise<ApiResponse<{
    results: Array<{
      externalId: string;
      scraperId: string;
      title: string;
      year?: number;
      posterUrl?: string;
      overview?: string;
    }>;
  }>> {
    return this.request('/collections/search', {
      method: 'POST',
      body: JSON.stringify({ query, type, year }),
    });
  }

  // Identify a collection with a specific external ID
  async identifyCollection(
    collectionId: string,
    externalId: string,
    scraperId: string
  ): Promise<ApiResponse<{ message: string; jobId: string }>> {
    return this.request<{ message: string; jobId: string }>(`/collections/${collectionId}/identify`, {
      method: 'POST',
      body: JSON.stringify({ externalId, scraperId }),
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
  getVideoStreamUrl(mediaId: string, startTime?: number, audioTrack?: number): string {
    const token = this.getToken();
    let url = `${API_BASE}/stream/video/${mediaId}?token=${token}`;
    if (startTime && startTime > 0) {
      url += `&start=${startTime}`;
    }
    if (audioTrack !== undefined) {
      url += `&audioTrack=${audioTrack}`;
    }
    return url;
  }

  // Get streaming URL for audio (includes auth token)
  getAudioStreamUrl(mediaId: string): string {
    const token = this.getToken();
    return `${API_BASE}/stream/audio/${mediaId}?token=${token}`;
  }

  // Get URL for subtitle stream as WebVTT (includes auth token)
  getSubtitleUrl(mediaId: string, streamIndex: number): string {
    const token = this.getToken();
    return `${API_BASE}/stream/subtitles/${mediaId}?token=${token}&streamIndex=${streamIndex}`;
  }

  // HLS streaming URLs
  getHlsMasterPlaylistUrl(mediaId: string, audioTrack?: number): string {
    const token = this.getToken();
    let url = `${API_BASE}/stream/hls/${mediaId}/master.m3u8?token=${token}`;
    if (audioTrack !== undefined) {
      url += `&audioTrack=${audioTrack}`;
    }
    return url;
  }

  getHlsVariantPlaylistUrl(mediaId: string, quality: string, audioTrack?: string): string {
    const token = this.getToken();
    let url = `${API_BASE}/stream/hls/${mediaId}/${quality}.m3u8?token=${token}`;
    if (audioTrack) {
      url += `&audioTrack=${audioTrack}`;
    }
    return url;
  }

  async getHlsQualities(mediaId: string): Promise<ApiResponse<{
    qualities: Array<{
      name: string;
      label: string;
      width: number | null;
      height: number | null;
      bitrate: number | null;
    }>;
  }>> {
    return this.request(`/stream/hls/${mediaId}/qualities`);
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

  // Trickplay methods
  async getTrickplayInfo(mediaId: string): Promise<ApiResponse<TrickplayInfoResponse>> {
    return this.request<TrickplayInfoResponse>(`/stream/trickplay/${mediaId}`);
  }

  // Get URL for a trickplay sprite sheet (includes auth token)
  getTrickplaySpriteUrl(mediaId: string, width: number, index: number): string {
    const token = this.getToken();
    return `${API_BASE}/stream/trickplay/${mediaId}/${width}/${index}?token=${token}`;
  }

  // Search methods
  async search(options?: {
    query?: string;
    page?: number;
    limit?: number;
    keywordIds?: string[];
    excludedRatings?: string[];
  }): Promise<ApiResponse<SearchResponse>> {
    const params = new URLSearchParams();
    if (options?.query) params.set('q', options.query);
    if (options?.page) params.set('page', options.page.toString());
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.keywordIds?.length) params.set('keywordIds', options.keywordIds.join(','));
    if (options?.excludedRatings?.length) params.set('excludedRatings', options.excludedRatings.join(','));

    const queryString = params.toString();
    return this.request<SearchResponse>(`/search${queryString ? `?${queryString}` : ''}`);
  }

  // User Collection methods
  async getUserCollections(): Promise<ApiResponse<UserCollectionsResponse>> {
    return this.request<UserCollectionsResponse>('/user-collections');
  }

  async getPublicCollections(): Promise<ApiResponse<UserCollectionsResponse>> {
    return this.request<UserCollectionsResponse>('/user-collections/public');
  }

  async getUserCollection(id: string): Promise<ApiResponse<UserCollectionResponse>> {
    return this.request<UserCollectionResponse>(`/user-collections/${id}`);
  }

  async createUserCollection(input: CreateUserCollectionInput): Promise<ApiResponse<UserCollectionResponse>> {
    return this.request<UserCollectionResponse>('/user-collections', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async updateUserCollection(id: string, input: UpdateUserCollectionInput): Promise<ApiResponse<UserCollectionResponse>> {
    return this.request<UserCollectionResponse>(`/user-collections/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  async deleteUserCollection(id: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/user-collections/${id}`, {
      method: 'DELETE',
    });
  }

  async addUserCollectionItem(collectionId: string, input: AddUserCollectionItemInput): Promise<ApiResponse<UserCollectionItemResponse>> {
    return this.request<UserCollectionItemResponse>(`/user-collections/${collectionId}/items`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async removeUserCollectionItem(collectionId: string, itemId: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/user-collections/${collectionId}/items/${itemId}`, {
      method: 'DELETE',
    });
  }

  async reorderUserCollectionItems(collectionId: string, itemIds: string[]): Promise<ApiResponse<UserCollectionResponse>> {
    return this.request<UserCollectionResponse>(`/user-collections/${collectionId}/items/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ itemIds }),
    });
  }

  // Favorites methods
  async getFavorites(): Promise<ApiResponse<UserCollectionResponse>> {
    return this.request<UserCollectionResponse>('/user-collections/favorites');
  }

  async checkFavorites(collectionIds?: string[], mediaIds?: string[], userCollectionIds?: string[]): Promise<ApiResponse<CheckFavoritesResponse>> {
    const params = new URLSearchParams();
    if (collectionIds && collectionIds.length > 0) {
      params.set('collectionIds', collectionIds.join(','));
    }
    if (mediaIds && mediaIds.length > 0) {
      params.set('mediaIds', mediaIds.join(','));
    }
    if (userCollectionIds && userCollectionIds.length > 0) {
      params.set('userCollectionIds', userCollectionIds.join(','));
    }
    const query = params.toString();
    return this.request<CheckFavoritesResponse>(`/user-collections/favorites/check${query ? `?${query}` : ''}`);
  }

  async toggleFavorite(input: AddUserCollectionItemInput): Promise<ApiResponse<ToggleFavoriteResponse>> {
    return this.request<ToggleFavoriteResponse>('/user-collections/favorites/toggle', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  // Watch Later methods
  async getWatchLater(): Promise<ApiResponse<UserCollectionResponse>> {
    return this.request<UserCollectionResponse>('/user-collections/watch-later');
  }

  async checkWatchLater(collectionIds?: string[], mediaIds?: string[]): Promise<ApiResponse<CheckWatchLaterResponse>> {
    const params = new URLSearchParams();
    if (collectionIds && collectionIds.length > 0) {
      params.set('collectionIds', collectionIds.join(','));
    }
    if (mediaIds && mediaIds.length > 0) {
      params.set('mediaIds', mediaIds.join(','));
    }
    const query = params.toString();
    return this.request<CheckWatchLaterResponse>(`/user-collections/watch-later/check${query ? `?${query}` : ''}`);
  }

  async toggleWatchLater(input: AddUserCollectionItemInput): Promise<ApiResponse<ToggleWatchLaterResponse>> {
    return this.request<ToggleWatchLaterResponse>('/user-collections/watch-later/toggle', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  // Playback Queue
  async getPlaybackQueue(): Promise<ApiResponse<UserCollectionResponse>> {
    return this.request<UserCollectionResponse>('/user-collections/queue');
  }

  async setPlaybackQueue(items: AddUserCollectionItemInput[]): Promise<ApiResponse<UserCollectionResponse>> {
    return this.request<UserCollectionResponse>('/user-collections/queue', {
      method: 'PUT',
      body: JSON.stringify({ items }),
    });
  }

  async addToPlaybackQueue(input: AddUserCollectionItemInput): Promise<ApiResponse<UserCollectionResponse>> {
    return this.request<UserCollectionResponse>('/user-collections/queue/add', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async clearPlaybackQueue(): Promise<ApiResponse<UserCollectionResponse>> {
    return this.request<UserCollectionResponse>('/user-collections/queue', {
      method: 'DELETE',
    });
  }
}

export const apiClient = new ApiClient();
