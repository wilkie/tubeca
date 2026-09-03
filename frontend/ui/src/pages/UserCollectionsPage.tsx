import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Button,
  Chip,
  Tabs,
  Tab,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import { Add, Delete, Public, Lock, Favorite, FavoriteBorder } from '@mui/icons-material';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, useApiQuery } from '../hooks/useApiQuery';
import { apiClient, type UserCollection, type UserCollectionType } from '../api/client';
import { CreateCollectionDialog } from '../components/CreateCollectionDialog';
import { Tooltip } from '@mui/material';

export function UserCollectionsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const myQuery = useApiQuery(queryKeys.userCollections, () => apiClient.getUserCollections());
  // Public collections are a bonus row; a failure there should not blank the page.
  const publicQuery = useApiQuery(queryKeys.publicCollections, () => apiClient.getPublicCollections());

  const myCollections: UserCollection[] = myQuery.data?.userCollections ?? [];
  const publicCollections: UserCollection[] = publicQuery.data?.userCollections ?? [];
  const isLoading = myQuery.isPending;

  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? myQuery.errorMessage;
  const setError = setActionError;

  /** Replace the cached list of the viewer's own collections. */
  const setMyCollections = (update: (prev: UserCollection[]) => UserCollection[]) => {
    queryClient.setQueryData<{ userCollections: UserCollection[] }>(queryKeys.userCollections, (prev) => ({
      userCollections: update(prev?.userCollections ?? []),
    }));
  };
  const [tabIndex, setTabIndex] = useState(0);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [collectionToDelete, setCollectionToDelete] = useState<UserCollection | null>(null);
  // Which of these the viewer has favourited, asked for once both lists are in.
  const collectionIds = [...myCollections.map((c) => c.id), ...publicCollections.map((c) => c.id)];
  const favoritesQuery = useApiQuery(
    ['user-collection-favorites', collectionIds.join(',')],
    () => apiClient.checkFavorites(undefined, undefined, collectionIds),
    { enabled: collectionIds.length > 0 }
  );
  const [locallyToggled, setLocallyToggled] = useState<Map<string, boolean>>(new Map());
  const favoritedIds = new Set(favoritesQuery.data?.userCollectionIds ?? []);
  for (const [id, favorited] of locallyToggled) {
    if (favorited) favoritedIds.add(id);
    else favoritedIds.delete(id);
  }

  const handleCollectionClick = (collectionId: string) => {
    navigate(`/my-collections/${collectionId}`);
  };

  const handleCreateCollection = async (name: string, description: string, isPublic: boolean, collectionType: UserCollectionType) => {
    const result = await apiClient.createUserCollection({ name, description, isPublic, collectionType });
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.data) {
      setMyCollections((prev) => [result.data!.userCollection, ...prev]);
      setCreateDialogOpen(false);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, collection: UserCollection) => {
    e.stopPropagation();
    setCollectionToDelete(collection);
    setDeleteDialogOpen(true);
  };

  const handleToggleFavorite = async (e: React.MouseEvent, collection: UserCollection) => {
    e.stopPropagation();
    const result = await apiClient.toggleFavorite({ userCollectionId: collection.id });
    if (result.data) {
      setLocallyToggled((prev) => new Map(prev).set(collection.id, result.data!.favorited));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!collectionToDelete) return;

    const result = await apiClient.deleteUserCollection(collectionToDelete.id);
    if (result.error) {
      setError(result.error);
    } else {
      setMyCollections((prev) => prev.filter((c) => c.id !== collectionToDelete.id));
    }
    setDeleteDialogOpen(false);
    setCollectionToDelete(null);
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

  const renderCollectionCard = (collection: UserCollection, showOwner = false, showDelete = false) => {
    const itemCount = collection._count?.items ?? 0;
    const isFavorited = favoritedIds.has(collection.id);

    return (
      <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={collection.id}>
        <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <CardActionArea
            component="div"
            onClick={() => handleCollectionClick(collection.id)}
            sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch', cursor: 'pointer' }}
          >
            <CardContent sx={{ flexGrow: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
                  {collection.name}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <Tooltip title={isFavorited ? t('favorites.removeFromFavorites') : t('favorites.addToFavorites')}>
                    <IconButton
                      size="small"
                      onClick={(e) => handleToggleFavorite(e, collection)}
                    >
                      {isFavorited ? (
                        <Favorite fontSize="small" color="error" />
                      ) : (
                        <FavoriteBorder fontSize="small" />
                      )}
                    </IconButton>
                  </Tooltip>
                  {showDelete && (
                    <IconButton
                      size="small"
                      onClick={(e) => handleDeleteClick(e, collection)}
                    >
                      <Delete fontSize="small" />
                    </IconButton>
                  )}
                </Box>
              </Box>
              {collection.description && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {collection.description}
                </Typography>
              )}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Chip
                  icon={collection.isPublic ? <Public fontSize="small" /> : <Lock fontSize="small" />}
                  label={collection.isPublic ? t('userCollections.public') : t('userCollections.private')}
                  size="small"
                  variant="outlined"
                />
                <Typography variant="caption" color="text.secondary">
                  {t('userCollections.itemCount', { count: itemCount })}
                </Typography>
              </Box>
              {showOwner && collection.user && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  {t('userCollections.createdBy', { name: collection.user.name })}
                </Typography>
              )}
            </CardContent>
          </CardActionArea>
        </Card>
      </Grid>
    );
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1">
          {t('userCollections.title')}
        </Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setCreateDialogOpen(true)}
        >
          {t('userCollections.create')}
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Tabs value={tabIndex} onChange={(_, newValue) => setTabIndex(newValue)} sx={{ mb: 3 }}>
        <Tab label={t('userCollections.title')} />
        <Tab label={t('userCollections.publicCollections')} />
      </Tabs>

      {tabIndex === 0 && (
        <>
          {myCollections.length === 0 ? (
            <Alert severity="info">{t('userCollections.empty')}</Alert>
          ) : (
            <Grid container spacing={2}>
              {myCollections.map((collection) => renderCollectionCard(collection, false, true))}
            </Grid>
          )}
        </>
      )}

      {tabIndex === 1 && (
        <>
          {publicCollections.length === 0 ? (
            <Alert severity="info">{t('userCollections.emptyPublic')}</Alert>
          ) : (
            <Grid container spacing={2}>
              {publicCollections.map((collection) => renderCollectionCard(collection, true, false))}
            </Grid>
          )}
        </>
      )}

      <CreateCollectionDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onCreate={handleCreateCollection}
      />

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>{t('userCollections.delete')}</DialogTitle>
        <DialogContent>
          <Typography>{t('userCollections.confirmDelete')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleDeleteConfirm} color="error">
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
