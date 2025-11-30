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
  Chip,
  Paper,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Link,
} from '@mui/material';
import {
  Person,
  Tv,
  Movie,
  PlayArrow,
  CalendarMonth,
  LocationOn,
  MoreVert,
  Refresh,
  OpenInNew,
} from '@mui/icons-material';
import {
  apiClient,
  type PersonWithFilmography,
} from '../api/client';
import { useAuth } from '../context/AuthContext';

function formatDate(dateString: string | null): string | null {
  if (!dateString) return null;
  try {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateString;
  }
}

function calculateAge(birthDate: string | null, deathDate: string | null): number | null {
  if (!birthDate) return null;

  const birth = new Date(birthDate);
  const end = deathDate ? new Date(deathDate) : new Date();

  let age = end.getFullYear() - birth.getFullYear();
  const monthDiff = end.getMonth() - birth.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && end.getDate() < birth.getDate())) {
    age--;
  }

  return age;
}

// Credit type display order and labels
const CREDIT_TYPE_ORDER = ['Actor', 'Director', 'Writer', 'Producer', 'Composer', 'Cinematographer', 'Editor'];

function getCreditTypeLabel(creditType: string): string {
  const labels: Record<string, string> = {
    Actor: 'Acting',
    Director: 'Directing',
    Writer: 'Writing',
    Producer: 'Producing',
    Composer: 'Music',
    Cinematographer: 'Cinematography',
    Editor: 'Editing',
  };
  return labels[creditType] || creditType;
}

interface CreditGroup<T> {
  creditType: string;
  items: T[];
}

function groupByCreditType<T extends { credit: { creditType: string } }>(items: T[]): CreditGroup<T>[] {
  const groups: Record<string, T[]> = {};

  for (const item of items) {
    const type = item.credit.creditType;
    if (!groups[type]) {
      groups[type] = [];
    }
    groups[type].push(item);
  }

  // Sort by defined order, unknown types go last
  return Object.entries(groups)
    .sort(([a], [b]) => {
      const aIndex = CREDIT_TYPE_ORDER.indexOf(a);
      const bIndex = CREDIT_TYPE_ORDER.indexOf(b);
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    })
    .map(([creditType, items]) => ({ creditType, items }));
}

export function PersonPage() {
  const { t } = useTranslation();
  const { personId } = useParams<{ personId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [person, setPerson] = useState<PersonWithFilmography | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);

  // Menu state
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(menuAnchorEl);

  useEffect(() => {
    if (!personId) return;

    let cancelled = false;
    const id = personId; // Capture for use in async function

    async function loadPerson() {
      setIsLoading(true);
      setError(null);

      const response = await apiClient.getPerson(id);
      if (cancelled) return;

      if (response.error) {
        setError(response.error);
      } else if (response.data) {
        setPerson(response.data.person);
      }

      setIsLoading(false);
    }

    loadPerson();

    return () => {
      cancelled = true;
    };
  }, [personId]);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setMenuAnchorEl(null);
  };

  const handleRefreshMetadata = async () => {
    handleMenuClose();
    if (!personId) return;

    setIsRefreshing(true);
    const response = await apiClient.refreshPersonMetadata(personId);
    if (response.error) {
      setError(response.error);
    } else if (response.data) {
      setPerson(response.data.person);
    }
    setIsRefreshing(false);
  };

  const handleShowClick = (collectionId: string) => {
    navigate(`/collection/${collectionId}`);
  };

  const handleFilmClick = (collectionId: string) => {
    navigate(`/collection/${collectionId}`);
  };

  const handleEpisodeClick = (mediaId: string) => {
    navigate(`/media/${mediaId}`);
  };

  const canEdit = user?.role === 'Admin' || user?.role === 'Editor';

  if (isLoading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4, textAlign: 'center' }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }}>{t('common.loading', 'Loading...')}</Typography>
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

  if (!person) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="warning">{t('person.notFound', 'Person not found')}</Alert>
      </Container>
    );
  }

  const primaryImage = person.images?.find((img) => img.isPrimary && img.imageType === 'Photo');
  const age = calculateAge(person.birthDate, person.deathDate);

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Header with person info */}
      <Box sx={{ display: 'flex', gap: 4, mb: 4 }}>
        {/* Photo */}
        <Box sx={{ flexShrink: 0 }}>
          {primaryImage ? (
            <CardMedia
              component="img"
              image={apiClient.getImageUrl(primaryImage.id)}
              alt={person.name}
              sx={{
                width: 200,
                height: 300,
                objectFit: 'cover',
                borderRadius: 2,
              }}
            />
          ) : (
            <Box
              sx={{
                width: 200,
                height: 300,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'action.hover',
                borderRadius: 2,
              }}
            >
              <Person sx={{ fontSize: 96, color: 'text.secondary' }} />
            </Box>
          )}
        </Box>

        {/* Info */}
        <Box sx={{ flexGrow: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Typography variant="h4" component="h1" gutterBottom>
              {person.name}
            </Typography>
            {canEdit && (
              <IconButton
                onClick={handleMenuOpen}
                aria-label={t('common.moreOptions', 'More options')}
                disabled={isRefreshing}
              >
                {isRefreshing ? <CircularProgress size={24} /> : <MoreVert />}
              </IconButton>
            )}
          </Box>

          {/* Known for */}
          {person.knownFor && (
            <Chip label={person.knownFor} size="small" sx={{ mb: 2 }} />
          )}

          {/* Birth/Death info */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 2 }}>
            {person.birthDate && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CalendarMonth sx={{ fontSize: 18, color: 'text.secondary' }} />
                <Typography variant="body2">
                  {t('person.born', 'Born')}: {formatDate(person.birthDate)}
                  {age && !person.deathDate && ` (${t('person.age', 'age')} ${age})`}
                </Typography>
              </Box>
            )}
            {person.deathDate && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CalendarMonth sx={{ fontSize: 18, color: 'text.secondary' }} />
                <Typography variant="body2">
                  {t('person.died', 'Died')}: {formatDate(person.deathDate)}
                  {age && ` (${t('person.age', 'age')} ${age})`}
                </Typography>
              </Box>
            )}
            {person.birthPlace && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <LocationOn sx={{ fontSize: 18, color: 'text.secondary' }} />
                <Typography variant="body2">{person.birthPlace}</Typography>
              </Box>
            )}
          </Box>

          {/* External links */}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
            {person.imdbId && (
              <Chip
                label="IMDb"
                size="small"
                clickable
                component="a"
                href={`https://www.imdb.com/name/${person.imdbId}`}
                target="_blank"
                rel="noopener noreferrer"
                icon={<OpenInNew sx={{ fontSize: 14 }} />}
                variant="outlined"
              />
            )}
            {person.tmdbId && (
              <Chip
                label="TMDB"
                size="small"
                clickable
                component="a"
                href={`https://www.themoviedb.org/person/${person.tmdbId}`}
                target="_blank"
                rel="noopener noreferrer"
                icon={<OpenInNew sx={{ fontSize: 14 }} />}
                variant="outlined"
              />
            )}
            {person.tvdbId && (
              <Chip
                label="TVDB"
                size="small"
                clickable
                component="a"
                href={`https://thetvdb.com/people/${person.tvdbId}`}
                target="_blank"
                rel="noopener noreferrer"
                icon={<OpenInNew sx={{ fontSize: 14 }} />}
                variant="outlined"
              />
            )}
          </Box>

          {/* Biography */}
          {person.biography && (
            <Box>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  whiteSpace: 'pre-line',
                  ...(bioExpanded ? {} : {
                    display: '-webkit-box',
                    WebkitLineClamp: 5,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }),
                }}
              >
                {person.biography}
              </Typography>
              {person.biography.length > 400 && (
                <Link
                  component="button"
                  variant="body2"
                  onClick={() => setBioExpanded(!bioExpanded)}
                  sx={{ mt: 0.5 }}
                >
                  {bioExpanded ? t('common.showLess', 'Show less') : t('common.showMore', 'Show more...')}
                </Link>
              )}
            </Box>
          )}
        </Box>
      </Box>

      {/* Shows */}
      {person.filmography.shows.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h5" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Tv />
            {t('person.shows', 'Shows')} ({person.filmography.shows.length})
          </Typography>
          {groupByCreditType(person.filmography.shows).map((group) => (
            <Box key={group.creditType} sx={{ mb: 3 }}>
              <Typography variant="h6" color="text.secondary" sx={{ mb: 1.5 }}>
                {getCreditTypeLabel(group.creditType)} ({group.items.length})
              </Typography>
              <Grid container spacing={2}>
                {group.items.map((show) => {
                  const showImage = show.collection.images?.[0];

                  return (
                    <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={show.credit.id}>
                      <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <CardActionArea
                          onClick={() => handleShowClick(show.collection.id)}
                          sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                        >
                          {showImage ? (
                            <CardMedia
                              component="img"
                              image={apiClient.getImageUrl(showImage.id)}
                              alt={show.collection.name}
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
                              <Tv sx={{ fontSize: 64, color: 'text.secondary' }} />
                            </Box>
                          )}
                          <CardContent sx={{ textAlign: 'center', py: 1, flexGrow: 1 }}>
                            <Typography variant="body2" noWrap title={show.collection.name}>
                              {show.collection.name}
                            </Typography>
                            {show.credit.role && (
                              <Typography variant="caption" color="text.secondary" noWrap title={show.credit.role}>
                                {show.credit.role}
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
          ))}
        </Box>
      )}

      {/* Films */}
      {person.filmography.films.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h5" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Movie />
            {t('person.films', 'Films')} ({person.filmography.films.length})
          </Typography>
          {groupByCreditType(person.filmography.films).map((group) => (
            <Box key={group.creditType} sx={{ mb: 3 }}>
              <Typography variant="h6" color="text.secondary" sx={{ mb: 1.5 }}>
                {getCreditTypeLabel(group.creditType)} ({group.items.length})
              </Typography>
              <Grid container spacing={2}>
                {group.items.map((film) => {
                  const filmImage = film.collection.images?.[0];

                  return (
                    <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={film.credit.id}>
                      <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <CardActionArea
                          onClick={() => handleFilmClick(film.collection.id)}
                          sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                        >
                          {filmImage ? (
                            <CardMedia
                              component="img"
                              image={apiClient.getImageUrl(filmImage.id)}
                              alt={film.collection.name}
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
                              <Movie sx={{ fontSize: 64, color: 'text.secondary' }} />
                            </Box>
                          )}
                          <CardContent sx={{ textAlign: 'center', py: 1, flexGrow: 1 }}>
                            <Typography variant="body2" noWrap title={film.collection.name}>
                              {film.collection.name}
                            </Typography>
                            {film.credit.role && (
                              <Typography variant="caption" color="text.secondary" noWrap title={film.credit.role}>
                                {film.credit.role}
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
          ))}
        </Box>
      )}

      {/* Episodes (Guest appearances) */}
      {person.filmography.episodes.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h5" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <PlayArrow />
            {t('person.episodes', 'Episode Appearances')} ({person.filmography.episodes.length})
          </Typography>
          {groupByCreditType(person.filmography.episodes).map((group) => (
            <Box key={group.creditType} sx={{ mb: 3 }}>
              <Typography variant="h6" color="text.secondary" sx={{ mb: 1.5 }}>
                {getCreditTypeLabel(group.creditType)} ({group.items.length})
              </Typography>
              <Paper variant="outlined">
                {group.items.map((ep, index) => {
                  const episodeImage = ep.media.images?.[0];

                  return (
                    <Box key={ep.credit.id}>
                      {index > 0 && <Divider />}
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'stretch',
                          cursor: 'pointer',
                          '&:hover': { bgcolor: 'action.hover' },
                        }}
                        onClick={() => handleEpisodeClick(ep.media.id)}
                      >
                        {/* Thumbnail */}
                        {episodeImage ? (
                          <CardMedia
                            component="img"
                            image={apiClient.getImageUrl(episodeImage.id)}
                            alt={ep.media.name}
                            sx={{
                              width: 120,
                              objectFit: 'cover',
                              flexShrink: 0,
                            }}
                          />
                        ) : (
                          <Box
                            sx={{
                              width: 120,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              bgcolor: 'action.hover',
                              flexShrink: 0,
                            }}
                          >
                            <PlayArrow sx={{ fontSize: 32, color: 'text.secondary' }} />
                          </Box>
                        )}
                        {/* Episode info */}
                        <Box sx={{ flexGrow: 1, minWidth: 0, p: 2, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                          <Typography variant="body1" noWrap>
                            {ep.media.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {ep.media.videoDetails?.showName || ep.media.collection?.parent?.name || ep.media.collection?.name}
                            {ep.media.videoDetails?.season != null && ep.media.videoDetails?.episode != null && (
                              <> - S{ep.media.videoDetails.season.toString().padStart(2, '0')}E{ep.media.videoDetails.episode.toString().padStart(2, '0')}</>
                            )}
                          </Typography>
                        </Box>
                        {/* Role */}
                        <Box sx={{ textAlign: 'right', flexShrink: 0, p: 2, display: 'flex', alignItems: 'center' }}>
                          {ep.credit.role && (
                            <Typography variant="body2" color="text.secondary">
                              {ep.credit.role}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    </Box>
                  );
                })}
              </Paper>
            </Box>
          ))}
        </Box>
      )}

      {/* Actions Menu */}
      <Menu
        id="person-menu"
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
        <MenuItem onClick={handleRefreshMetadata} disabled={isRefreshing}>
          <ListItemIcon>
            <Refresh fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('person.refreshMetadata', 'Refresh Metadata')}</ListItemText>
        </MenuItem>
      </Menu>
    </Container>
  );
}
