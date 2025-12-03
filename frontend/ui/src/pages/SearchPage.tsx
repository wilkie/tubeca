import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Container,
  Typography,
  TextField,
  InputAdornment,
  CircularProgress,
  Alert,
  Grid,
  Card,
  CardContent,
  CardActionArea,
  CardMedia,
  Divider,
} from '@mui/material';
import { Search, Folder, VideoFile, AudioFile } from '@mui/icons-material';
import { apiClient, type Collection, type Media } from '../api/client';

export function SearchPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';

  const [query, setQuery] = useState(initialQuery);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Track the last searched query to avoid re-searching
  const lastSearchedQuery = useRef<string>('');

  // Perform search when query param changes (e.g., from URL or initial load)
  useEffect(() => {
    const searchQuery = initialQuery.trim();

    // Skip if empty or already searched this query
    if (!searchQuery || searchQuery === lastSearchedQuery.current) {
      return;
    }

    let cancelled = false;
    lastSearchedQuery.current = searchQuery;

    async function doSearch() {
      setIsLoading(true);
      setError(null);
      setHasSearched(true);

      const result = await apiClient.search(searchQuery);

      if (cancelled) return;

      if (result.error) {
        setError(result.error);
        setCollections([]);
        setMedia([]);
      } else if (result.data) {
        setCollections(result.data.collections);
        setMedia(result.data.media);
      }

      setIsLoading(false);
    }

    doSearch();

    return () => {
      cancelled = true;
    };
  }, [initialQuery]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      // Reset last searched so the effect will trigger
      lastSearchedQuery.current = '';
      setSearchParams({ q: query.trim() });
    }
  };

  const handleCollectionClick = (collectionId: string) => {
    navigate(`/collection/${collectionId}`);
  };

  const handleMediaClick = (mediaId: string) => {
    navigate(`/media/${mediaId}`);
  };

  const totalResults = collections.length + media.length;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" sx={{ mb: 3 }}>
        {t('search.title')}
      </Typography>

      <Box component="form" onSubmit={handleSearchSubmit} sx={{ mb: 4 }}>
        <TextField
          fullWidth
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('search.placeholder')}
          autoFocus
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search />
                </InputAdornment>
              ),
            },
          }}
        />
      </Box>

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {!isLoading && hasSearched && totalResults === 0 && (
        <Alert severity="info">{t('search.noResults')}</Alert>
      )}

      {!isLoading && collections.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {t('search.collections')} ({collections.length})
          </Typography>
          <Grid container spacing={2}>
            {collections.map((collection) => {
              const primaryImage = collection.images?.[0];
              const hasImage = primaryImage != null;

              return (
                <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={collection.id}>
                  <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <CardActionArea
                      onClick={() => handleCollectionClick(collection.id)}
                      sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                    >
                      {hasImage ? (
                        <>
                          <CardMedia
                            component="img"
                            image={apiClient.getImageUrl(primaryImage.id)}
                            alt={collection.name}
                            sx={{
                              aspectRatio: '2/3',
                              objectFit: 'cover',
                            }}
                          />
                          <CardContent sx={{ textAlign: 'center', py: 1 }}>
                            <Typography variant="body2" noWrap title={collection.name}>
                              {collection.name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {collection.library?.name}
                            </Typography>
                          </CardContent>
                        </>
                      ) : (
                        <CardContent sx={{ textAlign: 'center', flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                          <Folder sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
                          <Typography variant="body2" noWrap title={collection.name}>
                            {collection.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {collection.library?.name}
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

      {!isLoading && collections.length > 0 && media.length > 0 && (
        <Divider sx={{ my: 3 }} />
      )}

      {!isLoading && media.length > 0 && (
        <Box>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {t('search.media')} ({media.length})
          </Typography>
          <Grid container spacing={2}>
            {media.map((item) => {
              const primaryImage = item.images?.[0];
              const hasImage = primaryImage != null;

              // Build subtitle showing show/season/episode info
              let subtitle = '';
              if (item.videoDetails) {
                const { season, episode } = item.videoDetails;
                if (season != null && episode != null) {
                  subtitle = `S${season}E${episode}`;
                }
              } else if (item.audioDetails) {
                const { track, disc } = item.audioDetails;
                if (disc != null && track != null) {
                  subtitle = `Disc ${disc}, Track ${track}`;
                } else if (track != null) {
                  subtitle = `Track ${track}`;
                }
              }

              // Add collection/show name
              if (item.collection) {
                const collectionName = item.collection.parent?.name || item.collection.name;
                if (subtitle) {
                  subtitle = `${collectionName} - ${subtitle}`;
                } else {
                  subtitle = collectionName;
                }
              }

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
                            <Typography variant="body2" noWrap title={item.name}>
                              {item.name}
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
                          {item.type === 'Video' ? (
                            <VideoFile sx={{ fontSize: 48, color: 'secondary.main', mb: 1 }} />
                          ) : (
                            <AudioFile sx={{ fontSize: 48, color: 'secondary.main', mb: 1 }} />
                          )}
                          <Typography variant="body2" noWrap title={item.name}>
                            {item.name}
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
        </Box>
      )}
    </Container>
  );
}
