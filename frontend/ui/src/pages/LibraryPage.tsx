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
} from '@mui/material';
import { Folder, VideoFile, AudioFile } from '@mui/icons-material';
import { apiClient, type Library, type Collection } from '../api/client';

interface MediaItem {
  id: string;
  name: string;
  type: 'Video' | 'Audio';
}

export function LibraryPage() {
  const { t } = useTranslation();
  const { libraryId } = useParams<{ libraryId: string }>();
  const navigate = useNavigate();
  const [library, setLibrary] = useState<Library | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!libraryId) return;

    let cancelled = false;

    async function fetchData() {
      setIsLoading(true);
      setError(null);

      // Fetch library details
      const libraryResult = await apiClient.getLibrary(libraryId!);
      if (cancelled) return;

      if (libraryResult.error) {
        setError(libraryResult.error);
        setIsLoading(false);
        return;
      }

      if (libraryResult.data) {
        setLibrary(libraryResult.data.library);
      }

      // Fetch collections for this library
      const collectionsResult = await apiClient.getCollectionsByLibrary(libraryId!);
      if (cancelled) return;

      if (collectionsResult.error) {
        setError(collectionsResult.error);
      } else if (collectionsResult.data) {
        // Filter to only root collections (no parent)
        const rootCollections = collectionsResult.data.collections.filter(
          (c) => c.parentId === null
        );
        setCollections(rootCollections);
      }

      setIsLoading(false);
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [libraryId]);

  const handleCollectionClick = (collectionId: string) => {
    navigate(`/collection/${collectionId}`);
  };

  const handleMediaClick = (mediaId: string) => {
    navigate(`/media/${mediaId}`);
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

  if (!library) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="warning">{t('library.notFound')}</Alert>
      </Container>
    );
  }

  // Get media items from collections that have collectionId === null (root level media)
  // For now, we'll show collections. Media at root level would need a separate API call.
  const rootMedia: MediaItem[] = [];

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" sx={{ mb: 3 }}>
        {library.name}
      </Typography>

      {collections.length === 0 && rootMedia.length === 0 ? (
        <Alert severity="info">{t('library.empty')}</Alert>
      ) : (
        <Grid container spacing={2}>
          {/* Collections (folders) */}
          {collections.map((collection) => (
            <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={collection.id}>
              <Card>
                <CardActionArea onClick={() => handleCollectionClick(collection.id)}>
                  <CardContent sx={{ textAlign: 'center' }}>
                    <Folder sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
                    <Typography variant="body2" noWrap title={collection.name}>
                      {collection.name}
                    </Typography>
                    {collection._count && (
                      <Typography variant="caption" color="text.secondary">
                        {collection._count.children > 0 &&
                          t('library.folders', { count: collection._count.children })}
                        {collection._count.children > 0 && collection._count.media > 0 && ' | '}
                        {collection._count.media > 0 &&
                          t('library.items', { count: collection._count.media })}
                      </Typography>
                    )}
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}

          {/* Media items */}
          {rootMedia.map((media) => (
            <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={media.id}>
              <Card>
                <CardActionArea onClick={() => handleMediaClick(media.id)}>
                  <CardContent sx={{ textAlign: 'center' }}>
                    {media.type === 'Video' ? (
                      <VideoFile sx={{ fontSize: 48, color: 'secondary.main', mb: 1 }} />
                    ) : (
                      <AudioFile sx={{ fontSize: 48, color: 'secondary.main', mb: 1 }} />
                    )}
                    <Typography variant="body2" noWrap title={media.name}>
                      {media.name}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Container>
  );
}
