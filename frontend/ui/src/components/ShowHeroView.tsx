import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  CardActionArea,
  CardMedia,
  Paper,
  Chip,
  Button,
  IconButton,
  Menu,
  MenuItem,
} from '@mui/material';
import {
  Star,
  PlayArrow,
  MoreVert,
  Folder,
  Person,
  KeyboardArrowDown,
} from '@mui/icons-material';
import { apiClient, type Collection, type ShowCredit, type Image } from '../api/client';
import { HeroSection, HeroPoster, HeroLogo } from './HeroSection';
import { CollectionBreadcrumbs, type BreadcrumbItem } from './CollectionBreadcrumbs';

interface ShowCreditWithPerson extends ShowCredit {
  person?: {
    id: string;
    images?: Image[];
  } | null;
}

interface ChildCollection {
  id: string;
  name: string;
  collectionType?: string;
  images?: Image[];
  media?: {
    id: string;
    videoDetails?: {
      episode: number | null;
    } | null;
  }[];
}

interface ShowHeroViewProps {
  collection: Collection;
  seasons: ChildCollection[];
  breadcrumbs: BreadcrumbItem[];
  menuOpen: boolean;
  onBreadcrumbNavigate: (item: BreadcrumbItem) => void;
  onPlay: (mediaId: string) => void;
  onSeasonClick: (seasonId: string) => void;
  onPersonClick: (personId: string) => void;
  onMenuOpen: (event: React.MouseEvent<HTMLElement>) => void;
}

export function ShowHeroView({
  collection,
  seasons,
  breadcrumbs,
  menuOpen,
  onBreadcrumbNavigate,
  onPlay,
  onSeasonClick,
  onPersonClick,
  onMenuOpen,
}: ShowHeroViewProps) {
  const { t } = useTranslation();

  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [seasonMenuAnchorEl, setSeasonMenuAnchorEl] = useState<HTMLElement | null>(null);
  const seasonMenuOpen = Boolean(seasonMenuAnchorEl);

  const backdropImage = collection.images?.find((img) => img.imageType === 'Backdrop');
  const posterImage = collection.images?.find((img) => img.imageType === 'Poster');
  const logoImage = collection.images?.find((img) => img.imageType === 'Logo');

  const sortedSeasons = [...seasons].sort((a, b) => a.name.localeCompare(b.name));
  const currentSeasonId = selectedSeasonId || (sortedSeasons.length > 0 ? sortedSeasons[0].id : null);
  const currentSeason = sortedSeasons.find((s) => s.id === currentSeasonId);

  // Find first episode for the selected season
  const firstEpisodeId = currentSeason
    ? (() => {
        if (currentSeason.media && currentSeason.media.length > 0) {
          const sortedEpisodes = [...currentSeason.media].sort((a, b) => {
            const aEp = a.videoDetails?.episode ?? Infinity;
            const bEp = b.videoDetails?.episode ?? Infinity;
            return aEp - bEp;
          });
          return sortedEpisodes[0]?.id || null;
        }
        return null;
      })()
    : null;

  const showDetails = collection.showDetails;
  const credits = (showDetails?.credits || []) as ShowCreditWithPerson[];
  const castCredits = credits.filter((c) => c.creditType === 'Actor').slice(0, 10);

  return (
    <>
      <HeroSection backdropImageId={backdropImage?.id}>
        {/* Breadcrumbs */}
        <Box sx={{ position: 'relative', zIndex: 2, px: 3, pt: 2 }}>
          <CollectionBreadcrumbs
            breadcrumbs={breadcrumbs}
            currentName={collection.name}
            onNavigate={onBreadcrumbNavigate}
            variant="hero"
          />
        </Box>

        {/* Description */}
        {showDetails?.description && (
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
              <Typography
                variant="body1"
                sx={{
                  color: 'grey.200',
                  display: '-webkit-box',
                  WebkitLineClamp: 6,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {showDetails.description}
              </Typography>
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
              {showDetails?.releaseDate && (
                <Typography variant="body1" sx={{ color: 'grey.300' }}>
                  {new Date(showDetails.releaseDate).getFullYear()}
                  {showDetails.endDate && ` - ${new Date(showDetails.endDate).getFullYear()}`}
                </Typography>
              )}
              {showDetails?.status && (
                <Chip
                  label={showDetails.status}
                  size="small"
                  sx={{ color: 'grey.100', borderColor: 'grey.500' }}
                  variant="outlined"
                />
              )}
              {showDetails?.rating && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Star sx={{ color: 'warning.main', fontSize: 20 }} />
                  <Typography variant="body1" sx={{ color: 'grey.300' }}>
                    {showDetails.rating.toFixed(1)}
                  </Typography>
                </Box>
              )}
              {sortedSeasons.length > 0 && (
                <Typography variant="body1" sx={{ color: 'grey.300' }}>
                  {t('collection.seasonCount', '{{count}} Seasons', { count: sortedSeasons.length })}
                </Typography>
              )}
            </Box>

            {/* Genres */}
            {showDetails?.genres && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                {showDetails.genres.split(', ').map((genre) => (
                  <Chip
                    key={genre}
                    label={genre}
                    size="small"
                    sx={{ color: 'grey.100', borderColor: 'grey.600' }}
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
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              {sortedSeasons.length > 1 && (
                <>
                  <Button
                    variant="outlined"
                    size="large"
                    onClick={(e) => setSeasonMenuAnchorEl(e.currentTarget)}
                    endIcon={<KeyboardArrowDown />}
                    sx={{
                      color: 'white',
                      borderColor: 'grey.500',
                      '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.1)' },
                    }}
                  >
                    {currentSeason?.name || t('collection.selectSeason', 'Select Season')}
                  </Button>
                  <Menu
                    anchorEl={seasonMenuAnchorEl}
                    open={seasonMenuOpen}
                    onClose={() => setSeasonMenuAnchorEl(null)}
                    anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
                    transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                  >
                    {sortedSeasons.map((season) => (
                      <MenuItem
                        key={season.id}
                        selected={season.id === currentSeasonId}
                        onClick={() => {
                          setSelectedSeasonId(season.id);
                          setSeasonMenuAnchorEl(null);
                        }}
                      >
                        {season.name}
                      </MenuItem>
                    ))}
                  </Menu>
                </>
              )}
              {firstEpisodeId && (
                <Button
                  variant="contained"
                  size="large"
                  startIcon={<PlayArrow />}
                  onClick={() => onPlay(firstEpisodeId)}
                >
                  {t('media.play', 'Play')}
                </Button>
              )}
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

      {/* Seasons Grid */}
      {sortedSeasons.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h5" sx={{ mb: 2 }}>
            {t('collection.seasons', 'Seasons')} ({sortedSeasons.length})
          </Typography>
          <Grid container spacing={2}>
            {sortedSeasons.map((season) => {
              const primaryImage = season.images?.[0];

              return (
                <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={season.id}>
                  <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <CardActionArea
                      onClick={() => onSeasonClick(season.id)}
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
                            alt={season.name}
                            sx={{ aspectRatio: '2/3', objectFit: 'cover' }}
                          />
                          <CardContent sx={{ textAlign: 'center', py: 1 }}>
                            <Typography variant="body2" noWrap title={season.name}>
                              {season.name}
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
                          <Folder sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
                          <Typography variant="body2" noWrap title={season.name}>
                            {season.name}
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

      {/* Cast Grid */}
      {castCredits.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h5" sx={{ mb: 2 }}>
            {t('media.cast', 'Cast')}
          </Typography>
          <Grid container spacing={2}>
            {castCredits.map((credit) => {
              const primaryImage = credit.person?.images?.[0];

              return (
                <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={credit.id}>
                  <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <CardActionArea
                      onClick={() => credit.personId && onPersonClick(credit.personId)}
                      disabled={!credit.personId}
                      sx={{
                        flexGrow: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'stretch',
                      }}
                    >
                      {primaryImage ? (
                        <CardMedia
                          component="img"
                          image={apiClient.getImageUrl(primaryImage.id)}
                          alt={credit.name}
                          sx={{ aspectRatio: '2/3', objectFit: 'cover' }}
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
                      <CardContent
                        sx={{
                          textAlign: 'center',
                          py: 1,
                          flexGrow: 1,
                          overflow: 'hidden',
                        }}
                      >
                        <Typography
                          variant="body2"
                          noWrap
                          title={credit.name}
                          sx={{ textOverflow: 'ellipsis', overflow: 'hidden' }}
                        >
                          {credit.name}
                        </Typography>
                        {credit.role && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            noWrap
                            title={credit.role}
                            sx={{ display: 'block', textOverflow: 'ellipsis', overflow: 'hidden' }}
                          >
                            {credit.role}
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
    </>
  );
}
