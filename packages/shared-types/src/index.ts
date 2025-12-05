/**
 * Shared types for Tubeca API
 * Used by both backend and frontend
 */

// ============================================
// User & Auth Types
// ============================================

export type UserRole = 'Admin' | 'Editor' | 'Viewer'

export interface User {
  id: string
  name: string
  role: UserRole
  groups: UserGroup[]
  createdAt: string
  updatedAt: string
}

export interface UserGroup {
  id: string
  name: string
}

export interface LoginResponse {
  user: User
  token: string
}

export interface UserResponse {
  user: User
}

export interface UsersResponse {
  users: User[]
}

export interface CreateUserInput {
  name: string
  password: string
  role?: UserRole
  groupIds?: string[]
}

export interface UpdateUserInput {
  name?: string
  password?: string
}

export interface Group {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  _count?: {
    users: number
    libraries: number
  }
}

export interface GroupResponse {
  group: Group
}

export interface GroupsResponse {
  groups: Group[]
}

export interface CreateGroupInput {
  name: string
}

export interface UpdateGroupInput {
  name: string
}

export interface SetupStatusResponse {
  needsSetup: boolean
}

// ============================================
// Settings Types
// ============================================

export interface Settings {
  id: string
  instanceName: string
  createdAt: string
  updatedAt: string
}

export interface SettingsResponse {
  settings: Settings
}

// ============================================
// Library Types
// ============================================

export type LibraryType = 'Television' | 'Film' | 'Music'

export interface Library {
  id: string
  name: string
  path: string
  libraryType: LibraryType
  watchForChanges: boolean
  groups: UserGroup[]
  createdAt: string
  updatedAt: string
}

export interface LibraryResponse {
  library: Library
}

export interface LibrariesResponse {
  libraries: Library[]
}

export interface CreateLibraryInput {
  name: string
  path: string
  libraryType: LibraryType
  groupIds?: string[]
  watchForChanges?: boolean
}

export interface UpdateLibraryInput {
  name?: string
  path?: string
  libraryType?: LibraryType
  groupIds?: string[]
  watchForChanges?: boolean
}

// ============================================
// Library Scan Types
// ============================================

export interface ScanStartResponse {
  message: string
  jobId: string
}

export type ScanStatus = 'idle' | 'active' | 'waiting' | 'completed' | 'failed'

export interface ScanResult {
  filesFound: number
  filesProcessed: number
  collectionsCreated: number
  mediaCreated: number
  errors: string[]
}

export interface ScanStatusResponse {
  status: ScanStatus
  scanning: boolean
  progress: number
  result?: ScanResult
  failedReason?: string
}

export interface ScanCancelResponse {
  message: string
  wasActive: boolean
}

// ============================================
// Collection Types
// ============================================

export type CollectionType = 'Generic' | 'Show' | 'Season' | 'Film' | 'Artist' | 'Album'

export interface CollectionSummary {
  id: string
  name: string
  collectionType?: CollectionType
  libraryType?: LibraryType
  images?: Image[]
}

export interface MediaSummary {
  id: string
  name: string
  type: MediaType
  videoDetails?: {
    season: number | null
    episode: number | null
  } | null
  audioDetails?: {
    track: number | null
    disc: number | null
  } | null
}

// Show (TV Series) metadata
export interface ShowCredit {
  id: string
  name: string
  role: string | null
  creditType: CreditType
  order: number | null
  personId: string | null
  images?: Image[]
}

export interface ShowDetails {
  id: string
  collectionId: string
  scraperId: string | null
  externalId: string | null
  description: string | null
  releaseDate: string | null
  endDate: string | null
  status: string | null
  rating: number | null
  genres: string | null
  credits: ShowCredit[]
}

// Season metadata
export interface SeasonDetails {
  id: string
  collectionId: string
  scraperId: string | null
  externalId: string | null
  seasonNumber: number | null
  description: string | null
  releaseDate: string | null
}

// Artist metadata
export interface ArtistMember {
  id: string
  name: string
  role: string | null
  active: boolean
}

export interface ArtistDetails {
  id: string
  collectionId: string
  scraperId: string | null
  externalId: string | null
  biography: string | null
  formedYear: number | null
  endedYear: number | null
  genres: string | null
  country: string | null
  members: ArtistMember[]
}

// Album metadata
export interface AlbumCredit {
  id: string
  name: string
  role: string | null
  personId: string | null
}

export interface AlbumDetails {
  id: string
  collectionId: string
  scraperId: string | null
  externalId: string | null
  releaseDate: string | null
  releaseType: string | null
  genres: string | null
  description: string | null
  label: string | null
  credits: AlbumCredit[]
}

// Film metadata
export interface FilmCredit {
  id: string
  name: string
  role: string | null
  creditType: CreditType
  order: number | null
  personId: string | null
  images?: Image[]
}

export interface FilmDetails {
  id: string
  collectionId: string
  scraperId: string | null
  externalId: string | null
  description: string | null
  tagline: string | null
  releaseDate: string | null
  runtime: number | null
  contentRating: string | null // "PG-13", "R", etc.
  rating: number | null // Average rating (e.g., 7.5)
  genres: string | null
  originalTitle: string | null
  status: string | null
  budget: number | null
  revenue: number | null
  credits: FilmCredit[]
}

// Keywords/Tags for search and recommendations
export interface Keyword {
  id: string
  name: string
}

export interface Collection {
  id: string
  name: string
  collectionType: CollectionType
  libraryId: string
  parentId: string | null
  library?: CollectionSummary
  parent?: CollectionSummary | null
  children?: CollectionSummary[]
  media?: MediaSummary[]
  images?: Image[]
  showDetails?: ShowDetails | null
  seasonDetails?: SeasonDetails | null
  filmDetails?: FilmDetails | null
  artistDetails?: ArtistDetails | null
  albumDetails?: AlbumDetails | null
  keywords?: Keyword[]
  _count?: { media: number; children: number }
  createdAt: string
  updatedAt: string
}

export interface CollectionResponse {
  collection: Collection
}

export interface CollectionsResponse {
  collections: Collection[]
}

export interface CreateCollectionInput {
  name: string
  libraryId: string
  parentId?: string
}

export interface UpdateCollectionInput {
  name?: string
  parentId?: string | null
}

// ============================================
// Image Types
// ============================================

export type ImageType =
  | 'Poster'
  | 'Backdrop'
  | 'Logo'
  | 'Thumbnail'
  | 'Still'
  | 'Photo'
  | 'AlbumArt'
  | 'ArtistImage'

export interface Image {
  id: string
  mediaId: string | null
  collectionId: string | null
  personId: string | null
  showCreditId: string | null
  creditId: string | null
  imageType: ImageType
  path: string
  width: number | null
  height: number | null
  format: string | null
  fileSize: number | null
  sourceUrl: string | null
  scraperId: string | null
  isPrimary: boolean
  createdAt: string
  updatedAt: string
}

export interface ImageResponse {
  image: Image
}

export interface ImagesResponse {
  images: Image[]
}

// ============================================
// Media Types
// ============================================

export type MediaType = 'Video' | 'Audio'

export type CreditType =
  | 'Actor'
  | 'Director'
  | 'Writer'
  | 'Producer'
  | 'Composer'
  | 'Cinematographer'
  | 'Editor'

export interface Credit {
  id: string
  name: string
  role: string | null
  creditType: CreditType
  order: number | null
  personId: string | null
  images?: Image[]
}

export interface VideoDetails {
  id: string
  mediaId: string
  showName: string | null
  season: number | null
  episode: number | null
  description: string | null
  releaseDate: string | null
  rating: string | null // Content rating (e.g., "PG-13", "TV-MA")
  credits: Credit[]
}

export interface AudioDetails {
  id: string
  mediaId: string
  artist: string | null
  albumArtist: string | null
  album: string | null
  track: number | null
  disc: number | null
  year: number | null
  genre: string | null
}

export interface MediaCollectionInfo {
  id: string
  name: string
  collectionType: CollectionType
  images?: Image[]
  parent?: {
    id: string
    name: string
    collectionType: CollectionType
    images?: Image[]
  } | null
}

// Media stream types (audio, video, subtitle tracks)
export type StreamType = 'Video' | 'Audio' | 'Subtitle'

export interface MediaStream {
  id: string
  mediaId: string
  streamIndex: number
  streamType: StreamType
  codec: string | null
  codecLong: string | null
  language: string | null
  title: string | null
  isDefault: boolean
  isForced: boolean
  // Audio-specific
  channels: number | null
  channelLayout: string | null
  sampleRate: number | null
  bitRate: number | null
  // Video-specific
  width: number | null
  height: number | null
  frameRate: number | null
}

export interface Media {
  id: string
  name: string
  path: string
  duration: number
  type: MediaType
  thumbnails: string | null
  collectionId: string | null
  collection?: MediaCollectionInfo | null
  videoDetails: VideoDetails | null
  audioDetails: AudioDetails | null
  streams?: MediaStream[]
  images?: Image[]
  createdAt: string
  updatedAt: string
}

export interface MediaResponse {
  media: Media
}

export interface MediaListResponse {
  media: Media[]
}

// ============================================
// Trickplay Types
// ============================================

export interface TrickplayResolution {
  width: number
  tileWidth: number
  tileHeight: number
  columns: number
  rows: number
  tileCount: number // columns * rows (tiles per sprite sheet)
  interval: number // seconds between frames
  spriteCount: number // number of sprite sheet images (0.jpg, 1.jpg, etc.)
}

export interface TrickplayInfo {
  available: boolean
  resolutions: TrickplayResolution[]
}

export interface TrickplayInfoResponse {
  trickplay: TrickplayInfo
}

// ============================================
// Person Types
// ============================================

export interface Person {
  id: string
  name: string
  biography: string | null
  birthDate: string | null
  deathDate: string | null
  birthPlace: string | null
  knownFor: string | null
  tmdbId: number | null
  tvdbId: number | null
  imdbId: string | null
  createdAt: string
  updatedAt: string
}

export interface PersonFilmographyShow {
  collection: {
    id: string
    name: string
    collectionType: string
    images: Array<{
      id: string
      imageType: string
      isPrimary: boolean
    }>
  }
  credit: {
    id: string
    role: string | null
    creditType: string
  }
}

export interface PersonFilmographyFilm {
  collection: {
    id: string
    name: string
    collectionType: string
    images: Array<{
      id: string
      imageType: string
      isPrimary: boolean
    }>
  }
  media: {
    id: string
    name: string
  }
  credit: {
    id: string
    role: string | null
    creditType: string
  }
}

export interface PersonFilmographyEpisode {
  media: {
    id: string
    name: string
    videoDetails: {
      showName: string | null
      season: number | null
      episode: number | null
    } | null
    collection: {
      id: string
      name: string
      parent: {
        id: string
        name: string
      } | null
    } | null
    images: Array<{
      id: string
      imageType: string
      isPrimary: boolean
    }>
  }
  credit: {
    id: string
    role: string | null
    creditType: string
  }
}

export interface PersonWithFilmography extends Person {
  filmography: {
    shows: PersonFilmographyShow[]
    films: PersonFilmographyFilm[]
    episodes: PersonFilmographyEpisode[]
  }
  images: Array<{
    id: string
    imageType: string
    isPrimary: boolean
  }>
}

export interface PersonResponse {
  person: PersonWithFilmography
}

export interface PersonsResponse {
  persons: Person[]
}

// ============================================
// Search Types
// ============================================

export interface SearchResponse {
  collections: Collection[]
  media: Media[]
}

// ============================================
// User Collection Types
// ============================================

export interface UserCollection {
  id: string
  name: string
  description: string | null
  isPublic: boolean
  isSystem: boolean
  systemType: string | null
  userId: string
  user?: { id: string; name: string }
  items?: UserCollectionItem[]
  _count?: { items: number }
  createdAt: string
  updatedAt: string
}

export interface UserCollectionItem {
  id: string
  position: number
  addedAt: string
  userCollectionId: string
  collectionId: string | null
  mediaId: string | null
  collection?: UserCollectionItemCollection | null
  media?: UserCollectionItemMedia | null
}

export interface UserCollectionItemCollection {
  id: string
  name: string
  collectionType: CollectionType
  images?: Image[]
  library?: {
    id: string
    name: string
    libraryType: LibraryType
  }
}

export interface UserCollectionItemMedia {
  id: string
  name: string
  type: MediaType
  duration: number
  images?: Image[]
  collection?: {
    id: string
    name: string
    library?: {
      id: string
      name: string
      libraryType: LibraryType
    }
  } | null
  videoDetails?: {
    season: number | null
    episode: number | null
  } | null
  audioDetails?: {
    track: number | null
    disc: number | null
  } | null
}

export interface UserCollectionsResponse {
  userCollections: UserCollection[]
}

export interface UserCollectionResponse {
  userCollection: UserCollection
}

export interface UserCollectionItemResponse {
  item: UserCollectionItem
}

export interface CreateUserCollectionInput {
  name: string
  description?: string
  isPublic?: boolean
}

export interface UpdateUserCollectionInput {
  name?: string
  description?: string
  isPublic?: boolean
}

export interface AddUserCollectionItemInput {
  collectionId?: string
  mediaId?: string
}

// Favorites types
export interface CheckFavoritesResponse {
  collectionIds: string[]
  mediaIds: string[]
}

export interface ToggleFavoriteResponse {
  favorited: boolean
}

// Watch Later types
export interface CheckWatchLaterResponse {
  collectionIds: string[]
  mediaIds: string[]
}

export interface ToggleWatchLaterResponse {
  inWatchLater: boolean
}

// Playback Queue types
export interface SetPlaybackQueueInput {
  items: AddUserCollectionItemInput[]
}
