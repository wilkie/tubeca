import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Container,
  Typography,
  CircularProgress,
  Alert,
  Paper,
  Button,
  Chip,
  Divider,
  Grid,
  Card,
  CardContent,
  CardMedia,
  CardActionArea,
  Breadcrumbs,
  Link,
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
import { PlayArrow, Tv, Movie, MusicNote, Album, Person, MoreVert, Delete, Collections, Refresh, Image as ImageIcon } from '@mui/icons-material';
import { apiClient, type Media, type Image, type CollectionType } from '../api/client';
import { FavoriteButton } from '../components/FavoriteButton';
import { useAuth } from '../context/AuthContext';
import { ImagesDialog } from '../components/ImagesDialog';
import { formatDuration } from '../utils/format';

interface CreditWithPerson {
  id: string;
  name: string;
  role: string | null;
  creditType: string;
  order: number | null;
  personId: string | null;
  person?: {
    id: string;
    images?: Image[];
  } | null;
}

interface MediaCollection {
  id: string;
  name: string;
  collectionType: CollectionType;
  parent?: {
    id: string;
    name: string;
    collectionType: CollectionType;
  } | null;
  library?: {
    id: string;
    name: string;
  } | null;
}

interface BreadcrumbItem {
  id: string;
  name: string;
  type: 'library' | 'collection';
}

export function MediaPage() {
  const { t } = useTranslation();
  const { mediaId } = useParams<{ mediaId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [media, setMedia] = useState<Media | null>(null);
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
    if (!media) return;
    handleMenuClose();
    setIsRefreshing(true);
    try {
      await apiClient.refreshMediaMetadata(media.id);
      // Could show a success toast here
    } catch (error) {
      console.error('Failed to queue metadata refresh:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRefreshImages = async () => {
    if (!media) return;
    handleMenuClose();
    setIsRefreshingImages(true);
    try {
      await apiClient.refreshMediaImages(media.id);
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
    if (!media) return;

    setIsDeleting(true);
    const result = await apiClient.deleteMedia(media.id);

    if (result.error) {
      setError(result.error);
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      return;
    }

    // Navigate back to collection or library after successful deletion
    const collection = (media as Media & { collection?: MediaCollection }).collection;
    if (collection) {
      navigate(`/collection/${collection.id}`);
    } else if (breadcrumbs.length > 0) {
      const lastCrumb = breadcrumbs[breadcrumbs.length - 1];
      if (lastCrumb.type === 'library') {
        navigate(`/library/${lastCrumb.id}`);
      } else {
        navigate(`/collection/${lastCrumb.id}`);
      }
    } else {
      navigate('/');
    }
  };

  useEffect(() => {
    if (!mediaId) return;

    let cancelled = false;

    async function fetchData() {
      setIsLoading(true);
      setError(null);

      const result = await apiClient.getMedia(mediaId!);
      if (cancelled) return;

      if (result.error) {
        setError(result.error);
      } else if (result.data) {
        setMedia(result.data.media);

        // Build breadcrumbs from collection hierarchy
        const crumbs: BreadcrumbItem[] = [];
        const collection = (result.data.media as Media & { collection?: MediaCollection }).collection;

        if (collection) {
          // Add library
          if (collection.library) {
            crumbs.push({
              id: collection.library.id,
              name: collection.library.name,
              type: 'library',
            });
          }

          // Add parent collection (e.g., Show)
          if (collection.parent) {
            crumbs.push({
              id: collection.parent.id,
              name: collection.parent.name,
              type: 'collection',
            });
          }

          // Add immediate collection (e.g., Season)
          crumbs.push({
            id: collection.id,
            name: collection.name,
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
  }, [mediaId]);

  const handleBreadcrumbClick = (item: BreadcrumbItem) => {
    if (item.type === 'library') {
      navigate(`/library/${item.id}`);
    } else {
      navigate(`/collection/${item.id}`);
    }
  };

  const handlePlay = () => {
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

  if (!media) {
    return (
      <Container maxWidth={false} sx={{ py: 4 }}>
        <Alert severity="warning">{t('media.notFound')}</Alert>
      </Container>
    );
  }

  const videoDetails = media.videoDetails;
  const audioDetails = media.audioDetails;

  // Determine display title for TV episodes
  const displayTitle = videoDetails?.showName && videoDetails?.season && videoDetails?.episode
    ? `${videoDetails.showName} - S${String(videoDetails.season).padStart(2, '0')}E${String(videoDetails.episode).padStart(2, '0')}`
    : media.name;

  const episodeTitle = videoDetails?.showName ? media.name : null;

  return (
    <Container maxWidth={false} sx={{ py: 4 }}>
      {/* Breadcrumbs */}
      {breadcrumbs.length > 0 && (
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
          <Typography color="text.primary">{media.name}</Typography>
        </Breadcrumbs>
      )}

      {/* Media details */}
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Box>
            <Typography variant="h4" component="h1">
              {displayTitle}
            </Typography>
            {episodeTitle && (
              <Typography variant="h6" color="text.secondary">
                {episodeTitle}
              </Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <IconButton
              onClick={handleMenuOpen}
              aria-label={t('common.moreOptions', 'More options')}
              aria-controls={menuOpen ? 'media-menu' : undefined}
              aria-haspopup="true"
              aria-expanded={menuOpen ? 'true' : undefined}
            >
              <MoreVert />
            </IconButton>
            <Button
              variant="contained"
              size="large"
              startIcon={<PlayArrow />}
              onClick={handlePlay}
            >
              {t('media.play')}
            </Button>
            <FavoriteButton mediaId={media.id} />
          </Box>
        </Box>

        {/* Description */}
        {videoDetails?.description && (
          <Typography variant="body1" color="text.secondary" paragraph>
            {videoDetails.description}
          </Typography>
        )}

        {/* Basic info chips */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 3 }}>
          <Chip
            icon={media.type === 'Video' ? (videoDetails?.showName ? <Tv /> : <Movie />) : <MusicNote />}
            label={media.type === 'Video' ? (videoDetails?.showName ? 'TV Episode' : 'Movie') : 'Audio'}
            size="small"
          />
          {media.duration > 0 && (
            <Chip label={formatDuration(media.duration)} size="small" variant="outlined" />
          )}
          {videoDetails?.rating && (
            <Chip label={videoDetails.rating} size="small" variant="outlined" />
          )}
          {videoDetails?.releaseDate && (
            <Chip label={new Date(videoDetails.releaseDate).getFullYear()} size="small" variant="outlined" />
          )}
          {audioDetails?.year && (
            <Chip label={audioDetails.year} size="small" variant="outlined" />
          )}
          {audioDetails?.genre && (
            <Chip label={audioDetails.genre} size="small" variant="outlined" />
          )}
        </Box>

        {/* Video Details */}
        {videoDetails && (
          <>
            {videoDetails.credits && videoDetails.credits.length > 0 && (
              <>
                <Divider sx={{ my: 2 }} />
                <Typography variant="h6" gutterBottom>
                  {t('media.castAndCrew', 'Cast & Crew')}
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {/* Directors */}
                  {videoDetails.credits.filter(c => c.creditType === 'Director').length > 0 && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        {t('media.director', 'Director')}
                      </Typography>
                      <Typography variant="body2">
                        {videoDetails.credits.filter(c => c.creditType === 'Director').map(c => c.name).join(', ')}
                      </Typography>
                    </Box>
                  )}
                  {/* Writers */}
                  {videoDetails.credits.filter(c => c.creditType === 'Writer').length > 0 && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        {t('media.writer', 'Writer')}
                      </Typography>
                      <Typography variant="body2">
                        {videoDetails.credits.filter(c => c.creditType === 'Writer').map(c => c.name).join(', ')}
                      </Typography>
                    </Box>
                  )}
                  {/* Cast */}
                  {videoDetails.credits.filter(c => c.creditType === 'Actor').length > 0 && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        {t('media.cast', 'Cast')}
                      </Typography>
                      <Typography variant="body2">
                        {videoDetails.credits
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
          </>
        )}

        {/* Audio Details */}
        {audioDetails && (
          <>
            <Divider sx={{ my: 2 }} />
            <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {audioDetails.artist && (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {t('media.artist', 'Artist')}
                  </Typography>
                  <Typography variant="body1">{audioDetails.artist}</Typography>
                </Box>
              )}
              {audioDetails.album && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Album color="action" />
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {t('media.album', 'Album')}
                    </Typography>
                    <Typography variant="body1">{audioDetails.album}</Typography>
                  </Box>
                </Box>
              )}
              {audioDetails.track && (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {t('media.track', 'Track')}
                  </Typography>
                  <Typography variant="body1">
                    {audioDetails.disc ? `${audioDetails.disc}-` : ''}{audioDetails.track}
                  </Typography>
                </Box>
              )}
            </Box>
          </>
        )}
      </Paper>

      {/* Credits Photo Grid */}
      {videoDetails?.credits && videoDetails.credits.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h5" sx={{ mb: 2 }}>
            {t('media.castAndCrew', 'Cast & Crew')}
          </Typography>
          <Grid container spacing={2}>
            {(videoDetails.credits as CreditWithPerson[]).map((credit) => {
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
                        {!credit.role && credit.creditType !== 'Actor' && (
                          <Typography variant="caption" color="text.secondary">
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

      {/* Options Menu */}
      <Menu
        id="media-menu"
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
            {t('media.images', 'Images')}
          </ListItemText>
        </MenuItem>
        {canEdit && <Divider />}
        {canEdit && (
          <MenuItem onClick={handleRefreshMetadata} disabled={isRefreshing}>
            <ListItemIcon>
              <Refresh fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              {isRefreshing ? t('media.refreshing', 'Refreshing...') : t('media.refreshMetadata', 'Refresh metadata')}
            </ListItemText>
          </MenuItem>
        )}
        {canEdit && (
          <MenuItem onClick={handleRefreshImages} disabled={isRefreshingImages}>
            <ListItemIcon>
              <ImageIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              {isRefreshingImages ? t('media.refreshingImages', 'Refreshing...') : t('media.refreshImages', 'Refresh images')}
            </ListItemText>
          </MenuItem>
        )}
        {canEdit && (
          <MenuItem onClick={handleDeleteClick}>
            <ListItemIcon>
              <Delete fontSize="small" color="error" />
            </ListItemIcon>
            <ListItemText primaryTypographyProps={{ color: 'error' }}>
              {t('media.delete', 'Delete')}
            </ListItemText>
          </MenuItem>
        )}
      </Menu>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={handleDeleteCancel}
        aria-labelledby="delete-media-dialog-title"
        aria-describedby="delete-media-dialog-description"
      >
        <DialogTitle id="delete-media-dialog-title">
          {t('media.deleteTitle', 'Delete Media?')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-media-dialog-description">
            {t('media.deleteConfirmation', 'Are you sure you want to delete "{{name}}"? This action cannot be undone.', { name: media.name })}
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
        images={media.images || []}
        title={t('media.imagesTitle', 'Media Images')}
      />
    </Container>
  );
}
