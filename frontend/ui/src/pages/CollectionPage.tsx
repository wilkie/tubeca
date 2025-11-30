import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Container,
  Typography,
  CircularProgress,
  Alert,
  Grid,
  Card,
  CardContent,
  CardActionArea,
  CardMedia,
  Breadcrumbs,
  Link,
  Chip,
  Paper,
  Divider,
  Button,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import {
  Folder,
  VideoFile,
  AudioFile,
  Tv,
  Person,
  Album,
  CalendarMonth,
  Star,
  PlayArrow,
  Movie,
  MoreVert,
  Delete,
  Collections,
  Refresh,
  Image as ImageIcon,
} from '@mui/icons-material';
import { apiClient, type Collection, type CollectionType, type ShowCredit, type Image, type Credit } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ImagesDialog } from '../components/ImagesDialog';

interface CreditWithImages extends Credit {
  images?: Image[];
}

interface ShowCreditWithImages extends ShowCredit {
  images?: Image[];
}

interface MediaItem {
  id: string;
  name: string;
  type: 'Video' | 'Audio';
  duration?: number;
  videoDetails?: {
    season: number | null;
    episode: number | null;
    description?: string | null;
    releaseDate?: string | null;
    rating?: string | null;
    credits?: CreditWithImages[];
  } | null;
  audioDetails?: {
    track: number | null;
    disc: number | null;
  } | null;
  images?: Image[];
}

interface ChildCollection {
  id: string;
  name: string;
  collectionType?: CollectionType;
  images?: Image[];
}

interface BreadcrumbItem {
  id: string;
  name: string;
  type: 'library' | 'collection';
}

function getCollectionIcon(collectionType?: CollectionType) {
  switch (collectionType) {
    case 'Show':
      return <Tv sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />;
    case 'Season':
      return <Folder sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />;
    case 'Artist':
      return <Person sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />;
    case 'Album':
      return <Album sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />;
    default:
      return <Folder sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />;
  }
}

function getCollectionLabel(collectionType?: CollectionType): string | null {
  switch (collectionType) {
    case 'Show':
      return 'Show';
    case 'Season':
      return 'Season';
    case 'Artist':
      return 'Artist';
    case 'Album':
      return 'Album';
    default:
      return null;
  }
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}h ${mins}m ${secs}s`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

export function CollectionPage() {
  const { t } = useTranslation();
  const { collectionId } = useParams<{ collectionId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);

  // Menu state
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(menuAnchorEl);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Images dialog state
  const [imagesDialogOpen, setImagesDialogOpen] = useState(false);

  // Refresh metadata state
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRefreshingImages, setIsRefreshingImages] = useState(false);

  const canEdit = user?.role === 'Admin' || user?.role === 'Editor';

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setMenuAnchorEl(null);
  };

  const handleImagesClick = () => {
    handleMenuClose();
    setImagesDialogOpen(true);
  };

  const handleImagesClose = () => {
    setImagesDialogOpen(false);
  };

  const handleDeleteClick = () => {
    handleMenuClose();
    setDeleteDialogOpen(true);
  };

  const handleRefreshMetadata = async () => {
    if (!collection) return;
    handleMenuClose();
    setIsRefreshing(true);
    try {
      await apiClient.refreshCollectionMetadata(collection.id);
      // Could show a success toast here
    } catch (error) {
      console.error('Failed to queue metadata refresh:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRefreshImages = async () => {
    if (!collection) return;
    handleMenuClose();
    setIsRefreshingImages(true);
    try {
      await apiClient.refreshCollectionImages(collection.id);
      // Could show a success toast here
    } catch (error) {
      console.error('Failed to queue image refresh:', error);
    } finally {
      setIsRefreshingImages(false);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
  };

  const handleDeleteConfirm = async () => {
    if (!collection) return;

    setIsDeleting(true);
    const result = await apiClient.deleteCollection(collection.id);

    if (result.error) {
      setError(result.error);
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      return;
    }

    // Navigate back to library after successful deletion
    if (collection.library) {
      navigate(`/library/${collection.library.id}`);
    } else {
      navigate('/');
    }
  };

  useEffect(() => {
    if (!collectionId) return;

    let cancelled = false;

    async function fetchData() {
      setIsLoading(true);
      setError(null);

      const result = await apiClient.getCollection(collectionId!);
      if (cancelled) return;

      if (result.error) {
        setError(result.error);
        setIsLoading(false);
        return;
      }

      if (result.data) {
        setCollection(result.data.collection);

        // Build breadcrumbs
        const crumbs: BreadcrumbItem[] = [];

        // Add library as first crumb
        if (result.data.collection.library) {
          crumbs.push({
            id: result.data.collection.library.id,
            name: result.data.collection.library.name,
            type: 'library',
          });
        }

        // Add parent collection if exists
        if (result.data.collection.parent) {
          crumbs.push({
            id: result.data.collection.parent.id,
            name: result.data.collection.parent.name,
            type: 'collection',
          });
        }

        setBreadcrumbs(crumbs);
      }

      setIsLoading(false);
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [collectionId]);

  const handleCollectionClick = (id: string) => {
    navigate(`/collection/${id}`);
  };

  const handleMediaClick = (mediaId: string) => {
    navigate(`/media/${mediaId}`);
  };

  const handleBreadcrumbClick = (item: BreadcrumbItem) => {
    if (item.type === 'library') {
      navigate(`/library/${item.id}`);
    } else {
      navigate(`/collection/${item.id}`);
    }
  };

  const handlePlay = (mediaId: string) => {
    navigate(`/play/${mediaId}`);
  };

  if (isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '50vh',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Container>
    );
  }

  if (!collection) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="warning">{t('collection.notFound')}</Alert>
      </Container>
    );
  }

  const childCollections = (collection.children || []) as ChildCollection[];
  const rawMedia = (collection.media || []) as MediaItem[];

  // Check if this is a Film library collection (should be displayed as a movie)
  const isFilmLibrary = collection.library?.libraryType === 'Film';
  const primaryMedia = rawMedia.length > 0 ? rawMedia[0] : null;

  // Sort media based on collection type
  const media = [...rawMedia].sort((a, b) => {
    // For seasons (TV episodes), sort by episode number
    if (collection.collectionType === 'Season') {
      const aEp = a.videoDetails?.episode ?? Infinity;
      const bEp = b.videoDetails?.episode ?? Infinity;
      return aEp - bEp;
    }

    // For albums (music tracks), sort by disc then track number
    if (collection.collectionType === 'Album') {
      const aDisc = a.audioDetails?.disc ?? 1;
      const bDisc = b.audioDetails?.disc ?? 1;
      if (aDisc !== bDisc) return aDisc - bDisc;

      const aTrack = a.audioDetails?.track ?? Infinity;
      const bTrack = b.audioDetails?.track ?? Infinity;
      return aTrack - bTrack;
    }

    // Default: sort by name
    return a.name.localeCompare(b.name);
  });

  // Get display label based on collection type
  const getChildLabel = () => {
    switch (collection.collectionType) {
      case 'Show':
        return t('collection.seasons', 'Seasons');
      case 'Artist':
        return t('collection.albums', 'Albums');
      default:
        return t('collection.subfolders', 'Subfolders');
    }
  };

  const getMediaLabel = () => {
    switch (collection.collectionType) {
      case 'Season':
        return t('collection.episodes', 'Episodes');
      case 'Album':
        return t('collection.tracks', 'Tracks');
      default:
        return t('collection.media', 'Media');
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Breadcrumbs */}
      <Breadcrumbs sx={{ mb: 2 }}>
        {breadcrumbs.map((crumb) => (
          <Link
            key={crumb.id}
            component="button"
            variant="body2"
            onClick={() => handleBreadcrumbClick(crumb)}
            underline="hover"
            color="inherit"
            sx={{ cursor: 'pointer' }}
          >
            {crumb.name}
          </Link>
        ))}
        <Typography color="text.primary">{collection.name}</Typography>
      </Breadcrumbs>

      {/* Film Library - Movie Detail View */}
      {isFilmLibrary && primaryMedia ? (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
            <Box>
              <Typography variant="h4" component="h1">
                {collection.name}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <IconButton
                onClick={handleMenuOpen}
                aria-label={t('common.moreOptions', 'More options')}
                aria-controls={menuOpen ? 'collection-menu' : undefined}
                aria-haspopup="true"
                aria-expanded={menuOpen ? 'true' : undefined}
              >
                <MoreVert />
              </IconButton>
              <Button
                variant="contained"
                size="large"
                startIcon={<PlayArrow />}
                onClick={() => handlePlay(primaryMedia.id)}
              >
                {t('media.play', 'Play')}
              </Button>
            </Box>
          </Box>

          {/* Movie Details Card */}
          <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
            {/* Description */}
            {primaryMedia.videoDetails?.description && (
              <Typography variant="body1" color="text.secondary" paragraph>
                {primaryMedia.videoDetails.description}
              </Typography>
            )}

            {/* Basic info chips */}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
              <Chip
                icon={<Movie />}
                label="Movie"
                size="small"
              />
              {primaryMedia.duration && primaryMedia.duration > 0 && (
                <Chip label={formatDuration(primaryMedia.duration)} size="small" variant="outlined" />
              )}
              {primaryMedia.videoDetails?.rating && (
                <Chip
                  icon={<Star sx={{ fontSize: 16 }} />}
                  label={`${primaryMedia.videoDetails.rating} / 10`}
                  size="small"
                  variant="outlined"
                  color="primary"
                />
              )}
              {primaryMedia.videoDetails?.releaseDate && (
                <Chip label={new Date(primaryMedia.videoDetails.releaseDate).getFullYear()} size="small" variant="outlined" />
              )}
            </Box>

            {/* Cast & Crew text summary */}
            {primaryMedia.videoDetails?.credits && primaryMedia.videoDetails.credits.length > 0 && (
              <>
                <Divider sx={{ my: 2 }} />
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {/* Directors */}
                  {primaryMedia.videoDetails.credits.filter(c => c.creditType === 'Director').length > 0 && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        {t('media.director', 'Director')}
                      </Typography>
                      <Typography variant="body2">
                        {primaryMedia.videoDetails.credits.filter(c => c.creditType === 'Director').map(c => c.name).join(', ')}
                      </Typography>
                    </Box>
                  )}
                  {/* Writers */}
                  {primaryMedia.videoDetails.credits.filter(c => c.creditType === 'Writer').length > 0 && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        {t('media.writer', 'Writer')}
                      </Typography>
                      <Typography variant="body2">
                        {primaryMedia.videoDetails.credits.filter(c => c.creditType === 'Writer').map(c => c.name).join(', ')}
                      </Typography>
                    </Box>
                  )}
                  {/* Cast */}
                  {primaryMedia.videoDetails.credits.filter(c => c.creditType === 'Actor').length > 0 && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        {t('media.cast', 'Cast')}
                      </Typography>
                      <Typography variant="body2">
                        {primaryMedia.videoDetails.credits
                          .filter(c => c.creditType === 'Actor')
                          .slice(0, 10)
                          .map(c => c.role ? `${c.name} (${c.role})` : c.name)
                          .join(', ')}
                      </Typography>
                    </Box>
                  )}
                </Box>
              </>
            )}
          </Paper>

          {/* Special Features / Other Media */}
          {media.length > 1 && (
            <>
              <Typography variant="h6" sx={{ mb: 2 }}>
                {t('collection.specialFeatures', 'Special Features')} ({media.length - 1})
              </Typography>
              <Grid container spacing={2} sx={{ mb: 4 }}>
                {media.slice(1).map((item) => {
                  const primaryImage = item.images?.[0];

                  return (
                    <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={item.id}>
                      <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <CardActionArea
                          onClick={() => handleMediaClick(item.id)}
                          sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                        >
                          {primaryImage ? (
                            <>
                              <CardMedia
                                component="img"
                                image={apiClient.getImageUrl(primaryImage.id)}
                                alt={item.name}
                                sx={{
                                  aspectRatio: '16/9',
                                  objectFit: 'cover',
                                }}
                              />
                              <CardContent sx={{ textAlign: 'center', py: 1 }}>
                                <Typography variant="body2" noWrap title={item.name}>
                                  {item.name}
                                </Typography>
                              </CardContent>
                            </>
                          ) : (
                            <CardContent sx={{ textAlign: 'center', flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                              <VideoFile sx={{ fontSize: 48, color: 'secondary.main', mb: 1 }} />
                              <Typography variant="body2" noWrap title={item.name}>
                                {item.name}
                              </Typography>
                            </CardContent>
                          )}
                        </CardActionArea>
                      </Card>
                    </Grid>
                  );
                })}
              </Grid>
            </>
          )}

          {/* Cast & Crew Photo Grid */}
          {primaryMedia.videoDetails?.credits && primaryMedia.videoDetails.credits.length > 0 && (
            <Box sx={{ mt: 4 }}>
              <Typography variant="h5" sx={{ mb: 2 }}>
                {t('media.castAndCrew', 'Cast & Crew')}
              </Typography>
              <Grid container spacing={2}>
                {[
                  // Actors first (up to 10)
                  ...primaryMedia.videoDetails.credits
                    .filter(c => c.creditType === 'Actor')
                    .slice(0, 10),
                  // Then directors
                  ...primaryMedia.videoDetails.credits
                    .filter(c => c.creditType === 'Director'),
                  // Then writers
                  ...primaryMedia.videoDetails.credits
                    .filter(c => c.creditType === 'Writer'),
                ].map((credit) => {
                    const creditImage = credit.images?.[0];

                    return (
                      <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={credit.id}>
                        <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                          {creditImage ? (
                            <CardMedia
                              component="img"
                              image={apiClient.getImageUrl(creditImage.id)}
                              alt={credit.name}
                              sx={{
                                aspectRatio: '2/3',
                                objectFit: 'cover',
                              }}
                            />
                          ) : (
                            <Box
                              sx={{
                                aspectRatio: '2/3',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                bgcolor: 'action.hover',
                              }}
                            >
                              <Person sx={{ fontSize: 64, color: 'text.secondary' }} />
                            </Box>
                          )}
                          <CardContent sx={{ textAlign: 'center', py: 1, flexGrow: 1 }}>
                            <Typography variant="body2" noWrap title={credit.name}>
                              {credit.name}
                            </Typography>
                            {credit.creditType === 'Actor' && credit.role ? (
                              <Typography variant="caption" color="text.secondary" noWrap title={credit.role}>
                                {credit.role}
                              </Typography>
                            ) : credit.creditType !== 'Actor' && (
                              <Typography variant="caption" color="text.secondary" noWrap>
                                {credit.creditType}
                              </Typography>
                            )}
                          </CardContent>
                        </Card>
                      </Grid>
                    );
                  })}
              </Grid>
            </Box>
          )}
        </>
      ) : (
        <>
          {/* Standard Collection View */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="h4" component="h1">
                {collection.name}
              </Typography>
              {getCollectionLabel(collection.collectionType) && (
                <Chip
                  label={getCollectionLabel(collection.collectionType)}
                  size="small"
                  color="primary"
                  variant="outlined"
                />
              )}
            </Box>
            <IconButton
              onClick={handleMenuOpen}
              aria-label={t('common.moreOptions', 'More options')}
              aria-controls={menuOpen ? 'collection-menu' : undefined}
              aria-haspopup="true"
              aria-expanded={menuOpen ? 'true' : undefined}
            >
              <MoreVert />
            </IconButton>
          </Box>

          {/* Show Details */}
      {collection.showDetails && (
        <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
          {/* Rating and Status Row */}
          {(collection.showDetails.rating || collection.showDetails.status || collection.showDetails.releaseDate) && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: (collection.showDetails.genres || collection.showDetails.description || (collection.showDetails.credits && collection.showDetails.credits.length > 0)) ? 2 : 0 }}>
              {collection.showDetails.rating && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Star sx={{ color: 'warning.main', fontSize: 20 }} />
                  <Typography variant="body2">
                    {collection.showDetails.rating.toFixed(1)}
                  </Typography>
                </Box>
              )}
              {collection.showDetails.status && (
                <Chip
                  label={collection.showDetails.status}
                  size="small"
                  color={collection.showDetails.status === 'Ended' ? 'default' : 'success'}
                  variant="outlined"
                />
              )}
              {collection.showDetails.releaseDate && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <CalendarMonth sx={{ fontSize: 20, color: 'text.secondary' }} />
                  <Typography variant="body2" color="text.secondary">
                    {new Date(collection.showDetails.releaseDate).getFullYear()}
                    {collection.showDetails.endDate &&
                      ` - ${new Date(collection.showDetails.endDate).getFullYear()}`}
                  </Typography>
                </Box>
              )}
            </Box>
          )}

          {/* Genres */}
          {collection.showDetails.genres && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: (collection.showDetails.description || (collection.showDetails.credits && collection.showDetails.credits.length > 0)) ? 2 : 0 }}>
              {collection.showDetails.genres.split(', ').map((genre) => (
                <Chip key={genre} label={genre} size="small" variant="outlined" />
              ))}
            </Box>
          )}

          {/* Description */}
          {collection.showDetails.description && (
            <Typography variant="body2" color="text.secondary">
              {collection.showDetails.description}
            </Typography>
          )}

          {/* Cast summary */}
          {collection.showDetails.credits && collection.showDetails.credits.length > 0 && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Cast
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {collection.showDetails.credits
                  .filter((c: ShowCredit) => c.creditType === 'Actor')
                  .slice(0, 10)
                  .map((credit: ShowCredit) => (
                    <Chip
                      key={credit.id}
                      label={credit.role ? `${credit.name} as ${credit.role}` : credit.name}
                      size="small"
                      variant="outlined"
                    />
                  ))}
              </Box>
            </>
          )}
        </Paper>
      )}

      {/* Season Details */}
      {collection.seasonDetails && (collection.seasonDetails.releaseDate || collection.seasonDetails.description) && (
        <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
          {collection.seasonDetails.releaseDate && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: collection.seasonDetails.description ? 2 : 0 }}>
              <CalendarMonth sx={{ fontSize: 20, color: 'text.secondary' }} />
              <Typography variant="body2" color="text.secondary">
                {new Date(collection.seasonDetails.releaseDate).toLocaleDateString()}
              </Typography>
            </Box>
          )}

          {collection.seasonDetails.description && (
            <Typography variant="body2" color="text.secondary">
              {collection.seasonDetails.description}
            </Typography>
          )}
        </Paper>
      )}

      {/* Artist Details */}
      {collection.artistDetails && (
        <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
          {(collection.artistDetails.country || collection.artistDetails.formedYear) && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: (collection.artistDetails.genres || collection.artistDetails.biography || (collection.artistDetails.members && collection.artistDetails.members.length > 0)) ? 2 : 0 }}>
              {collection.artistDetails.country && (
                <Typography variant="body2" color="text.secondary">
                  {collection.artistDetails.country}
                </Typography>
              )}
              {collection.artistDetails.formedYear && (
                <Typography variant="body2" color="text.secondary">
                  Formed: {collection.artistDetails.formedYear}
                  {collection.artistDetails.endedYear &&
                    ` - ${collection.artistDetails.endedYear}`}
                </Typography>
              )}
            </Box>
          )}

          {collection.artistDetails.genres && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: (collection.artistDetails.biography || (collection.artistDetails.members && collection.artistDetails.members.length > 0)) ? 2 : 0 }}>
              {collection.artistDetails.genres.split(', ').map((genre) => (
                <Chip key={genre} label={genre} size="small" variant="outlined" />
              ))}
            </Box>
          )}

          {collection.artistDetails.biography && (
            <Typography variant="body2" color="text.secondary">
              {collection.artistDetails.biography}
            </Typography>
          )}

          {collection.artistDetails.members && collection.artistDetails.members.length > 0 && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Members
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {collection.artistDetails.members.map((member) => (
                  <Chip
                    key={member.id}
                    label={member.role ? `${member.name} (${member.role})` : member.name}
                    size="small"
                    variant={member.active ? 'filled' : 'outlined'}
                    color={member.active ? 'primary' : 'default'}
                  />
                ))}
              </Box>
            </>
          )}
        </Paper>
      )}

      {/* Album Details */}
      {collection.albumDetails && (
        <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
          {(collection.albumDetails.releaseType || collection.albumDetails.releaseDate || collection.albumDetails.label) && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: (collection.albumDetails.genres || collection.albumDetails.description) ? 2 : 0 }}>
              {collection.albumDetails.releaseType && (
                <Chip
                  label={collection.albumDetails.releaseType}
                  size="small"
                  color="primary"
                  variant="outlined"
                />
              )}
              {collection.albumDetails.releaseDate && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <CalendarMonth sx={{ fontSize: 20, color: 'text.secondary' }} />
                  <Typography variant="body2" color="text.secondary">
                    {new Date(collection.albumDetails.releaseDate).toLocaleDateString()}
                  </Typography>
                </Box>
              )}
              {collection.albumDetails.label && (
                <Typography variant="body2" color="text.secondary">
                  {collection.albumDetails.label}
                </Typography>
              )}
            </Box>
          )}

          {collection.albumDetails.genres && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: collection.albumDetails.description ? 2 : 0 }}>
              {collection.albumDetails.genres.split(', ').map((genre) => (
                <Chip key={genre} label={genre} size="small" variant="outlined" />
              ))}
            </Box>
          )}

          {collection.albumDetails.description && (
            <Typography variant="body2" color="text.secondary">
              {collection.albumDetails.description}
            </Typography>
          )}
        </Paper>
      )}

      {childCollections.length === 0 && media.length === 0 ? (
        <Alert severity="info">{t('collection.empty')}</Alert>
      ) : (
        <>
          {/* Child collections section */}
          {childCollections.length > 0 && (
            <>
              <Typography variant="h6" sx={{ mb: 2 }}>
                {getChildLabel()} ({childCollections.length})
              </Typography>
              <Grid container spacing={2} sx={{ mb: 4 }}>
                {childCollections.map((child) => {
                  const primaryImage = child.images?.[0];
                  const hasImage = primaryImage && child.collectionType === 'Season';

                  return (
                    <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={child.id}>
                      <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <CardActionArea
                          onClick={() => handleCollectionClick(child.id)}
                          sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                        >
                          {hasImage ? (
                            <>
                              <CardMedia
                                component="img"
                                image={apiClient.getImageUrl(primaryImage.id)}
                                alt={child.name}
                                sx={{
                                  aspectRatio: '2/3',
                                  objectFit: 'cover',
                                }}
                              />
                              <CardContent sx={{ textAlign: 'center', py: 1 }}>
                                <Typography variant="body2" noWrap title={child.name}>
                                  {child.name}
                                </Typography>
                              </CardContent>
                            </>
                          ) : (
                            <CardContent sx={{ textAlign: 'center', flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                              {getCollectionIcon(child.collectionType)}
                              <Typography variant="body2" noWrap title={child.name}>
                                {child.name}
                              </Typography>
                            </CardContent>
                          )}
                        </CardActionArea>
                      </Card>
                    </Grid>
                  );
                })}
              </Grid>
            </>
          )}

          {/* Media items section */}
          {media.length > 0 && (
            <>
              <Typography variant="h6" sx={{ mb: 2 }}>
                {getMediaLabel()} ({media.length})
              </Typography>
              <Grid container spacing={2}>
                {media.map((item) => {
                  // Build display label with episode/track number
                  let numberLabel: string | null = null;
                  if (collection.collectionType === 'Season' && item.videoDetails?.episode) {
                    numberLabel = `E${item.videoDetails.episode}`;
                  } else if (collection.collectionType === 'Album' && item.audioDetails?.track) {
                    numberLabel = `${item.audioDetails.track}`;
                  }

                  const primaryImage = item.images?.[0];
                  const isEpisode = collection.collectionType === 'Season' && item.type === 'Video';
                  const hasImage = primaryImage && isEpisode;

                  return (
                    <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={item.id}>
                      <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <CardActionArea
                          onClick={() => handleMediaClick(item.id)}
                          sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                        >
                          {hasImage ? (
                            <>
                              <CardMedia
                                component="img"
                                image={apiClient.getImageUrl(primaryImage.id)}
                                alt={item.name}
                                sx={{
                                  aspectRatio: '16/9',
                                  objectFit: 'cover',
                                }}
                              />
                              <CardContent sx={{ textAlign: 'center', py: 1 }}>
                                {numberLabel && (
                                  <Typography variant="caption" color="text.secondary" display="block">
                                    {numberLabel}
                                  </Typography>
                                )}
                                <Typography variant="body2" noWrap title={item.name}>
                                  {item.name}
                                </Typography>
                              </CardContent>
                            </>
                          ) : (
                            <CardContent sx={{ textAlign: 'center', flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                              {item.type === 'Video' ? (
                                <VideoFile sx={{ fontSize: 48, color: 'secondary.main', mb: 1 }} />
                              ) : (
                                <AudioFile sx={{ fontSize: 48, color: 'secondary.main', mb: 1 }} />
                              )}
                              {numberLabel && (
                                <Typography variant="caption" color="text.secondary" display="block">
                                  {numberLabel}
                                </Typography>
                              )}
                              <Typography variant="body2" noWrap title={item.name}>
                                {item.name}
                              </Typography>
                            </CardContent>
                          )}
                        </CardActionArea>
                      </Card>
                    </Grid>
                  );
                })}
              </Grid>
            </>
          )}
        </>
      )}

          {/* Show Cast Photo Grid - at the bottom */}
          {collection.showDetails?.credits && collection.showDetails.credits.filter((c: ShowCredit) => c.creditType === 'Actor').length > 0 && (
            <Box sx={{ mt: 4 }}>
              <Typography variant="h5" sx={{ mb: 2 }}>
                Cast
              </Typography>
              <Grid container spacing={2}>
                {(collection.showDetails.credits as ShowCreditWithImages[])
                  .filter((c) => c.creditType === 'Actor')
                  .slice(0, 10)
                  .map((credit) => {
                    const primaryImage = credit.images?.[0];

                    return (
                      <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={credit.id}>
                        <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                          {primaryImage ? (
                            <CardMedia
                              component="img"
                              image={apiClient.getImageUrl(primaryImage.id)}
                              alt={credit.name}
                              sx={{
                                aspectRatio: '2/3',
                                objectFit: 'cover',
                              }}
                            />
                          ) : (
                            <Box
                              sx={{
                                aspectRatio: '2/3',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                bgcolor: 'action.hover',
                              }}
                            >
                              <Person sx={{ fontSize: 64, color: 'text.secondary' }} />
                            </Box>
                          )}
                          <CardContent sx={{ textAlign: 'center', py: 1, flexGrow: 1 }}>
                            <Typography variant="body2" noWrap title={credit.name}>
                              {credit.name}
                            </Typography>
                            {credit.role && (
                              <Typography variant="caption" color="text.secondary" noWrap title={credit.role}>
                                {credit.role}
                              </Typography>
                            )}
                          </CardContent>
                        </Card>
                      </Grid>
                    );
                  })}
              </Grid>
            </Box>
          )}
        </>
      )}

      {/* Options Menu (shared by all collection views) */}
      <Menu
        id="collection-menu"
        anchorEl={menuAnchorEl}
        open={menuOpen}
        onClose={handleMenuClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
      >
        <MenuItem onClick={handleImagesClick}>
          <ListItemIcon>
            <Collections fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {t('collection.images', 'Images')}
          </ListItemText>
        </MenuItem>
        {canEdit && <Divider />}
        {canEdit && (
          <MenuItem onClick={handleRefreshMetadata} disabled={isRefreshing}>
            <ListItemIcon>
              <Refresh fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              {isRefreshing ? t('collection.refreshing', 'Refreshing...') : t('collection.refreshMetadata', 'Refresh metadata')}
            </ListItemText>
          </MenuItem>
        )}
        {canEdit && (
          <MenuItem onClick={handleRefreshImages} disabled={isRefreshingImages}>
            <ListItemIcon>
              <ImageIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              {isRefreshingImages ? t('collection.refreshingImages', 'Refreshing...') : t('collection.refreshImages', 'Refresh images')}
            </ListItemText>
          </MenuItem>
        )}
        {canEdit && (
          <MenuItem onClick={handleDeleteClick}>
            <ListItemIcon>
              <Delete fontSize="small" color="error" />
            </ListItemIcon>
            <ListItemText primaryTypographyProps={{ color: 'error' }}>
              {t('collection.delete', 'Delete')}
            </ListItemText>
          </MenuItem>
        )}
      </Menu>

      {/* Delete Confirmation Dialog (shared by all collection views) */}
      <Dialog
        open={deleteDialogOpen}
        onClose={handleDeleteCancel}
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
      >
        <DialogTitle id="delete-dialog-title">
          {t('collection.deleteTitle', 'Delete Collection?')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-dialog-description">
            {t('collection.deleteConfirmation', 'Are you sure you want to delete "{{name}}"? This action cannot be undone and will remove all associated media and metadata.', { name: collection.name })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel} disabled={isDeleting}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            color="error"
            variant="contained"
            disabled={isDeleting}
          >
            {isDeleting ? t('common.deleting', 'Deleting...') : t('common.delete', 'Delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Images Dialog */}
      <ImagesDialog
        open={imagesDialogOpen}
        onClose={handleImagesClose}
        images={collection.images || []}
        title={t('collection.imagesTitle', 'Collection Images')}
      />
    </Container>
  );
}
