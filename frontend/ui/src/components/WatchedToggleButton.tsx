import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton, Tooltip } from '@mui/material';
import { CheckCircle, CheckCircleOutline } from '@mui/icons-material';

interface WatchedToggleButtonProps {
  mediaId: string;
  watched: boolean;
  onChange: (mediaId: string, watched: boolean) => Promise<boolean> | boolean | void;
  /** 'icon' for card overlays and action rows, 'button' for hero action bars */
  variant?: 'icon' | 'button';
  /** Absolute-position in the top-left corner of a card */
  overlay?: boolean;
}

/** Marks a media item watched or unwatched. */
export function WatchedToggleButton({ mediaId, watched, onChange, variant = 'icon', overlay = false }: WatchedToggleButtonProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const label = watched ? t('watch.markUnwatched') : t('watch.markWatched');

  const handleClick = async (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onChange(mediaId, !watched);
    } finally {
      setBusy(false);
    }
  };

  if (variant === 'button') {
    return (
      <Button
        variant="outlined"
        size="large"
        startIcon={watched ? <CheckCircle /> : <CheckCircleOutline />}
        onClick={handleClick}
        disabled={busy}
        aria-pressed={watched}
      >
        {label}
      </Button>
    );
  }

  return (
    <Tooltip title={label}>
      <IconButton
        size="small"
        onClick={handleClick}
        disabled={busy}
        aria-label={label}
        aria-pressed={watched}
        sx={
          overlay
            ? {
                position: 'absolute',
                top: 4,
                left: 4,
                bgcolor: 'rgba(0, 0, 0, 0.6)',
                color: watched ? 'success.light' : 'common.white',
                '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.8)' },
              }
            : { color: watched ? 'success.main' : undefined }
        }
      >
        {watched ? <CheckCircle fontSize="small" /> : <CheckCircleOutline fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}
