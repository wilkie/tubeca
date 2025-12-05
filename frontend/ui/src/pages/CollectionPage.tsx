import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Container, CircularProgress, Alert } from '@mui/material';
import { apiClient, type Collection, type CollectionType, type Image, type Credit } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { usePlayer } from '../context/PlayerContext';
import { ImagesDialog } from '../components/ImagesDialog';
import { CollectionBreadcrumbs, type BreadcrumbItem } from '../components/CollectionBreadcrumbs';
import { StickyHeroBreadcrumbs } from '../components/StickyHeroBreadcrumbs';
import { CollectionOptionsMenu } from '../components/CollectionOptionsMenu';
import { DeleteCollectionDialog } from '../components/DeleteCollectionDialog';
import { FilmHeroView } from '../components/FilmHeroView';
import { ShowHeroView } from '../components/ShowHeroView';
import { StandardCollectionView } from '../components/StandardCollectionView';
import { AddToCollectionDialog } from '../components/AddToCollectionDialog';

interface CreditWithPerson extends Credit {
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

export function CollectionPage() {
  const { t } = useTranslation();
  const { collectionId } = useParams<{ collectionId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { playMedia } = usePlayer();
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

  // Refresh states
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRefreshingImages, setIsRefreshingImages] = useState(false);

  // Add to collection dialog state
  const [addToCollectionOpen, setAddToCollectionOpen] = useState(false);
  const [selectedChildForAdd, setSelectedChildForAdd] = useState<{ id: string; name: string } | null>(null);

  const canEdit = user?.role === 'Admin' || user?.role === 'Editor';

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

        if (result.data.collection.library) {
          crumbs.push({
            id: result.data.collection.library.id,
            name: result.data.collection.library.name,
            type: 'library',
          });
        }

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

  const handleRefreshMetadata = async () => {
    if (!collection) return;
    handleMenuClose();
    setIsRefreshing(true);
    try {
      await apiClient.refreshCollectionMetadata(collection.id);
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
    } catch (error) {
      console.error('Failed to queue image refresh:', error);
    } finally {
      setIsRefreshingImages(false);
    }
  };

  const handleDeleteClick = () => {
    handleMenuClose();
    setDeleteDialogOpen(true);
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

    if (collection.library) {
      navigate(`/library/${collection.library.id}`);
    } else {
      navigate('/');
    }
  };

  const handleBreadcrumbNavigate = (item: BreadcrumbItem) => {
    if (item.type === 'library') {
      navigate(`/library/${item.id}`);
    } else {
      navigate(`/collection/${item.id}`);
    }
  };

  const handleCollectionClick = (id: string) => {
    navigate(`/collection/${id}`);
  };

  const handleMediaClick = (mediaId: string) => {
    navigate(`/media/${mediaId}`);
  };

  const handlePlay = async (mediaId: string) => {
    // Set the playback queue to just this item before navigating
    await apiClient.setPlaybackQueue([{ mediaId }]);
    navigate(`/play/${mediaId}`);
  };

  const handlePlayAfter = async (mediaId: string) => {
    // Add to the playback queue without navigating
    await apiClient.addToPlaybackQueue({ mediaId });
  };

  const handlePlayInMiniPlayer = async (mediaId: string) => {
    // Set the playback queue and start playback in mini player (don't navigate)
    await apiClient.setPlaybackQueue([{ mediaId }]);
    playMedia(mediaId);
  };

  const handlePersonClick = (personId: string) => {
    navigate(`/person/${personId}`);
  };

  const handleAddToCollection = () => {
    setSelectedChildForAdd(null);
    setAddToCollectionOpen(true);
  };

  const handleAddChildToCollection = (child: { id: string; name: string }) => {
    setSelectedChildForAdd(child);
    setAddToCollectionOpen(true);
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

  const isFilmLibrary = collection.library?.libraryType === 'Film';
  const isShow = collection.collectionType === 'Show';
  const primaryMedia = rawMedia.length > 0 ? rawMedia[0] : null;

  // Determine which view to render
  const renderView = () => {
    if (isFilmLibrary && primaryMedia) {
      return (
        <FilmHeroView
          collection={collection}
          primaryMedia={primaryMedia}
          additionalMedia={rawMedia.slice(1)}
          breadcrumbs={breadcrumbs}
          menuOpen={menuOpen}
          onBreadcrumbNavigate={handleBreadcrumbNavigate}
          onPlay={handlePlay}
          onPlayAfter={handlePlayAfter}
          onPlayInMiniPlayer={handlePlayInMiniPlayer}
          onMediaClick={handleMediaClick}
          onPersonClick={handlePersonClick}
          onMenuOpen={handleMenuOpen}
          onAddToCollection={handleAddToCollection}
        />
      );
    }

    if (isShow) {
      return (
        <ShowHeroView
          collection={collection}
          seasons={childCollections}
          breadcrumbs={breadcrumbs}
          menuOpen={menuOpen}
          onBreadcrumbNavigate={handleBreadcrumbNavigate}
          onPlay={handlePlay}
          onPlayAfter={handlePlayAfter}
          onPlayInMiniPlayer={handlePlayInMiniPlayer}
          onSeasonClick={handleCollectionClick}
          onPersonClick={handlePersonClick}
          onMenuOpen={handleMenuOpen}
          onAddToCollection={handleAddToCollection}
          onAddSeasonToCollection={handleAddChildToCollection}
        />
      );
    }

    // Standard view for Season, Album, Artist, etc.
    const isSeason = collection.collectionType === 'Season';

    return (
      <>
        {/* Sticky breadcrumbs for Season, regular for others */}
        {isSeason ? (
          <StickyHeroBreadcrumbs
            breadcrumbs={breadcrumbs}
            currentName={collection.name}
            onNavigate={handleBreadcrumbNavigate}
            variant="standard"
          />
        ) : (
          <CollectionBreadcrumbs
            breadcrumbs={breadcrumbs}
            currentName={collection.name}
            onNavigate={handleBreadcrumbNavigate}
            sx={{ mb: 2 }}
          />
        )}

        <StandardCollectionView
          collection={collection}
          childCollections={childCollections}
          media={rawMedia}
          menuOpen={menuOpen}
          onCollectionClick={handleCollectionClick}
          onMediaClick={handleMediaClick}
          onMenuOpen={handleMenuOpen}
          onAddToCollection={handleAddToCollection}
        />
      </>
    );
  };

  return (
    <Container maxWidth={false} sx={{ py: 4 }}>
      {renderView()}

      {/* Shared Dialogs and Menus */}
      <CollectionOptionsMenu
        anchorEl={menuAnchorEl}
        open={menuOpen}
        onClose={handleMenuClose}
        onImagesClick={handleImagesClick}
        onRefreshMetadata={handleRefreshMetadata}
        onRefreshImages={handleRefreshImages}
        onDeleteClick={handleDeleteClick}
        canEdit={canEdit}
        isRefreshing={isRefreshing}
        isRefreshingImages={isRefreshingImages}
      />

      <DeleteCollectionDialog
        open={deleteDialogOpen}
        collectionName={collection.name}
        isDeleting={isDeleting}
        onCancel={() => setDeleteDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
      />

      <ImagesDialog
        open={imagesDialogOpen}
        onClose={() => setImagesDialogOpen(false)}
        images={collection.images || []}
        title={t('collection.imagesTitle', 'Collection Images')}
      />

      <AddToCollectionDialog
        open={addToCollectionOpen}
        onClose={() => {
          setAddToCollectionOpen(false);
          setSelectedChildForAdd(null);
        }}
        collectionId={selectedChildForAdd?.id ?? collection.id}
        itemName={selectedChildForAdd?.name ?? collection.name}
      />
    </Container>
  );
}
