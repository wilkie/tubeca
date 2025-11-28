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
  Breadcrumbs,
  Link,
} from '@mui/material';
import { Folder, VideoFile, AudioFile } from '@mui/icons-material';
import { apiClient, type Collection } from '../api/client';

interface MediaItem {
  id: string;
  name: string;
  type: 'Video' | 'Audio';
}

interface BreadcrumbItem {
  id: string;
  name: string;
  type: 'library' | 'collection';
}

export function CollectionPage() {
  const { t } = useTranslation();
  const { collectionId } = useParams<{ collectionId: string }>();
  const navigate = useNavigate();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);

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

  const childCollections = collection.children || [];
  const media = (collection.media || []) as MediaItem[];

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

      <Typography variant="h4" component="h1" sx={{ mb: 3 }}>
        {collection.name}
      </Typography>

      {childCollections.length === 0 && media.length === 0 ? (
        <Alert severity="info">{t('collection.empty')}</Alert>
      ) : (
        <Grid container spacing={2}>
          {/* Child collections (folders) */}
          {childCollections.map((child) => (
            <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={child.id}>
              <Card>
                <CardActionArea onClick={() => handleCollectionClick(child.id)}>
                  <CardContent sx={{ textAlign: 'center' }}>
                    <Folder sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
                    <Typography variant="body2" noWrap title={child.name}>
                      {child.name}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}

          {/* Media items */}
          {media.map((item) => (
            <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={item.id}>
              <Card>
                <CardActionArea onClick={() => handleMediaClick(item.id)}>
                  <CardContent sx={{ textAlign: 'center' }}>
                    {item.type === 'Video' ? (
                      <VideoFile sx={{ fontSize: 48, color: 'secondary.main', mb: 1 }} />
                    ) : (
                      <AudioFile sx={{ fontSize: 48, color: 'secondary.main', mb: 1 }} />
                    )}
                    <Typography variant="body2" noWrap title={item.name}>
                      {item.name}
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
