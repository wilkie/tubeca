import { useTranslation } from 'react-i18next';
import { Box, LinearProgress, Tooltip } from '@mui/material';
import { CheckCircle } from '@mui/icons-material';
import type { CollectionWatchSummary, WatchProgress } from '../api/client';

type WatchBadgeProps =
  | { kind: 'media'; progress?: WatchProgress | null; summary?: undefined }
  | { kind: 'collection'; summary?: CollectionWatchSummary | null; progress?: undefined };

/**
 * Card overlay for watch state. Place inside a positioned container.
 * - media: a check when watched, a progress bar along the bottom when partly watched.
 * - collection: a check when every item is watched, "N left" once anything has
 *   been watched or started, and a progress bar for single-item collections (films).
 */
export function WatchBadge(props: WatchBadgeProps) {
  const { t } = useTranslation();

  let watched = false;
  let remaining: number | null = null;
  let fraction: number | null = null;

  if (props.kind === 'media') {
    const p = props.progress;
    if (!p) return null;
    watched = p.completed;
    if (!watched && p.duration > 0 && p.position > 0) fraction = p.position / p.duration;
  } else {
    const s = props.summary;
    if (!s || s.total === 0) return null;
    watched = s.watched === s.total;
    if (!watched && (s.watched > 0 || s.inProgress > 0)) remaining = s.total - s.watched;
    if (!watched && s.total === 1 && s.resume && s.resume.duration > 0) {
      fraction = s.resume.position / s.resume.duration;
    }
  }

  if (!watched && remaining === null && fraction === null) return null;

  return (
    <>
      {(watched || remaining !== null) && (
        <Tooltip title={watched ? t('watch.watched') : t('watch.remaining', { count: remaining ?? 0 })}>
          <Box
            data-testid="watch-badge"
            sx={{
              position: 'absolute',
              bottom: fraction !== null ? 12 : 8,
              right: 8,
              minWidth: 24,
              height: 24,
              px: watched ? 0 : 0.75,
              borderRadius: 12,
              bgcolor: watched ? 'success.main' : 'rgba(0, 0, 0, 0.7)',
              color: 'common.white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.7rem',
              fontWeight: 600,
              pointerEvents: 'none',
            }}
          >
            {watched ? <CheckCircle sx={{ fontSize: 18 }} /> : remaining}
          </Box>
        </Tooltip>
      )}
      {fraction !== null && (
        <LinearProgress
          variant="determinate"
          value={Math.min(100, Math.round(fraction * 100))}
          aria-label={t('watch.progress', { percent: Math.round(fraction * 100) })}
          sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4 }}
        />
      )}
    </>
  );
}
