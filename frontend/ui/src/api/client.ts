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
  BrowseDirectoriesResponse,
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
  SearchFacetsResponse,
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
  WatchProgressResponse,
  UpdateWatchProgressInput,
  ContinueWatchingResponse,
  ContinueWatchingEntry,
  WatchProgress,
  WatchProgressBatchResponse,
  CollectionWatchSummary,
  CollectionWatchSummariesResponse,
  ScrapeState,
  ScrapeStatus,
} from '@tubeca/shared-types';

/** One piece of artwork a provider offers for an entity. */
export interface ArtworkCandidate {
  url: string
  imageType: string
  /** Already downloaded and saved for this entity. */
  saved: boolean
}

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
  BrowseDirectoriesResponse,
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
  SearchFacetsResponse,
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
  WatchProgressResponse,
  UpdateWatchProgressInput,
  ContinueWatchingResponse,
  ContinueWatchingEntry,
  WatchProgress,
  WatchProgressBatchResponse,
  CollectionWatchSummary,
  CollectionWatchSummariesResponse,
  ScrapeState,
  ScrapeStatus,
};

const API_BASE = '/api';

// Transcoding settings types
export interface HardwareEncoder {
  name: string;
  encoder: string;
  type: 'hardware' | 'software';
  priority: number;
}

export interface TranscodingSettings {
  id: string;
  enableHardwareAccel: boolean;
  preferredEncoder: string | null;
  preset: string;
  enableLowLatency: boolean;
  threadCount: number;
  maxConcurrentTranscodes: number;
  segmentDuration: number;
  prefetchSegments: number;
  bitrate1080p: number;
  bitrate720p: number;
  bitrate480p: number;
  bitrate360p: number;
  detectedEncoder: HardwareEncoder;
  activeEncoder: HardwareEncoder;
  availablePresets: string[];
  availableEncoders: HardwareEncoder[];
}

export interface TranscodingSettingsResponse {
  settings: TranscodingSettings;
}

export interface TranscodingSettingsInput {
  enableHardwareAccel: boolean;
  preferredEncoder: string | null;
  preset: string;
  enableLowLatency: boolean;
  threadCount: number;
  maxConcurrentTranscodes: number;
  segmentDuration: number;
  prefetchSegments: number;
  bitrate1080p: number;
  bitrate720p: number;
  bitrate480p: number;
  bitrate360p: number;
}

/** Widths the image endpoint will generate; anything else serves the original. */
export type ImageSize = 'w200' | 'w400' | 'w780' | 'w1280'

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

/** Fired when the server rejects our session; `AuthContext` signs the user out. */
export const UNAUTHORIZED_EVENT = 'tubeca:unauthorized';

const MEDIA_TOKEN_KEY = 'tubeca_media_token';
const MEDIA_TOKEN_EXPIRY_KEY = 'tubeca_media_token_expires';
/** Refresh once less than an hour of the four-hour lifetime remains. */
const MEDIA_TOKEN_REFRESH_MARGIN_MS = 60 * 60 * 1000;

class ApiClient {
  private mediaTokenRequest: Promise<void> | null = null;

  /**
   * Token used by URLs that carry it in the query string (images, streams).
   * Prefers the short-lived media-scoped token, which cannot drive the rest of
   * the API if the URL leaks, and falls back to the session token so URLs are
   * always usable, including on the first render after a reload.
   */
  private urlToken(): string | null {
    const media = localStorage.getItem(MEDIA_TOKEN_KEY);
    const expiresAt = Number(localStorage.getItem(MEDIA_TOKEN_EXPIRY_KEY)) || 0;

    if (media && expiresAt - Date.now() > MEDIA_TOKEN_REFRESH_MARGIN_MS) {
      return media;
    }
    // Expiring or absent: fetch a new one for later renders and use what we have now.
    void this.refreshMediaToken();
    return media ?? this.getToken();
  }

  /**
   * Fetch a media-scoped token, at most one request at a time. Safe to call
   * from render paths; failures leave the previous token in place.
   */
  async refreshMediaToken(): Promise<void> {
    if (!this.getToken()) return;
    if (this.mediaTokenRequest) return this.mediaTokenRequest;

    this.mediaTokenRequest = (async () => {
      const result = await this.request<{ token: string; expiresAt: string }>('/auth/media-token', {
        method: 'POST',
      });
      if (result.data) {
        localStorage.setItem(MEDIA_TOKEN_KEY, result.data.token);
        localStorage.setItem(MEDIA_TOKEN_EXPIRY_KEY, String(Date.parse(result.data.expiresAt)));
      }
    })().finally(() => {
      this.mediaTokenRequest = null;
    });

    return this.mediaTokenRequest;
  }

  clearMediaToken(): void {
    localStorage.removeItem(MEDIA_TOKEN_KEY);
    localStorage.removeItem(MEDIA_TOKEN_EXPIRY_KEY);
  }

  private getToken(): string | null {
    return localStorage.getItem('token');
  }

  private setToken(token: string): void {
    localStorage.setItem('token', token);
  }

  clearToken(): void {
    localStorage.removeItem('token');
    this.clearMediaToken();
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
        // A rejected session should sign the app out once, centrally, rather
        // than surfacing as an error on every call until the user reloads.
        // Login and setup answer 401 for bad credentials, which is not that.
        if (response.status === 401 && !endpoint.startsWith('/auth/')) {
          this.clearToken();
          window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
        }
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

  async getTranscodingSettings(): Promise<ApiResponse<TranscodingSettingsResponse>> {
    return this.request<TranscodingSettingsResponse>('/settings/transcoding');
  }

  async updateTranscodingSettings(
    settings: Partial<TranscodingSettingsInput>
  ): Promise<ApiResponse<TranscodingSettingsResponse>> {
    return this.request<TranscodingSettingsResponse>('/settings/transcoding', {
      method: 'PUT',
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
  /** List the sub-directories of a server path, for the library path picker. */
  async browseDirectories(dirPath?: string): Promise<ApiResponse<BrowseDirectoriesResponse>> {
    const query = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
    return this.request<BrowseDirectoriesResponse>(`/libraries/browse${query}`);
  }

  async startLibraryScan(
    libraryId: string,
    options?: { fullScan?: boolean; dryRunRemovals?: boolean }
  ): Promise<ApiResponse<ScanStartResponse>> {
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

  // ============================================
  // Watch progress
  // ============================================

  async getWatchProgress(mediaId: string): Promise<ApiResponse<WatchProgressResponse>> {
    return this.request<WatchProgressResponse>(`/watch/${mediaId}`);
  }

  async updateWatchProgress(
    mediaId: string,
    input: UpdateWatchProgressInput,
    /** `keepalive` lets the request finish after the page is closed or hidden. */
    options: { keepalive?: boolean } = {}
  ): Promise<ApiResponse<WatchProgressResponse>> {
    return this.request<WatchProgressResponse>(`/watch/${mediaId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
      keepalive: options.keepalive,
    });
  }

  async markWatched(mediaId: string): Promise<ApiResponse<WatchProgressResponse>> {
    return this.request<WatchProgressResponse>(`/watch/${mediaId}/complete`, { method: 'POST' });
  }

  async clearWatchProgress(mediaId: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/watch/${mediaId}`, { method: 'DELETE' });
  }

  async getWatchProgressBatch(mediaIds: string[]): Promise<ApiResponse<WatchProgressBatchResponse>> {
    return this.request<WatchProgressBatchResponse>(`/watch/batch?mediaIds=${encodeURIComponent(mediaIds.join(','))}`);
  }

  async getCollectionWatchSummaries(
    collectionIds: string[]
  ): Promise<ApiResponse<CollectionWatchSummariesResponse>> {
    return this.request<CollectionWatchSummariesResponse>(
      `/watch/collections?ids=${encodeURIComponent(collectionIds.join(','))}`
    );
  }

  async getContinueWatching(limit?: number): Promise<ApiResponse<ContinueWatchingResponse>> {
    const query = limit ? `?limit=${limit}` : '';
    return this.request<ContinueWatchingResponse>(`/watch/continue${query}`);
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
    const token = this.urlToken();
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
    const token = this.urlToken();
    return `${API_BASE}/stream/audio/${mediaId}?token=${token}`;
  }

  // Get URL for subtitle stream as WebVTT (includes auth token)
  getSubtitleUrl(mediaId: string, streamIndex: number): string {
    const token = this.urlToken();
    return `${API_BASE}/stream/subtitles/${mediaId}?token=${token}&streamIndex=${streamIndex}`;
  }

  // HLS streaming URLs
  getHlsMasterPlaylistUrl(mediaId: string, audioTrack?: number): string {
    const token = this.urlToken();
    let url = `${API_BASE}/stream/hls/${mediaId}/master.m3u8?token=${token}`;
    if (audioTrack !== undefined) {
      url += `&audioTrack=${audioTrack}`;
    }
    return url;
  }

  getHlsVariantPlaylistUrl(mediaId: string, quality: string, audioTrack?: string): string {
    const token = this.urlToken();
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
  /** Choose which candidate image is used for its entity and type. */
  async setPrimaryImage(imageId: string): Promise<ApiResponse<{ image: Image }>> {
    return this.request<{ image: Image }>(`/images/${imageId}/primary`, { method: 'PUT' });
  }

  async deleteImage(imageId: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/images/${imageId}`, { method: 'DELETE' });
  }

  /** The artwork the provider has for a collection, beyond the one it chose. */
  async getArtworkCandidates(
    collectionId: string
  ): Promise<ApiResponse<{ candidates: ArtworkCandidate[] }>> {
    return this.request<{ candidates: ArtworkCandidate[] }>(
      `/images/candidates/collection/${collectionId}`
    );
  }

  /** Save one of those candidates, and use it. */
  async saveArtworkFromUrl(target: {
    url: string;
    imageType: string;
    collectionId?: string;
    mediaId?: string;
    isPrimary?: boolean;
  }): Promise<ApiResponse<{ message: string; path: string }>> {
    return this.request<{ message: string; path: string }>('/images/download', {
      method: 'POST',
      body: JSON.stringify(target),
    });
  }

  /**
   * Upload artwork for a collection or media item.
   *
   * The body is the file itself rather than a form, so the browser sends the
   * bytes with the file's own content type and the server needs no multipart
   * parser.
   */
  async uploadImage(
    file: File,
    target: { imageType: string; collectionId?: string; mediaId?: string; isPrimary?: boolean }
  ): Promise<ApiResponse<{ message: string; path: string }>> {
    const params = new URLSearchParams({ imageType: target.imageType });
    if (target.collectionId) params.set('collectionId', target.collectionId);
    if (target.mediaId) params.set('mediaId', target.mediaId);
    if (target.isPrimary) params.set('isPrimary', 'true');

    const token = this.getToken();
    try {
      const response = await fetch(`${API_BASE}/images/upload?${params.toString()}`, {
        method: 'POST',
        headers: {
          'Content-Type': file.type,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: file,
      });
      const data = await response.json();
      if (!response.ok) return { error: data.error || 'Upload failed' };
      return { data };
    } catch {
      return { error: 'Network error' };
    }
  }

  /**
   * URL for an image, optionally at a bounded width.
   *
   * A grid of posters does not need the provider's original, which for a
   * backdrop can be several megabytes. Pass a size and the server serves a
   * copy it generates once.
   */
  getImageUrl(imageId: string, size?: ImageSize): string {
    const token = this.urlToken();
    const sizeParam = size ? `&size=${size}` : '';
    return `${API_BASE}/images/${imageId}/file?token=${token}${sizeParam}`;
  }

  // Person methods
  async getPerson(id: string): Promise<ApiResponse<PersonResponse>> {
    return this.request<PersonResponse>(`/persons/${id}`);
  }

  /** Filter options for the search page, across every accessible library. */
  async getSearchFacets(): Promise<ApiResponse<SearchFacetsResponse>> {
    return this.request<SearchFacetsResponse>('/search/facets');
  }

  /** Rebuild the full-text search index. Admin only. */
  async reindexSearch(): Promise<ApiResponse<{ collections: number; media: number }>> {
    return this.request<{ collections: number; media: number }>('/search/reindex', { method: 'POST' });
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
    const token = this.urlToken();
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
