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
  MoreVert,
  Delete,
  Collections,
  Refresh,
  Image as ImageIcon,
  KeyboardArrowDown,
} from '@mui/icons-material';
import { apiClient, type Collection, type CollectionType, type ShowCredit, type Image, type Credit } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { formatDuration } from '../utils/format';
import { ImagesDialog } from '../components/ImagesDialog';

interface CreditWithPerson extends Credit {
  person?: {
    id: string;
    images?: Image[];
  } | null;
}

interface ShowCreditWithPerson extends ShowCredit {
  person?: {
    id: string;
    images?: Image[];
  } | null;
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
    credits?: CreditWithPerson[];
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
  media?: {
    id: string;
    videoDetails?: {
      episode: number | null;
    } | null;
  }[];
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

  // Season selector state for Shows
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [seasonMenuAnchorEl, setSeasonMenuAnchorEl] = useState<null | HTMLElement>(null);
  const seasonMenuOpen = Boolean(seasonMenuAnchorEl);

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
      <Container maxWidth={false} sx={{ py: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Container>
    );
  }

  if (!collection) {
    return (
      <Container maxWidth={false} sx={{ py: 4 }}>
        <Alert severity="warning">{t('collection.notFound')}</Alert>
      </Container>
    );
  }

  const childCollections = (collection.children || []) as ChildCollection[];
  const rawMedia = (collection.media || []) as MediaItem[];

  // Check if this is a Film library collection (should be displayed as a movie)
  const isFilmLibrary = collection.library?.libraryType === 'Film';
  const isShow = collection.collectionType === 'Show';
  const primaryMedia = rawMedia.length > 0 ? rawMedia[0] : null;

  // Sort seasons for Shows
  const sortedSeasons = isShow
    ? [...childCollections].sort((a, b) => a.name.localeCompare(b.name))
    : [];

  // Get the currently selected season (default to first season)
  const currentSeasonId = selectedSeasonId || (sortedSeasons.length > 0 ? sortedSeasons[0].id : null);
  const currentSeason = sortedSeasons.find(s => s.id === currentSeasonId);

  // Find first episode for the selected season
  const firstEpisodeId = isShow && currentSeason ? (() => {
    if (currentSeason.media && currentSeason.media.length > 0) {
      // Sort episodes by episode number
      const sortedEpisodes = [...currentSeason.media].sort((a, b) => {
        const aEp = a.videoDetails?.episode ?? Infinity;
        const bEp = b.videoDetails?.episode ?? Infinity;
        return aEp - bEp;
      });
      if (sortedEpisodes.length > 0) {
        return sortedEpisodes[0].id;
      }
    }
    return null;
  })() : null;

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
    <Container maxWidth={false} sx={{ py: 4 }}>
      {/* Breadcrumbs - shown for non-hero views (film and show views have breadcrumbs in hero) */}
      {!isFilmLibrary && !isShow && (
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
      )}

      {/* Film Library - Movie Detail View */}
      {isFilmLibrary && primaryMedia ? (
        <>
          {/* Hero Section with Backdrop - Full viewport height */}
          {(() => {
            // Find images by type
            const backdropImage = collection.images?.find(img => img.imageType === 'Backdrop');
            const posterImage = collection.images?.find(img => img.imageType === 'Poster');
            const logoImage = collection.images?.find(img => img.imageType === 'Logo');

            return (
              <Box
                sx={{
                  position: 'relative',
                  mx: -3, // Extend beyond container padding
                  mt: -4, // Pull up to top
                  mb: 3,
                  minHeight: 'calc(100vh - 48px)', // Full viewport minus header
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {/* Backdrop Image */}
                {backdropImage ? (
                  <Box
                    component="img"
                    src={apiClient.getImageUrl(backdropImage.id)}
                    alt=""
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      zIndex: 0,
                    }}
                  />
                ) : (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      bgcolor: 'grey.900',
                      zIndex: 0,
                    }}
                  />
                )}

                {/* Gradient Overlay */}
                <Box
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 50%, rgba(0,0,0,0.3) 100%)',
                    zIndex: 1,
                  }}
                />

                {/* Breadcrumbs at top */}
                <Breadcrumbs
                  sx={{
                    position: 'relative',
                    zIndex: 2,
                    px: 3,
                    pt: 2,
                    '& .MuiBreadcrumbs-separator': { color: 'grey.400' },
                  }}
                >
                  {breadcrumbs.map((crumb) => (
                    <Link
                      key={crumb.id}
                      component="button"
                      variant="body2"
                      onClick={() => handleBreadcrumbClick(crumb)}
                      underline="hover"
                      sx={{
                        cursor: 'pointer',
                        color: 'grey.300',
                        '&:hover': { color: 'white' },
                      }}
                    >
                      {crumb.name}
                    </Link>
                  ))}
                  <Typography sx={{ color: 'grey.100' }}>{collection.name}</Typography>
                </Breadcrumbs>

                {/* Description Card - Semi-transparent, below breadcrumbs */}
                {(primaryMedia.videoDetails?.description || (primaryMedia.videoDetails?.credits && primaryMedia.videoDetails.credits.length > 0)) && (
                  <Box
                    sx={{
                      position: 'relative',
                      zIndex: 2,
                      px: 3,
                      mt: 2,
                      maxWidth: { xs: '100%', md: '60%', lg: '50%' },
                      maxHeight: { xs: 'calc(100vh - 350px)', md: 'calc(100vh - 400px)' },
                      overflow: 'hidden',
                    }}
                  >
                    <Paper
                      sx={{
                        p: 3,
                        bgcolor: 'rgba(0, 0, 0, 0.6)',
                        backdropFilter: 'blur(10px)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        maxHeight: '100%',
                        overflow: 'auto',
                      }}
                    >
                      {/* Description */}
                      {primaryMedia.videoDetails?.description && (
                        <Typography
                          variant="body1"
                          sx={{
                            color: 'grey.200',
                            mb: primaryMedia.videoDetails?.credits?.length ? 2 : 0,
                            display: '-webkit-box',
                            WebkitLineClamp: 6,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {primaryMedia.videoDetails.description}
                        </Typography>
                      )}

                      {/* Cast & Crew text summary */}
                      {primaryMedia.videoDetails?.credits && primaryMedia.videoDetails.credits.length > 0 && (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          {/* Directors */}
                          {primaryMedia.videoDetails.credits.filter(c => c.creditType === 'Director').length > 0 && (
                            <Box>
                              <Typography variant="caption" sx={{ color: 'grey.400' }}>
                                {t('media.director', 'Director')}
                              </Typography>
                              <Typography variant="body2" component="div" sx={{ color: 'grey.200' }}>
                                {primaryMedia.videoDetails.credits
                                  .filter(c => c.creditType === 'Director')
                                  .map((c, index, arr) => (
                                    <span key={c.id}>
                                      {c.personId ? (
                                        <Link
                                          component="button"
                                          variant="body2"
                                          onClick={() => navigate(`/person/${c.personId}`)}
                                          sx={{
                                            color: 'grey.200',
                                            '&:hover': { color: 'white' },
                                          }}
                                        >
                                          {c.name}
                                        </Link>
                                      ) : (
                                        c.name
                                      )}
                                      {index < arr.length - 1 && ', '}
                                    </span>
                                  ))}
                              </Typography>
                            </Box>
                          )}
                          {/* Writers */}
                          {primaryMedia.videoDetails.credits.filter(c => c.creditType === 'Writer').length > 0 && (
                            <Box>
                              <Typography variant="caption" sx={{ color: 'grey.400' }}>
                                {t('media.writer', 'Writer')}
                              </Typography>
                              <Typography variant="body2" component="div" sx={{ color: 'grey.200' }}>
                                {primaryMedia.videoDetails.credits
                                  .filter(c => c.creditType === 'Writer')
                                  .map((c, index, arr) => (
                                    <span key={c.id}>
                                      {c.personId ? (
                                        <Link
                                          component="button"
                                          variant="body2"
                                          onClick={() => navigate(`/person/${c.personId}`)}
                                          sx={{
                                            color: 'grey.200',
                                            '&:hover': { color: 'white' },
                                          }}
                                        >
                                          {c.name}
                                        </Link>
                                      ) : (
                                        c.name
                                      )}
                                      {index < arr.length - 1 && ', '}
                                    </span>
                                  ))}
                              </Typography>
                            </Box>
                          )}
                          {/* Cast */}
                          {primaryMedia.videoDetails.credits.filter(c => c.creditType === 'Actor').length > 0 && (
                            <Box>
                              <Typography variant="caption" sx={{ color: 'grey.400' }}>
                                {t('media.cast', 'Cast')}
                              </Typography>
                              <Typography
                                variant="body2"
                                component="div"
                                sx={{
                                  color: 'grey.200',
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                }}
                              >
                                {primaryMedia.videoDetails.credits
                                  .filter(c => c.creditType === 'Actor')
                                  .slice(0, 10)
                                  .map((c, index, arr) => (
                                    <span key={c.id}>
                                      {c.personId ? (
                                        <Link
                                          component="button"
                                          variant="body2"
                                          onClick={() => navigate(`/person/${c.personId}`)}
                                          sx={{
                                            color: 'grey.200',
                                            '&:hover': { color: 'white' },
                                          }}
                                        >
                                          {c.role ? `${c.name} (${c.role})` : c.name}
                                        </Link>
                                      ) : (
                                        c.role ? `${c.name} (${c.role})` : c.name
                                      )}
                                      {index < arr.length - 1 && ', '}
                                    </span>
                                  ))}
                              </Typography>
                            </Box>
                          )}
                        </Box>
                      )}
                    </Paper>
                  </Box>
                )}

                {/* Content Overlay - Poster, Logo, Play button at bottom */}
                <Box
                  sx={{
                    position: 'relative',
                    zIndex: 2,
                    width: '100%',
                    px: 3,
                    pb: 3,
                    mt: 'auto', // Push to bottom
                    display: 'flex',
                    gap: 3,
                    alignItems: 'flex-end',
                  }}
                >
                  {/* Poster */}
                  {posterImage && (
                    <Box
                      component="img"
                      src={apiClient.getImageUrl(posterImage.id)}
                      alt={collection.name}
                      sx={{
                        width: { xs: 120, sm: 150, md: 200 },
                        aspectRatio: '2/3',
                        objectFit: 'cover',
                        borderRadius: 1,
                        boxShadow: 6,
                        flexShrink: 0,
                      }}
                    />
                  )}

                  {/* Title and Metadata */}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    {/* Logo or Title */}
                    {logoImage ? (
                      <Box
                        component="img"
                        src={apiClient.getImageUrl(logoImage.id)}
                        alt={collection.name}
                        sx={{
                          maxWidth: { xs: 200, sm: 300, md: 400 },
                          maxHeight: { xs: 60, sm: 80, md: 100 },
                          objectFit: 'contain',
                          objectPosition: 'left',
                          mb: 1,
                        }}
                      />
                    ) : (
                      <Typography
                        variant="h3"
                        component="h1"
                        sx={{
                          color: 'white',
                          fontWeight: 'bold',
                          textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
                          mb: 1,
                        }}
                      >
                        {collection.name}
                      </Typography>
                    )}

                    {/* Metadata Row */}
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
                      {primaryMedia.videoDetails?.releaseDate && (
                        <Typography variant="body1" sx={{ color: 'grey.300' }}>
                          {new Date(primaryMedia.videoDetails.releaseDate).getFullYear()}
                        </Typography>
                      )}
                      {primaryMedia.duration && primaryMedia.duration > 0 && (
                        <Typography variant="body1" sx={{ color: 'grey.300' }}>
                          {formatDuration(primaryMedia.duration)}
                        </Typography>
                      )}
                      {primaryMedia.videoDetails?.rating && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Star sx={{ color: 'warning.main', fontSize: 20 }} />
                          <Typography variant="body1" sx={{ color: 'grey.300' }}>
                            {primaryMedia.videoDetails.rating}
                          </Typography>
                        </Box>
                      )}
                    </Box>

                    {/* Action Buttons */}
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button
                        variant="contained"
                        size="large"
                        startIcon={<PlayArrow />}
                        onClick={() => handlePlay(primaryMedia.id)}
                      >
                        {t('media.play', 'Play')}
                      </Button>
                      <IconButton
                        onClick={handleMenuOpen}
                        aria-label={t('common.moreOptions', 'More options')}
                        aria-controls={menuOpen ? 'collection-menu' : undefined}
                        aria-haspopup="true"
                        aria-expanded={menuOpen ? 'true' : undefined}
                        sx={{ color: 'white' }}
                      >
                        <MoreVert />
                      </IconButton>
                    </Box>
                  </Box>
                </Box>
              </Box>
            );
          })()}

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
                    const creditImage = credit.person?.images?.[0];

                    return (
                      <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={credit.id}>
                        <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                          <CardActionArea
                            onClick={() => credit.personId && navigate(`/person/${credit.personId}`)}
                            disabled={!credit.personId}
                            sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                          >
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
                            <CardContent sx={{ textAlign: 'center', py: 1, flexGrow: 1, overflow: 'hidden' }}>
                              <Typography variant="body2" noWrap title={credit.name} sx={{ textOverflow: 'ellipsis', overflow: 'hidden' }}>
                                {credit.name}
                              </Typography>
                              {credit.creditType === 'Actor' && credit.role ? (
                                <Typography variant="caption" color="text.secondary" noWrap title={credit.role} sx={{ display: 'block', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                                  {credit.role}
                                </Typography>
                              ) : credit.creditType !== 'Actor' && (
                                <Typography variant="caption" color="text.secondary" noWrap>
                                  {credit.creditType}
                                </Typography>
                              )}
                            </CardContent>
                          </CardActionArea>
                        </Card>
                      </Grid>
                    );
                  })}
              </Grid>
            </Box>
          )}
        </>
      ) : isShow ? (
        <>
          {/* Show Detail View with Hero - Full viewport height */}
          {(() => {
            // Find images by type
            const backdropImage = collection.images?.find(img => img.imageType === 'Backdrop');
            const posterImage = collection.images?.find(img => img.imageType === 'Poster');
            const logoImage = collection.images?.find(img => img.imageType === 'Logo');

            return (
              <Box
                sx={{
                  position: 'relative',
                  mx: -3, // Extend beyond container padding
                  mt: -4, // Pull up to top
                  mb: 3,
                  minHeight: 'calc(100vh - 48px)', // Full viewport minus header
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {/* Backdrop Image */}
                {backdropImage ? (
                  <Box
                    component="img"
                    src={apiClient.getImageUrl(backdropImage.id)}
                    alt=""
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      zIndex: 0,
                    }}
                  />
                ) : (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      bgcolor: 'grey.900',
                      zIndex: 0,
                    }}
                  />
                )}

                {/* Gradient Overlay */}
                <Box
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 50%, rgba(0,0,0,0.3) 100%)',
                    zIndex: 1,
                  }}
                />

                {/* Breadcrumbs at top */}
                <Breadcrumbs
                  sx={{
                    position: 'relative',
                    zIndex: 2,
                    px: 3,
                    pt: 2,
                    '& .MuiBreadcrumbs-separator': { color: 'grey.400' },
                  }}
                >
                  {breadcrumbs.map((crumb) => (
                    <Link
                      key={crumb.id}
                      component="button"
                      variant="body2"
                      onClick={() => handleBreadcrumbClick(crumb)}
                      underline="hover"
                      sx={{
                        cursor: 'pointer',
                        color: 'grey.300',
                        '&:hover': { color: 'white' },
                      }}
                    >
                      {crumb.name}
                    </Link>
                  ))}
                  <Typography sx={{ color: 'grey.100' }}>{collection.name}</Typography>
                </Breadcrumbs>

                {/* Description Card - Semi-transparent, below breadcrumbs */}
                {collection.showDetails?.description && (
                  <Box
                    sx={{
                      position: 'relative',
                      zIndex: 2,
                      px: 3,
                      mt: 2,
                      maxWidth: { xs: '100%', md: '60%', lg: '50%' },
                      maxHeight: { xs: 'calc(100vh - 350px)', md: 'calc(100vh - 400px)' },
                      overflow: 'hidden',
                    }}
                  >
                    <Paper
                      sx={{
                        p: 3,
                        bgcolor: 'rgba(0, 0, 0, 0.6)',
                        backdropFilter: 'blur(10px)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        maxHeight: '100%',
                        overflow: 'auto',
                      }}
                    >
                      <Typography
                        variant="body1"
                        sx={{
                          color: 'grey.200',
                          display: '-webkit-box',
                          WebkitLineClamp: 6,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {collection.showDetails.description}
                      </Typography>
                    </Paper>
                  </Box>
                )}

                {/* Content Overlay - Poster, Logo, Play button at bottom */}
                <Box
                  sx={{
                    position: 'relative',
                    zIndex: 2,
                    width: '100%',
                    px: 3,
                    pb: 3,
                    mt: 'auto', // Push to bottom
                    display: 'flex',
                    gap: 3,
                    alignItems: 'flex-end',
                  }}
                >
                  {/* Poster */}
                  {posterImage && (
                    <Box
                      component="img"
                      src={apiClient.getImageUrl(posterImage.id)}
                      alt={collection.name}
                      sx={{
                        width: { xs: 120, sm: 150, md: 200 },
                        aspectRatio: '2/3',
                        objectFit: 'cover',
                        borderRadius: 1,
                        boxShadow: 6,
                        flexShrink: 0,
                      }}
                    />
                  )}

                  {/* Title and Metadata */}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    {/* Logo or Title */}
                    {logoImage ? (
                      <Box
                        component="img"
                        src={apiClient.getImageUrl(logoImage.id)}
                        alt={collection.name}
                        sx={{
                          maxWidth: { xs: 200, sm: 300, md: 400 },
                          maxHeight: { xs: 60, sm: 80, md: 100 },
                          objectFit: 'contain',
                          objectPosition: 'left',
                          mb: 1,
                        }}
                      />
                    ) : (
                      <Typography
                        variant="h3"
                        component="h1"
                        sx={{
                          color: 'white',
                          fontWeight: 'bold',
                          textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
                          mb: 1,
                        }}
                      >
                        {collection.name}
                      </Typography>
                    )}

                    {/* Metadata Row */}
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
                      {collection.showDetails?.releaseDate && (
                        <Typography variant="body1" sx={{ color: 'grey.300' }}>
                          {new Date(collection.showDetails.releaseDate).getFullYear()}
                          {collection.showDetails.endDate &&
                            ` - ${new Date(collection.showDetails.endDate).getFullYear()}`}
                        </Typography>
                      )}
                      {collection.showDetails?.status && (
                        <Chip
                          label={collection.showDetails.status}
                          size="small"
                          sx={{
                            color: 'grey.100',
                            borderColor: 'grey.500',
                          }}
                          variant="outlined"
                        />
                      )}
                      {collection.showDetails?.rating && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Star sx={{ color: 'warning.main', fontSize: 20 }} />
                          <Typography variant="body1" sx={{ color: 'grey.300' }}>
                            {collection.showDetails.rating.toFixed(1)}
                          </Typography>
                        </Box>
                      )}
                      {sortedSeasons.length > 0 && (
                        <Typography variant="body1" sx={{ color: 'grey.300' }}>
                          {t('collection.seasonCount', '{{count}} Seasons', { count: sortedSeasons.length })}
                        </Typography>
                      )}
                    </Box>

                    {/* Genres */}
                    {collection.showDetails?.genres && (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                        {collection.showDetails.genres.split(', ').map((genre) => (
                          <Chip
                            key={genre}
                            label={genre}
                            size="small"
                            sx={{
                              color: 'grey.100',
                              borderColor: 'grey.600',
                            }}
                            variant="outlined"
                          />
                        ))}
                      </Box>
                    )}

                    {/* Action Buttons */}
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      {/* Season Selector - only show if more than one season */}
                      {sortedSeasons.length > 1 && (
                        <>
                          <Button
                            variant="outlined"
                            size="large"
                            onClick={(e) => setSeasonMenuAnchorEl(e.currentTarget)}
                            endIcon={<KeyboardArrowDown />}
                            sx={{
                              color: 'white',
                              borderColor: 'grey.500',
                              '&:hover': {
                                borderColor: 'white',
                                bgcolor: 'rgba(255,255,255,0.1)',
                              },
                            }}
                          >
                            {currentSeason?.name || t('collection.selectSeason', 'Select Season')}
                          </Button>
                          <Menu
                            anchorEl={seasonMenuAnchorEl}
                            open={seasonMenuOpen}
                            onClose={() => setSeasonMenuAnchorEl(null)}
                            anchorOrigin={{
                              vertical: 'top',
                              horizontal: 'left',
                            }}
                            transformOrigin={{
                              vertical: 'bottom',
                              horizontal: 'left',
                            }}
                          >
                            {sortedSeasons.map((season) => (
                              <MenuItem
                                key={season.id}
                                selected={season.id === currentSeasonId}
                                onClick={() => {
                                  setSelectedSeasonId(season.id);
                                  setSeasonMenuAnchorEl(null);
                                }}
                              >
                                {season.name}
                              </MenuItem>
                            ))}
                          </Menu>
                        </>
                      )}
                      {firstEpisodeId && (
                        <Button
                          variant="contained"
                          size="large"
                          startIcon={<PlayArrow />}
                          onClick={() => handlePlay(firstEpisodeId)}
                        >
                          {t('media.play', 'Play')}
                        </Button>
                      )}
                      <IconButton
                        onClick={handleMenuOpen}
                        aria-label={t('common.moreOptions', 'More options')}
                        aria-controls={menuOpen ? 'collection-menu' : undefined}
                        aria-haspopup="true"
                        aria-expanded={menuOpen ? 'true' : undefined}
                        sx={{ color: 'white' }}
                      >
                        <MoreVert />
                      </IconButton>
                    </Box>
                  </Box>
                </Box>
              </Box>
            );
          })()}

          {/* Seasons Grid */}
          {sortedSeasons.length > 0 && (
            <Box sx={{ mt: 4 }}>
              <Typography variant="h5" sx={{ mb: 2 }}>
                {t('collection.seasons', 'Seasons')} ({sortedSeasons.length})
              </Typography>
              <Grid container spacing={2}>
                {sortedSeasons.map((season) => {
                  const primaryImage = season.images?.[0];

                  return (
                    <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={season.id}>
                      <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <CardActionArea
                          onClick={() => handleCollectionClick(season.id)}
                          sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                        >
                          {primaryImage ? (
                            <>
                              <CardMedia
                                component="img"
                                image={apiClient.getImageUrl(primaryImage.id)}
                                alt={season.name}
                                sx={{
                                  aspectRatio: '2/3',
                                  objectFit: 'cover',
                                }}
                              />
                              <CardContent sx={{ textAlign: 'center', py: 1 }}>
                                <Typography variant="body2" noWrap title={season.name}>
                                  {season.name}
                                </Typography>
                              </CardContent>
                            </>
                          ) : (
                            <CardContent sx={{ textAlign: 'center', flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                              <Folder sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
                              <Typography variant="body2" noWrap title={season.name}>
                                {season.name}
                              </Typography>
                            </CardContent>
                          )}
                        </CardActionArea>
                      </Card>
                    </Grid>
                  );
                })}
              </Grid>
            </Box>
          )}

          {/* Show Cast Photo Grid */}
          {collection.showDetails?.credits && collection.showDetails.credits.filter((c: ShowCredit) => c.creditType === 'Actor').length > 0 && (
            <Box sx={{ mt: 4 }}>
              <Typography variant="h5" sx={{ mb: 2 }}>
                {t('media.cast', 'Cast')}
              </Typography>
              <Grid container spacing={2}>
                {(collection.showDetails.credits as ShowCreditWithPerson[])
                  .filter((c) => c.creditType === 'Actor')
                  .slice(0, 10)
                  .map((credit) => {
                    const primaryImage = credit.person?.images?.[0];

                    return (
                      <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={credit.id}>
                        <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                          <CardActionArea
                            onClick={() => credit.personId && navigate(`/person/${credit.personId}`)}
                            disabled={!credit.personId}
                            sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                          >
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
                            <CardContent sx={{ textAlign: 'center', py: 1, flexGrow: 1, overflow: 'hidden' }}>
                              <Typography variant="body2" noWrap title={credit.name} sx={{ textOverflow: 'ellipsis', overflow: 'hidden' }}>
                                {credit.name}
                              </Typography>
                              {credit.role && (
                                <Typography variant="caption" color="text.secondary" noWrap title={credit.role} sx={{ display: 'block', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                                  {credit.role}
                                </Typography>
                              )}
                            </CardContent>
                          </CardActionArea>
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
          {/* Standard Collection View (Season, Album, Artist, etc.) */}
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
