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
  Button,
  IconButton,
  Chip,
  TextField,
  Switch,
  FormControlLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Breadcrumbs,
  Link,
} from '@mui/material';
import {
  Edit,
  Delete,
  Public,
  Lock,
  Folder,
  VideoFile,
  AudioFile,
  Save,
  Cancel,
  ArrowBack,
} from '@mui/icons-material';
import {
  apiClient,
  type UserCollection,
  type UserCollectionItem,
} from '../api/client';
import { useAuth } from '../context/AuthContext';

export function UserCollectionPage() {
  const { t } = useTranslation();
  const { collectionId } = useParams<{ collectionId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [collection, setCollection] = useState<UserCollection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editIsPublic, setEditIsPublic] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<UserCollectionItem | null>(null);

  const isOwner = collection?.userId === user?.id;

  useEffect(() => {
    if (!collectionId) return;

    let cancelled = false;

    async function fetchData() {
      setIsLoading(true);
      setError(null);

      const result = await apiClient.getUserCollection(collectionId!);
      if (cancelled) return;

      if (result.error) {
        setError(result.error);
      } else if (result.data) {
        setCollection(result.data.userCollection);
      }

      setIsLoading(false);
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [collectionId]);

  const handleStartEdit = () => {
    if (!collection) return;
    setEditName(collection.name);
    setEditDescription(collection.description || '');
    setEditIsPublic(collection.isPublic);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!collection || !collectionId) return;

    const result = await apiClient.updateUserCollection(collectionId, {
      name: editName,
      description: editDescription,
      isPublic: editIsPublic,
    });

    if (result.error) {
      setError(result.error);
    } else if (result.data) {
      setCollection({
        ...collection,
        ...result.data.userCollection,
      });
      setIsEditing(false);
    }
  };

  const handleRemoveItem = (item: UserCollectionItem) => {
    setItemToDelete(item);
    setDeleteDialogOpen(true);
  };

  const handleConfirmRemoveItem = async () => {
    if (!collectionId || !itemToDelete) return;

    const result = await apiClient.removeUserCollectionItem(collectionId, itemToDelete.id);
    if (result.error) {
      setError(result.error);
    } else {
      setCollection((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items?.filter((i) => i.id !== itemToDelete.id),
          _count: prev._count ? { items: (prev._count.items || 0) - 1 } : undefined,
        };
      });
    }

    setDeleteDialogOpen(false);
    setItemToDelete(null);
  };

  const handleItemClick = (item: UserCollectionItem) => {
    if (item.collection) {
      navigate(`/collection/${item.collection.id}`);
    } else if (item.media) {
      navigate(`/media/${item.media.id}`);
    }
  };

  if (isLoading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      </Container>
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
        <Alert severity="error">{t('collection.notFound')}</Alert>
      </Container>
    );
  }

  const items = collection.items || [];

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link
          component="button"
          variant="body2"
          onClick={() => navigate('/my-collections')}
          sx={{ display: 'flex', alignItems: 'center' }}
        >
          <ArrowBack fontSize="small" sx={{ mr: 0.5 }} />
          {t('userCollections.title')}
        </Link>
        <Typography variant="body2" color="text.primary">
          {collection.name}
        </Typography>
      </Breadcrumbs>

      <Box sx={{ mb: 4 }}>
        {isEditing ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label={t('userCollections.name')}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              fullWidth
            />
            <TextField
              label={t('userCollections.description')}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              fullWidth
              multiline
              rows={2}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={editIsPublic}
                  onChange={(e) => setEditIsPublic(e.target.checked)}
                />
              }
              label={editIsPublic ? t('userCollections.public') : t('userCollections.private')}
            />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                startIcon={<Save />}
                onClick={handleSaveEdit}
              >
                {t('common.save')}
              </Button>
              <Button
                variant="outlined"
                startIcon={<Cancel />}
                onClick={handleCancelEdit}
              >
                {t('common.cancel')}
              </Button>
            </Box>
          </Box>
        ) : (
          <>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="h4" component="h1">
                {collection.name}
              </Typography>
              {isOwner && (
                <Button
                  variant="outlined"
                  startIcon={<Edit />}
                  onClick={handleStartEdit}
                >
                  {t('userCollections.edit')}
                </Button>
              )}
            </Box>
            {collection.description && (
              <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
                {collection.description}
              </Typography>
            )}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Chip
                icon={collection.isPublic ? <Public fontSize="small" /> : <Lock fontSize="small" />}
                label={collection.isPublic ? t('userCollections.public') : t('userCollections.private')}
                size="small"
                variant="outlined"
              />
              <Typography variant="body2" color="text.secondary">
                {t('userCollections.itemCount', { count: items.length })}
              </Typography>
              {collection.user && !isOwner && (
                <Typography variant="body2" color="text.secondary">
                  {t('userCollections.createdBy', { name: collection.user.name })}
                </Typography>
              )}
            </Box>
          </>
        )}
      </Box>

      {items.length === 0 ? (
        <Alert severity="info">{t('userCollections.noItems')}</Alert>
      ) : (
        <Grid container spacing={2}>
          {items.map((item) => {
            const isCollection = !!item.collection;
            const content = item.collection || item.media;
            if (!content) return null;

            const primaryImage = isCollection
              ? item.collection?.images?.[0]
              : item.media?.images?.[0];
            const hasImage = primaryImage != null;

            // Build subtitle
            let subtitle = '';
            if (!isCollection && item.media) {
              if (item.media.videoDetails) {
                const { season, episode } = item.media.videoDetails;
                if (season != null && episode != null) {
                  subtitle = `S${season}E${episode}`;
                }
              } else if (item.media.audioDetails) {
                const { track, disc } = item.media.audioDetails;
                if (disc != null && track != null) {
                  subtitle = `Disc ${disc}, Track ${track}`;
                } else if (track != null) {
                  subtitle = `Track ${track}`;
                }
              }
              if (item.media.collection) {
                const collectionName = item.media.collection.name;
                if (subtitle) {
                  subtitle = `${collectionName} - ${subtitle}`;
                } else {
                  subtitle = collectionName;
                }
              }
            }

            return (
              <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={item.id}>
                <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                  {isOwner && (
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveItem(item);
                      }}
                      sx={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        zIndex: 1,
                        bgcolor: 'background.paper',
                        '&:hover': { bgcolor: 'error.light', color: 'error.contrastText' },
                      }}
                    >
                      <Delete fontSize="small" />
                    </IconButton>
                  )}
                  <CardActionArea
                    onClick={() => handleItemClick(item)}
                    sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                  >
                    {hasImage ? (
                      <>
                        <CardMedia
                          component="img"
                          image={apiClient.getImageUrl(primaryImage.id)}
                          alt={content.name}
                          sx={{
                            aspectRatio: isCollection ? '2/3' : '16/9',
                            objectFit: 'cover',
                          }}
                        />
                        <CardContent sx={{ textAlign: 'center', py: 1 }}>
                          <Typography variant="body2" noWrap title={content.name}>
                            {content.name}
                          </Typography>
                          {subtitle && (
                            <Typography variant="caption" color="text.secondary" noWrap>
                              {subtitle}
                            </Typography>
                          )}
                        </CardContent>
                      </>
                    ) : (
                      <CardContent sx={{ textAlign: 'center', flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        {isCollection ? (
                          <Folder sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
                        ) : item.media?.type === 'Video' ? (
                          <VideoFile sx={{ fontSize: 48, color: 'secondary.main', mb: 1 }} />
                        ) : (
                          <AudioFile sx={{ fontSize: 48, color: 'secondary.main', mb: 1 }} />
                        )}
                        <Typography variant="body2" noWrap title={content.name}>
                          {content.name}
                        </Typography>
                        {subtitle && (
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {subtitle}
                          </Typography>
                        )}
                      </CardContent>
                    )}
                  </CardActionArea>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>{t('userCollections.removeFromCollection')}</DialogTitle>
        <DialogContent>
          <Typography>
            {itemToDelete?.collection?.name || itemToDelete?.media?.name}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleConfirmRemoveItem} color="error">
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
