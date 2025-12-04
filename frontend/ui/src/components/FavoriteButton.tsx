import { useState, useEffect } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { Favorite, FavoriteBorder } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../api/client';

interface FavoriteButtonProps {
  collectionId?: string;
  mediaId?: string;
  size?: 'small' | 'medium' | 'large';
  color?: string;
  sx?: object;
}

export function FavoriteButton({
  collectionId,
  mediaId,
  size = 'medium',
  color = 'white',
  sx,
}: FavoriteButtonProps) {
  const { t } = useTranslation();
  const [isFavorited, setIsFavorited] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isToggling, setIsToggling] = useState(false);

  // Check if item is favorited on mount
  useEffect(() => {
    let cancelled = false;

    async function checkFavorite() {
      const result = await apiClient.checkFavorites(
        collectionId ? [collectionId] : undefined,
        mediaId ? [mediaId] : undefined
      );

      if (cancelled) return;

      if (result.data) {
        const favorited = collectionId
          ? result.data.collectionIds.includes(collectionId)
          : mediaId
            ? result.data.mediaIds.includes(mediaId)
            : false;
        setIsFavorited(favorited);
      }
      setIsLoading(false);
    }

    checkFavorite();

    return () => {
      cancelled = true;
    };
  }, [collectionId, mediaId]);

  const handleToggle = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (isToggling) return;

    setIsToggling(true);
    const result = await apiClient.toggleFavorite({ collectionId, mediaId });

    if (result.data) {
      setIsFavorited(result.data.favorited);
    }
    setIsToggling(false);
  };

  const tooltip = isFavorited
    ? t('favorites.removeFromFavorites', 'Remove from Favorites')
    : t('favorites.addToFavorites', 'Add to Favorites');

  return (
    <Tooltip title={tooltip}>
      <IconButton
        onClick={handleToggle}
        disabled={isLoading || isToggling}
        size={size}
        aria-label={tooltip}
        sx={{
          color: isFavorited ? 'error.main' : color,
          opacity: isLoading ? 0.5 : 1,
          ...sx,
        }}
      >
        {isFavorited ? <Favorite /> : <FavoriteBorder />}
      </IconButton>
    </Tooltip>
  );
}
