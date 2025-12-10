import type { ReactNode } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardActionArea,
  CardMedia,
  Typography,
  Stack,
  IconButton,
  Tooltip,
} from '@mui/material';
import { PlayArrow } from '@mui/icons-material';

export interface MediaListItemProps {
  /** URL of the image to display */
  imageUrl?: string | null;
  /** Alt text for the image */
  imageAlt: string;
  /** Fallback icon when no image */
  fallbackIcon: ReactNode;
  /** Primary title text */
  title: string;
  /** Metadata chips/badges to display (e.g., queue position, content rating) */
  badges?: ReactNode;
  /** Secondary metadata items (e.g., year, duration, episode info) */
  metadata?: ReactNode;
  /** Description text (will be truncated to 2 lines) */
  description?: string;
  /** Click handler for the main card area */
  onClick?: () => void;
  /** Click handler for the play button */
  onPlay?: (event: React.MouseEvent) => void;
  /** Additional action buttons to show on the right side */
  actions?: ReactNode;
}

/**
 * A reusable list item component for displaying media/collection items in a horizontal card layout.
 * Used across Library, Queue, and other pages for consistent list views.
 */
export function MediaListItem({
  imageUrl,
  imageAlt,
  fallbackIcon,
  title,
  badges,
  metadata,
  description,
  onClick,
  onPlay,
  actions,
}: MediaListItemProps) {
  return (
    <Card sx={{ display: 'flex' }}>
      {/* Image and Details - single clickable area */}
      <CardActionArea
        onClick={onClick}
        sx={{ flexGrow: 1, display: 'flex', alignItems: 'stretch' }}
      >
        {/* Image - fixed width based on 2:3 aspect ratio */}
        <Box
          sx={{
            width: 125,
            flexShrink: 0,
            flexGrow: 0,
          }}
        >
          {imageUrl ? (
            <CardMedia
              component="img"
              image={imageUrl}
              alt={imageAlt}
              sx={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          ) : (
            <Box
              sx={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'action.hover',
              }}
            >
              {fallbackIcon}
            </Box>
          )}
        </Box>

        {/* Details */}
        <CardContent sx={{ py: 1.5, px: 2, flexGrow: 1 }}>
          <Typography variant="subtitle1" fontWeight="medium">
            {title}
          </Typography>
          {(badges || metadata) && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
              {badges}
              {metadata}
            </Stack>
          )}
          {description && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {description}
            </Typography>
          )}
        </CardContent>
      </CardActionArea>

      {/* Actions */}
      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 0.5 }}>
        {onPlay && (
          <Tooltip title="Play">
            <IconButton
              color="primary"
              onClick={onPlay}
              sx={{ width: 40, height: 56, borderRadius: 0.5 }}
            >
              <PlayArrow sx={{ fontSize: 28 }} />
            </IconButton>
          </Tooltip>
        )}
        {actions}
      </Box>
    </Card>
  );
}

/** Helper component for rendering a badge/chip in the metadata row */
export function MediaListItemBadge({ children }: { children: ReactNode }) {
  return (
    <Typography
      variant="caption"
      sx={{
        bgcolor: 'action.selected',
        px: 0.5,
        borderRadius: 0.5,
      }}
    >
      {children}
    </Typography>
  );
}

/** Helper component for rendering metadata text */
export function MediaListItemMeta({ children }: { children: ReactNode }) {
  return (
    <Typography variant="caption" color="text.secondary">
      {children}
    </Typography>
  );
}
