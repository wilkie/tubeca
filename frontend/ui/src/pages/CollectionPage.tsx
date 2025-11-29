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
  Chip,
} from '@mui/material';
import { Folder, VideoFile, AudioFile, Tv, Person, Album } from '@mui/icons-material';
import { apiClient, type Collection, type CollectionType } from '../api/client';

interface MediaItem {
  id: string;
  name: string;
  type: 'Video' | 'Audio';
  videoDetails?: {
    season: number | null;
    episode: number | null;
  } | null;
  audioDetails?: {
    track: number | null;
    disc: number | null;
  } | null;
}

interface ChildCollection {
  id: string;
  name: string;
  collectionType?: CollectionType;
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

  const childCollections = (collection.children || []) as ChildCollection[];
  const rawMedia = (collection.media || []) as MediaItem[];

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

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
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
                {childCollections.map((child) => (
                  <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={child.id}>
                    <Card>
                      <CardActionArea onClick={() => handleCollectionClick(child.id)}>
                        <CardContent sx={{ textAlign: 'center' }}>
                          {getCollectionIcon(child.collectionType)}
                          <Typography variant="body2" noWrap title={child.name}>
                            {child.name}
                          </Typography>
                        </CardContent>
                      </CardActionArea>
                    </Card>
                  </Grid>
                ))}
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

                  return (
                    <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={item.id}>
                      <Card>
                        <CardActionArea onClick={() => handleMediaClick(item.id)}>
                          <CardContent sx={{ textAlign: 'center' }}>
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
    </Container>
  );
}
