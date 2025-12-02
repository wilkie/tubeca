import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  Paper,
  Chip,
  Divider,
  IconButton,
  Alert,
} from '@mui/material';
import { CalendarMonth, MoreVert } from '@mui/icons-material';
import type { Collection, CollectionType, Image } from '../api/client';
import { ChildCollectionGrid } from './ChildCollectionGrid';
import { MediaGrid } from './MediaGrid';

interface ChildCollection {
  id: string;
  name: string;
  collectionType?: CollectionType;
  images?: Image[];
}

interface MediaItem {
  id: string;
  name: string;
  type: 'Video' | 'Audio';
  videoDetails?: {
    episode?: number | null;
  } | null;
  audioDetails?: {
    track?: number | null;
    disc?: number | null;
  } | null;
  images?: Image[];
}

interface StandardCollectionViewProps {
  collection: Collection;
  childCollections: ChildCollection[];
  media: MediaItem[];
  menuOpen: boolean;
  onCollectionClick: (collectionId: string) => void;
  onMediaClick: (mediaId: string) => void;
  onMenuOpen: (event: React.MouseEvent<HTMLElement>) => void;
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

export function StandardCollectionView({
  collection,
  childCollections,
  media,
  menuOpen,
  onCollectionClick,
  onMediaClick,
  onMenuOpen,
}: StandardCollectionViewProps) {
  const { t } = useTranslation();

  const label = getCollectionLabel(collection.collectionType);

  return (
    <>
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          mb: 3,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h4" component="h1">
            {collection.name}
          </Typography>
          {label && (
            <Chip label={label} size="small" color="primary" variant="outlined" />
          )}
        </Box>
        <IconButton
          onClick={onMenuOpen}
          aria-label={t('common.moreOptions', 'More options')}
          aria-controls={menuOpen ? 'collection-menu' : undefined}
          aria-haspopup="true"
          aria-expanded={menuOpen ? 'true' : undefined}
        >
          <MoreVert />
        </IconButton>
      </Box>

      {/* Season Details */}
      {collection.seasonDetails &&
        (collection.seasonDetails.releaseDate || collection.seasonDetails.description) && (
          <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
            {collection.seasonDetails.releaseDate && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  mb: collection.seasonDetails.description ? 2 : 0,
                }}
              >
                <CalendarMonth sx={{ fontSize: 20, color: 'text.secondary' }} />
                <Typography variant="body2" color="text.secondary">
                  {new Date(collection.seasonDetails.releaseDate).toLocaleDateString()}
                </Typography>
              </Box>
            )}
            {collection.seasonDetails.description && (
              <Typography variant="body2" color="text.secondary">
                {collection.seasonDetails.description}
              </Typography>
            )}
          </Paper>
        )}

      {/* Artist Details */}
      {collection.artistDetails && (
        <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
          {(collection.artistDetails.country || collection.artistDetails.formedYear) && (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 2,
                mb:
                  collection.artistDetails.genres ||
                  collection.artistDetails.biography ||
                  (collection.artistDetails.members &&
                    collection.artistDetails.members.length > 0)
                    ? 2
                    : 0,
              }}
            >
              {collection.artistDetails.country && (
                <Typography variant="body2" color="text.secondary">
                  {collection.artistDetails.country}
                </Typography>
              )}
              {collection.artistDetails.formedYear && (
                <Typography variant="body2" color="text.secondary">
                  Formed: {collection.artistDetails.formedYear}
                  {collection.artistDetails.endedYear &&
                    ` - ${collection.artistDetails.endedYear}`}
                </Typography>
              )}
            </Box>
          )}

          {collection.artistDetails.genres && (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 1,
                mb:
                  collection.artistDetails.biography ||
                  (collection.artistDetails.members &&
                    collection.artistDetails.members.length > 0)
                    ? 2
                    : 0,
              }}
            >
              {collection.artistDetails.genres.split(', ').map((genre) => (
                <Chip key={genre} label={genre} size="small" variant="outlined" />
              ))}
            </Box>
          )}

          {collection.artistDetails.biography && (
            <Typography variant="body2" color="text.secondary">
              {collection.artistDetails.biography}
            </Typography>
          )}

          {collection.artistDetails.members && collection.artistDetails.members.length > 0 && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Members
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {collection.artistDetails.members.map((member) => (
                  <Chip
                    key={member.id}
                    label={member.role ? `${member.name} (${member.role})` : member.name}
                    size="small"
                    variant={member.active ? 'filled' : 'outlined'}
                    color={member.active ? 'primary' : 'default'}
                  />
                ))}
              </Box>
            </>
          )}
        </Paper>
      )}

      {/* Album Details */}
      {collection.albumDetails && (
        <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
          {(collection.albumDetails.releaseType ||
            collection.albumDetails.releaseDate ||
            collection.albumDetails.label) && (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 2,
                mb:
                  collection.albumDetails.genres || collection.albumDetails.description
                    ? 2
                    : 0,
              }}
            >
              {collection.albumDetails.releaseType && (
                <Chip
                  label={collection.albumDetails.releaseType}
                  size="small"
                  color="primary"
                  variant="outlined"
                />
              )}
              {collection.albumDetails.releaseDate && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <CalendarMonth sx={{ fontSize: 20, color: 'text.secondary' }} />
                  <Typography variant="body2" color="text.secondary">
                    {new Date(collection.albumDetails.releaseDate).toLocaleDateString()}
                  </Typography>
                </Box>
              )}
              {collection.albumDetails.label && (
                <Typography variant="body2" color="text.secondary">
                  {collection.albumDetails.label}
                </Typography>
              )}
            </Box>
          )}

          {collection.albumDetails.genres && (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 1,
                mb: collection.albumDetails.description ? 2 : 0,
              }}
            >
              {collection.albumDetails.genres.split(', ').map((genre) => (
                <Chip key={genre} label={genre} size="small" variant="outlined" />
              ))}
            </Box>
          )}

          {collection.albumDetails.description && (
            <Typography variant="body2" color="text.secondary">
              {collection.albumDetails.description}
            </Typography>
          )}
        </Paper>
      )}

      {/* Empty State */}
      {childCollections.length === 0 && media.length === 0 ? (
        <Alert severity="info">{t('collection.empty')}</Alert>
      ) : (
        <>
          {/* Child Collections */}
          {childCollections.length > 0 && (
            <ChildCollectionGrid
              collections={childCollections}
              parentCollectionType={collection.collectionType}
              onCollectionClick={onCollectionClick}
            />
          )}

          {/* Media Items */}
          {media.length > 0 && (
            <MediaGrid
              media={media}
              collectionType={collection.collectionType}
              onMediaClick={onMediaClick}
            />
          )}
        </>
      )}
    </>
  );
}
