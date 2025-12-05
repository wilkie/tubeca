import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  CardActionArea,
  CardMedia,
  Paper,
  Button,
  IconButton,
  Link,
  Chip,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  ListSubheader,
} from '@mui/material';
import { Star, PlayArrow, MoreVert, VideoFile, Add, FolderSpecial, ArrowDropDown, QueuePlayNext, PictureInPictureAlt } from '@mui/icons-material';
import { apiClient, type Collection, type Image, type FilmCredit, type UserCollection } from '../api/client';
import { formatDuration } from '../utils/format';
import { HeroSection, HeroPoster, HeroLogo } from './HeroSection';
import { CollectionBreadcrumbs, type BreadcrumbItem } from './CollectionBreadcrumbs';
import { CastCrewGrid } from './CastCrewGrid';
import { FavoriteButton } from './FavoriteButton';
import { WatchLaterButton } from './WatchLaterButton';

interface FilmCreditWithPerson extends FilmCredit {
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
  images?: Image[];
}

interface FilmHeroViewProps {
  collection: Collection;
  primaryMedia: MediaItem;
  additionalMedia: MediaItem[];
  breadcrumbs: BreadcrumbItem[];
  menuOpen: boolean;
  onBreadcrumbNavigate: (item: BreadcrumbItem) => void;
  onPlay: (mediaId: string) => void;
  onPlayAfter?: (mediaId: string) => void;
  onPlayInMiniPlayer?: (mediaId: string) => void;
  onMediaClick: (mediaId: string) => void;
  onPersonClick: (personId: string) => void;
  onMenuOpen: (event: React.MouseEvent<HTMLElement>) => void;
  onAddToCollection?: () => void;
}

export function FilmHeroView({
  collection,
  primaryMedia,
  additionalMedia,
  breadcrumbs,
  menuOpen,
  onBreadcrumbNavigate,
  onPlay,
  onPlayAfter,
  onPlayInMiniPlayer,
  onMediaClick,
  onPersonClick,
  onMenuOpen,
  onAddToCollection,
}: FilmHeroViewProps) {
  const { t } = useTranslation();
  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);
  const addMenuOpen = Boolean(addMenuAnchor);
  const [recentCollection, setRecentCollection] = useState<UserCollection | null>(null);
  const [isAddingToRecent, setIsAddingToRecent] = useState(false);
  const [playMenuAnchor, setPlayMenuAnchor] = useState<null | HTMLElement>(null);
  const playMenuOpen = Boolean(playMenuAnchor);

  // Fetch most recent user collection when menu opens
  useEffect(() => {
    if (addMenuOpen) {
      apiClient.getUserCollections().then((result) => {
        if (result.data && result.data.userCollections.length > 0) {
          // Collections are already sorted by updatedAt desc from the API
          setRecentCollection(result.data.userCollections[0]);
        }
      });
    }
  }, [addMenuOpen]);

  const handleAddMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    setAddMenuAnchor(event.currentTarget);
  };

  const handleAddMenuClose = () => {
    setAddMenuAnchor(null);
  };

  const handleAddToCollection = () => {
    handleAddMenuClose();
    onAddToCollection?.();
  };

  const handleQuickAddToRecent = async () => {
    if (!recentCollection) return;
    setIsAddingToRecent(true);
    try {
      await apiClient.addUserCollectionItem(recentCollection.id, { collectionId: collection.id });
    } catch (error) {
      console.error('Failed to add to collection:', error);
    } finally {
      setIsAddingToRecent(false);
      handleAddMenuClose();
    }
  };

  const backdropImage = collection.images?.find((img) => img.imageType === 'Backdrop');
  const posterImage = collection.images?.find((img) => img.imageType === 'Poster');
  const logoImage = collection.images?.find((img) => img.imageType === 'Logo');

  const filmDetails = collection.filmDetails;
  const credits = (filmDetails?.credits || []) as FilmCreditWithPerson[];

  return (
    <>
      <HeroSection backdropImageId={backdropImage?.id}>
        {/* Breadcrumbs at top */}
        <Box sx={{ position: 'relative', zIndex: 2, px: 3, pt: 2 }}>
          <CollectionBreadcrumbs
            breadcrumbs={breadcrumbs}
            currentName={collection.name}
            onNavigate={onBreadcrumbNavigate}
            variant="hero"
          />
        </Box>

        {/* Description Card */}
        {(filmDetails?.description || credits.length > 0) && (
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
              {filmDetails?.description && (
                <Typography
                  variant="body1"
                  sx={{
                    color: 'grey.200',
                    mb: credits.length > 0 ? 2 : 0,
                    display: '-webkit-box',
                    WebkitLineClamp: 6,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {filmDetails.description}
                </Typography>
              )}

              {/* Credits Summary */}
              {credits.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {/* Directors */}
                  {credits.filter((c) => c.creditType === 'Director').length > 0 && (
                    <Box>
                      <Typography variant="caption" sx={{ color: 'grey.400' }}>
                        {t('media.director', 'Director')}
                      </Typography>
                      <Typography variant="body2" component="div" sx={{ color: 'grey.200' }}>
                        {credits
                          .filter((c) => c.creditType === 'Director')
                          .map((c, index, arr) => (
                            <span key={c.id}>
                              {c.personId ? (
                                <Link
                                  component="button"
                                  variant="body2"
                                  onClick={() => onPersonClick(c.personId!)}
                                  sx={{ color: 'grey.200', '&:hover': { color: 'white' } }}
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
                  {credits.filter((c) => c.creditType === 'Writer').length > 0 && (
                    <Box>
                      <Typography variant="caption" sx={{ color: 'grey.400' }}>
                        {t('media.writer', 'Writer')}
                      </Typography>
                      <Typography variant="body2" component="div" sx={{ color: 'grey.200' }}>
                        {credits
                          .filter((c) => c.creditType === 'Writer')
                          .map((c, index, arr) => (
                            <span key={c.id}>
                              {c.personId ? (
                                <Link
                                  component="button"
                                  variant="body2"
                                  onClick={() => onPersonClick(c.personId!)}
                                  sx={{ color: 'grey.200', '&:hover': { color: 'white' } }}
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
                  {credits.filter((c) => c.creditType === 'Actor').length > 0 && (
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
                        {credits
                          .filter((c) => c.creditType === 'Actor')
                          .slice(0, 10)
                          .map((c, index, arr) => (
                            <span key={c.id}>
                              {c.personId ? (
                                <Link
                                  component="button"
                                  variant="body2"
                                  onClick={() => onPersonClick(c.personId!)}
                                  sx={{ color: 'grey.200', '&:hover': { color: 'white' } }}
                                >
                                  {c.role ? `${c.name} (${c.role})` : c.name}
                                </Link>
                              ) : c.role ? (
                                `${c.name} (${c.role})`
                              ) : (
                                c.name
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

        {/* Bottom Content */}
        <Box
          sx={{
            position: 'relative',
            zIndex: 2,
            width: '100%',
            px: 3,
            pb: 3,
            mt: 'auto',
            display: 'flex',
            gap: 3,
            alignItems: 'flex-end',
          }}
        >
          {posterImage && <HeroPoster imageId={posterImage.id} alt={collection.name} />}

          <Box sx={{ flex: 1, minWidth: 0 }}>
            {logoImage ? (
              <HeroLogo imageId={logoImage.id} alt={collection.name} />
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
              {filmDetails?.releaseDate && (
                <Typography variant="body1" sx={{ color: 'grey.300' }}>
                  {new Date(filmDetails.releaseDate).getFullYear()}
                </Typography>
              )}
              {primaryMedia.duration && primaryMedia.duration > 0 && (
                <Typography variant="body1" sx={{ color: 'grey.300' }}>
                  {formatDuration(primaryMedia.duration)}
                </Typography>
              )}
              {filmDetails?.contentRating && (
                <Chip
                  label={filmDetails.contentRating}
                  size="small"
                  sx={{ color: 'grey.100', borderColor: 'grey.500' }}
                  variant="outlined"
                />
              )}
              {filmDetails?.rating && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Star sx={{ color: 'warning.main', fontSize: 20 }} />
                  <Typography variant="body1" sx={{ color: 'grey.300' }}>
                    {filmDetails.rating.toFixed(1)}
                  </Typography>
                </Box>
              )}
            </Box>

            {/* Genres */}
            {filmDetails?.genres && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                {filmDetails.genres.split(', ').map((genre) => (
                  <Chip
                    key={genre}
                    label={genre}
                    size="small"
                    sx={{ color: 'grey.100', borderColor: 'grey.500' }}
                    variant="outlined"
                  />
                ))}
              </Box>
            )}

            {/* Keywords */}
            {collection.keywords && collection.keywords.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                {collection.keywords.slice(0, 10).map((keyword) => (
                  <Chip
                    key={keyword.id}
                    label={keyword.name}
                    size="small"
                    sx={{ color: 'grey.300', borderColor: 'grey.700', fontSize: '0.7rem' }}
                    variant="outlined"
                  />
                ))}
              </Box>
            )}

            {/* Action Buttons */}
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Box sx={{ display: 'flex' }}>
                <Button
                  variant="contained"
                  size="large"
                  startIcon={<PlayArrow />}
                  onClick={() => onPlay(primaryMedia.id)}
                  sx={{ borderTopRightRadius: onPlayAfter ? 0 : undefined, borderBottomRightRadius: onPlayAfter ? 0 : undefined }}
                >
                  {t('media.play', 'Play')}
                </Button>
                {onPlayAfter && (
                  <>
                    <Button
                      variant="contained"
                      size="large"
                      onClick={(e) => setPlayMenuAnchor(e.currentTarget)}
                      aria-controls={playMenuOpen ? 'play-menu' : undefined}
                      aria-haspopup="true"
                      aria-expanded={playMenuOpen ? 'true' : undefined}
                      sx={{ minWidth: 'auto', px: 0.5, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: '1px solid rgba(255,255,255,0.3)' }}
                    >
                      <ArrowDropDown />
                    </Button>
                    <Menu
                      id="play-menu"
                      anchorEl={playMenuAnchor}
                      open={playMenuOpen}
                      onClose={() => setPlayMenuAnchor(null)}
                      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                    >
                      {onPlayInMiniPlayer && (
                        <MenuItem onClick={() => { onPlayInMiniPlayer(primaryMedia.id); setPlayMenuAnchor(null); }}>
                          <ListItemIcon>
                            <PictureInPictureAlt fontSize="small" />
                          </ListItemIcon>
                          <ListItemText>{t('media.playInMiniPlayer', 'Play in mini player')}</ListItemText>
                        </MenuItem>
                      )}
                      <MenuItem onClick={() => { onPlayAfter(primaryMedia.id); setPlayMenuAnchor(null); }}>
                        <ListItemIcon>
                          <QueuePlayNext fontSize="small" />
                        </ListItemIcon>
                        <ListItemText>{t('media.playAfter', 'Play after current')}</ListItemText>
                      </MenuItem>
                    </Menu>
                  </>
                )}
              </Box>
              <FavoriteButton
                collectionId={collection.id}
                sx={{ bgcolor: 'rgba(255,255,255,0.1)', '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' } }}
              />
              <WatchLaterButton
                collectionId={collection.id}
                sx={{ bgcolor: 'rgba(255,255,255,0.1)', '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' } }}
              />
              <IconButton
                onClick={handleAddMenuClick}
                aria-label={t('common.add', 'Add')}
                aria-controls={addMenuOpen ? 'add-menu' : undefined}
                aria-haspopup="true"
                aria-expanded={addMenuOpen ? 'true' : undefined}
                sx={{ color: 'white', bgcolor: 'rgba(255,255,255,0.1)', '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' } }}
              >
                <Add />
              </IconButton>
              <Menu
                id="add-menu"
                anchorEl={addMenuAnchor}
                open={addMenuOpen}
                onClose={handleAddMenuClose}
                anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
                transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
              >
                <ListSubheader>{t('userCollections.addTo', 'Add to')}</ListSubheader>
                {recentCollection && (
                  <MenuItem onClick={handleQuickAddToRecent} disabled={isAddingToRecent}>
                    <ListItemIcon>
                      <FolderSpecial fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>{recentCollection.name}</ListItemText>
                  </MenuItem>
                )}
                <MenuItem onClick={handleAddToCollection}>
                  <ListItemIcon>
                    <Add fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>{t('userCollections.choose', 'Choose...')}</ListItemText>
                </MenuItem>
              </Menu>
              <IconButton
                onClick={onMenuOpen}
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
      </HeroSection>

      {/* Special Features */}
      {additionalMedia.length > 0 && (
        <>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {t('collection.specialFeatures', 'Special Features')} ({additionalMedia.length})
          </Typography>
          <Grid container spacing={2} sx={{ mb: 4 }}>
            {additionalMedia.map((item) => {
              const primaryImage = item.images?.[0];

              return (
                <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={item.id}>
                  <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <CardActionArea
                      onClick={() => onMediaClick(item.id)}
                      sx={{
                        flexGrow: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'stretch',
                      }}
                    >
                      {primaryImage ? (
                        <>
                          <CardMedia
                            component="img"
                            image={apiClient.getImageUrl(primaryImage.id)}
                            alt={item.name}
                            sx={{ aspectRatio: '16/9', objectFit: 'cover' }}
                          />
                          <CardContent sx={{ textAlign: 'center', py: 1 }}>
                            <Typography variant="body2" noWrap title={item.name}>
                              {item.name}
                            </Typography>
                          </CardContent>
                        </>
                      ) : (
                        <CardContent
                          sx={{
                            textAlign: 'center',
                            flexGrow: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                          }}
                        >
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

      {/* Cast & Crew Grid */}
      {credits.length > 0 && (
        <CastCrewGrid credits={credits} onPersonClick={onPersonClick} />
      )}
    </>
  );
}
