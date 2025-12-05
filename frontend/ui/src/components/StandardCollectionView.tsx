import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  Paper,
  Chip,
  Divider,
  IconButton,
  Alert,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Button,
} from '@mui/material';
import { CalendarMonth, MoreVert, Add, FolderSpecial, Folder, ExpandMore, ExpandLess } from '@mui/icons-material';
import { apiClient, type Collection, type CollectionType, type Image, type UserCollection } from '../api/client';
import { ChildCollectionGrid } from './ChildCollectionGrid';
import { MediaGrid } from './MediaGrid';
import { FavoriteButton } from './FavoriteButton';
import { WatchLaterButton } from './WatchLaterButton';

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
  onAddToCollection?: () => void;
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
  onAddToCollection,
}: StandardCollectionViewProps) {
  const { t } = useTranslation();

  // Add to collection menu state
  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);
  const addMenuOpen = Boolean(addMenuAnchor);
  const [recentCollection, setRecentCollection] = useState<UserCollection | null>(null);
  const [isAddingToRecent, setIsAddingToRecent] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [isDescriptionOverflowing, setIsDescriptionOverflowing] = useState(false);
  const descriptionRef = useRef<HTMLDivElement>(null);

  // Fetch most recent user collection when add menu opens
  useEffect(() => {
    if (addMenuOpen) {
      apiClient.getUserCollections().then((result) => {
        if (result.data && result.data.userCollections.length > 0) {
          setRecentCollection(result.data.userCollections[0]);
        }
      });
    }
  }, [addMenuOpen]);

  // Check if description content overflows its container
  useEffect(() => {
    const element = descriptionRef.current;
    if (!element) return;

    const checkOverflow = () => {
      if (!descriptionExpanded) {
        setIsDescriptionOverflowing(element.scrollHeight > element.clientHeight);
      }
    };

    checkOverflow();

    const resizeObserver = new ResizeObserver(checkOverflow);
    resizeObserver.observe(element);

    return () => resizeObserver.disconnect();
  }, [collection.seasonDetails?.description, descriptionExpanded]);

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

  const label = getCollectionLabel(collection.collectionType);
  const posterImage = collection.images?.find((img) => img.imageType === 'Poster' && img.isPrimary);
  const isSeason = collection.collectionType === 'Season';
  const hasSeasonDescription = collection.seasonDetails?.description || collection.seasonDetails?.releaseDate;

  // Render poster image component
  const renderPoster = (height: number = 225) => (
    posterImage ? (
      <Box
        component="img"
        src={apiClient.getImageUrl(posterImage.id)}
        alt={collection.name}
        sx={{
          width: 150,
          height,
          objectFit: 'cover',
          borderRadius: 1,
          flexShrink: 0,
        }}
      />
    ) : (
      <Box
        sx={{
          width: 150,
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'action.hover',
          borderRadius: 1,
          flexShrink: 0,
        }}
      >
        <Folder sx={{ fontSize: 64, color: 'text.secondary' }} />
      </Box>
    )
  );

  // Render action buttons
  const renderActions = () => (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <FavoriteButton collectionId={collection.id} />
      <WatchLaterButton collectionId={collection.id} />
      <IconButton
        onClick={handleAddMenuClick}
        aria-label={t('common.add', 'Add')}
        aria-controls={addMenuOpen ? 'add-menu' : undefined}
        aria-haspopup="true"
        aria-expanded={addMenuOpen ? 'true' : undefined}
      >
        <Add />
      </IconButton>
      <Menu
        id="add-menu"
        anchorEl={addMenuAnchor}
        open={addMenuOpen}
        onClose={handleAddMenuClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
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
      >
        <MoreVert />
      </IconButton>
    </Box>
  );

  return (
    <>
      {/* Season Layout: Title row, then Poster + Description row */}
      {isSeason ? (
        <>
          {/* Title and Actions Row */}
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              mb: 3,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Typography variant="h4" component="h1">
                {collection.name}
              </Typography>
              {label && (
                <Chip label={label} size="small" color="primary" variant="outlined" />
              )}
            </Box>
            {renderActions()}
          </Box>

          {/* Poster + Description Row */}
          <Box sx={{ display: 'flex', gap: 3, mb: 3 }}>
            {renderPoster(225)}
            {hasSeasonDescription && (
              <Paper
                sx={{
                  p: 2,
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  maxHeight: descriptionExpanded ? 'none' : 225,
                  overflow: 'hidden',
                }}
                variant="outlined"
              >
                {collection.seasonDetails?.releaseDate && (
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      mb: collection.seasonDetails.description ? 1.5 : 0,
                      flexShrink: 0,
                    }}
                  >
                    <CalendarMonth sx={{ fontSize: 20, color: 'text.secondary' }} />
                    <Typography variant="body2" color="text.secondary">
                      {new Date(collection.seasonDetails.releaseDate).toLocaleDateString()}
                    </Typography>
                  </Box>
                )}
                {collection.seasonDetails?.description && (
                  <Box
                    ref={descriptionRef}
                    sx={{
                      flex: 1,
                      overflow: 'hidden',
                      position: 'relative',
                      maxHeight: descriptionExpanded ? 'none' : 155,
                    }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      {collection.seasonDetails.description}
                    </Typography>
                    {!descriptionExpanded && isDescriptionOverflowing && (
                      <Box
                        sx={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          height: 40,
                          background: 'linear-gradient(transparent, var(--mui-palette-background-paper))',
                        }}
                      />
                    )}
                  </Box>
                )}
                {collection.seasonDetails?.description && isDescriptionOverflowing && (
                  <Button
                    size="small"
                    onClick={() => setDescriptionExpanded(!descriptionExpanded)}
                    endIcon={descriptionExpanded ? <ExpandLess /> : <ExpandMore />}
                    sx={{ alignSelf: 'flex-start', mt: 1, flexShrink: 0 }}
                  >
                    {descriptionExpanded ? t('common.showLess', 'Show less') : t('common.showMore', 'Show more...')}
                  </Button>
                )}
              </Paper>
            )}
          </Box>
        </>
      ) : (
        /* Standard Layout: Poster + Title/Actions in one row */
        <Box
          sx={{
            display: 'flex',
            gap: 3,
            mb: 3,
          }}
        >
          {renderPoster()}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                mb: 2,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Typography variant="h4" component="h1">
                  {collection.name}
                </Typography>
                {label && (
                  <Chip label={label} size="small" color="primary" variant="outlined" />
                )}
              </Box>
              {renderActions()}
            </Box>
          </Box>
        </Box>
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
