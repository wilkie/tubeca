import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Paper, Typography, Button, IconButton } from '@mui/material';
import { Close, SkipNext } from '@mui/icons-material';
import type { NextItemInfo } from '../context/PlayerContext';

interface UpNextPopupProps {
  nextItem: NextItemInfo;
  currentTime: number;
  duration: number;
  onStart: () => void;
  showControls: boolean;
}

const SHOW_BEFORE_END = 30; // Show popup 30 seconds before end

export function UpNextPopup({
  nextItem,
  currentTime,
  duration,
  onStart,
  showControls,
}: UpNextPopupProps) {
  const { t } = useTranslation();
  // Store the ID of the dismissed item - when nextItem changes, this naturally resets
  const [dismissedItemId, setDismissedItemId] = useState<string | null>(null);

  // Dismissed is true only if user dismissed this specific item
  const dismissed = dismissedItemId === nextItem.id;

  const timeRemaining = Math.max(0, Math.ceil(duration - currentTime));
  const shouldShow = timeRemaining <= SHOW_BEFORE_END && timeRemaining > 0 && !dismissed;

  const handleDismiss = useCallback(() => {
    setDismissedItemId(nextItem.id);
  }, [nextItem.id]);

  const handleStart = useCallback(() => {
    onStart();
  }, [onStart]);

  // Format episode info
  const formatNextItemLabel = () => {
    if (nextItem.type === 'episode' && nextItem.seasonNumber != null && nextItem.episodeNumber != null) {
      return t('player.upNext.episode', {
        season: nextItem.seasonNumber,
        episode: nextItem.episodeNumber,
        defaultValue: `S${nextItem.seasonNumber}:E${nextItem.episodeNumber}`,
      });
    }
    return nextItem.type === 'queue' ? t('player.upNext.fromQueue', 'From queue') : '';
  };

  if (!shouldShow) {
    return null;
  }

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'absolute',
        bottom: showControls ? 100 : 24,
        right: 24,
        width: 300,
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        color: 'white',
        borderRadius: 2,
        overflow: 'hidden',
        transition: 'bottom 0.3s ease, opacity 0.3s ease',
        zIndex: 10001,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2,
          py: 1,
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
        }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {t('player.upNext.title', 'Up Next')} ({timeRemaining}s)
        </Typography>
        <IconButton
          size="small"
          onClick={handleDismiss}
          sx={{ color: 'white', ml: 1 }}
          aria-label={t('player.upNext.hide', 'Hide')}
        >
          <Close fontSize="small" />
        </IconButton>
      </Box>

      {/* Content */}
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.7)', display: 'block', mb: 0.5 }}>
          {formatNextItemLabel()}
        </Typography>
        <Typography
          variant="body2"
          sx={{
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {nextItem.name}
        </Typography>
      </Box>

      {/* Actions */}
      <Box
        sx={{
          display: 'flex',
          gap: 1,
          px: 2,
          pb: 2,
        }}
      >
        <Button
          variant="outlined"
          size="small"
          onClick={handleDismiss}
          sx={{
            flex: 1,
            color: 'white',
            borderColor: 'rgba(255, 255, 255, 0.5)',
            '&:hover': {
              borderColor: 'white',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
            },
          }}
        >
          {t('player.upNext.hide', 'Hide')}
        </Button>
        <Button
          variant="contained"
          size="small"
          startIcon={<SkipNext />}
          onClick={handleStart}
          sx={{
            flex: 1,
            backgroundColor: 'primary.main',
            '&:hover': {
              backgroundColor: 'primary.dark',
            },
          }}
        >
          {t('player.upNext.start', 'Start')}
        </Button>
      </Box>
    </Paper>
  );
}
