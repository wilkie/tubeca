import { useState, useEffect } from 'react';
import {
  Box,
  IconButton,
  Tooltip,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  ListSubheader,
} from '@mui/material';
import { Favorite, FavoriteBorder, WatchLater, WatchLaterOutlined, Add, FolderSpecial } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { apiClient, type UserCollection } from '../api/client';

interface CardQuickActionsProps {
  collectionId?: string;
  mediaId?: string;
  initialFavorited?: boolean;
  initialInWatchLater?: boolean;
  onAddToCollection?: () => void;
}

export function CardQuickActions({
  collectionId,
  mediaId,
  initialFavorited = false,
  initialInWatchLater = false,
  onAddToCollection,
}: CardQuickActionsProps) {
  const { t } = useTranslation();
  const [isFavorited, setIsFavorited] = useState(initialFavorited);
  const [isInWatchLater, setIsInWatchLater] = useState(initialInWatchLater);
  const [isTogglingFavorite, setIsTogglingFavorite] = useState(false);
  const [isTogglingWatchLater, setIsTogglingWatchLater] = useState(false);

  // Add to collection menu state
  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);
  const addMenuOpen = Boolean(addMenuAnchor);
  const [recentCollection, setRecentCollection] = useState<UserCollection | null>(null);
  const [isAddingToRecent, setIsAddingToRecent] = useState(false);

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

  const handleAddMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    event.preventDefault();
    setAddMenuAnchor(event.currentTarget);
  };

  const handleAddMenuClose = () => {
    setAddMenuAnchor(null);
  };

  const handleAddToCollection = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    handleAddMenuClose();
    onAddToCollection?.();
  };

  const handleQuickAddToRecent = async (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (!recentCollection) return;
    setIsAddingToRecent(true);
    try {
      await apiClient.addUserCollectionItem(recentCollection.id, { collectionId, mediaId });
    } catch (error) {
      console.error('Failed to add to collection:', error);
    } finally {
      setIsAddingToRecent(false);
      handleAddMenuClose();
    }
  };

  const handleToggleFavorite = async (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (isTogglingFavorite) return;

    setIsTogglingFavorite(true);
    const result = await apiClient.toggleFavorite({ collectionId, mediaId });
    if (result.data) {
      setIsFavorited(result.data.favorited);
    }
    setIsTogglingFavorite(false);
  };

  const handleToggleWatchLater = async (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (isTogglingWatchLater) return;

    setIsTogglingWatchLater(true);
    const result = await apiClient.toggleWatchLater({ collectionId, mediaId });
    if (result.data) {
      setIsInWatchLater(result.data.inWatchLater);
    }
    setIsTogglingWatchLater(false);
  };

  const favoriteTooltip = isFavorited
    ? t('favorites.removeFromFavorites', 'Remove from Favorites')
    : t('favorites.addToFavorites', 'Add to Favorites');

  const watchLaterTooltip = isInWatchLater
    ? t('watchLater.removeFromWatchLater', 'Remove from Watch Later')
    : t('watchLater.addToWatchLater', 'Add to Watch Later');

  return (
    <Box
      sx={{
        position: 'absolute',
        top: 4,
        right: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        opacity: 0,
        transition: 'opacity 0.2s',
        '.MuiCard-root:hover &': {
          opacity: 1,
        },
      }}
    >
      <Tooltip title={favoriteTooltip} placement="left">
        <span>
          <IconButton
            size="small"
            onClick={handleToggleFavorite}
            disabled={isTogglingFavorite}
            sx={{
              bgcolor: 'rgba(0,0,0,0.6)',
              color: isFavorited ? 'error.main' : 'white',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.8)' },
              width: 32,
              height: 32,
            }}
          >
            {isFavorited ? <Favorite fontSize="small" /> : <FavoriteBorder fontSize="small" />}
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={watchLaterTooltip} placement="left">
        <span>
          <IconButton
            size="small"
            onClick={handleToggleWatchLater}
            disabled={isTogglingWatchLater}
            sx={{
              bgcolor: 'rgba(0,0,0,0.6)',
              color: isInWatchLater ? 'primary.main' : 'white',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.8)' },
              width: 32,
              height: 32,
            }}
          >
            {isInWatchLater ? <WatchLater fontSize="small" /> : <WatchLaterOutlined fontSize="small" />}
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t('userCollections.addToCollection', 'Add to Collection')} placement="left">
        <IconButton
          size="small"
          onClick={handleAddMenuClick}
          aria-controls={addMenuOpen ? 'card-add-menu' : undefined}
          aria-haspopup="true"
          aria-expanded={addMenuOpen ? 'true' : undefined}
          sx={{
            bgcolor: 'rgba(0,0,0,0.6)',
            color: 'white',
            '&:hover': { bgcolor: 'rgba(0,0,0,0.8)' },
            width: 32,
            height: 32,
          }}
        >
          <Add fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu
        id="card-add-menu"
        anchorEl={addMenuAnchor}
        open={addMenuOpen}
        onClose={handleAddMenuClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        onClick={(e) => e.stopPropagation()}
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
        {onAddToCollection && (
          <MenuItem onClick={handleAddToCollection}>
            <ListItemIcon>
              <Add fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('userCollections.choose', 'Choose...')}</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </Box>
  );
}
