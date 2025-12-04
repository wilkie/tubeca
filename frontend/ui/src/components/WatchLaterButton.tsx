import { useState, useEffect } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { WatchLater, WatchLaterOutlined } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../api/client';

interface WatchLaterButtonProps {
  collectionId?: string;
  mediaId?: string;
  size?: 'small' | 'medium' | 'large';
  color?: string;
  sx?: object;
}

export function WatchLaterButton({
  collectionId,
  mediaId,
  size = 'medium',
  color = 'white',
  sx,
}: WatchLaterButtonProps) {
  const { t } = useTranslation();
  const [isInWatchLater, setIsInWatchLater] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isToggling, setIsToggling] = useState(false);

  // Check if item is in watch later on mount
  useEffect(() => {
    let cancelled = false;

    async function checkWatchLater() {
      const result = await apiClient.checkWatchLater(
        collectionId ? [collectionId] : undefined,
        mediaId ? [mediaId] : undefined
      );

      if (cancelled) return;

      if (result.data) {
        const inWatchLater = collectionId
          ? result.data.collectionIds.includes(collectionId)
          : mediaId
            ? result.data.mediaIds.includes(mediaId)
            : false;
        setIsInWatchLater(inWatchLater);
      }
      setIsLoading(false);
    }

    checkWatchLater();

    return () => {
      cancelled = true;
    };
  }, [collectionId, mediaId]);

  const handleToggle = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (isToggling) return;

    setIsToggling(true);
    const result = await apiClient.toggleWatchLater({ collectionId, mediaId });

    if (result.data) {
      setIsInWatchLater(result.data.inWatchLater);
    }
    setIsToggling(false);
  };

  const tooltip = isInWatchLater
    ? t('watchLater.removeFromWatchLater', 'Remove from Watch Later')
    : t('watchLater.addToWatchLater', 'Add to Watch Later');

  return (
    <Tooltip title={tooltip}>
      <IconButton
        onClick={handleToggle}
        disabled={isLoading || isToggling}
        size={size}
        aria-label={tooltip}
        sx={{
          color: isInWatchLater ? 'primary.main' : color,
          opacity: isLoading ? 0.5 : 1,
          ...sx,
        }}
      >
        {isInWatchLater ? <WatchLater /> : <WatchLaterOutlined />}
      </IconButton>
    </Tooltip>
  );
}
