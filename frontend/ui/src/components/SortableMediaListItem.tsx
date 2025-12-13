import {
  Box,
  Card,
  CardContent,
  CardActionArea,
  CardMedia,
  IconButton,
  Tooltip,
  Stack,
  Typography,
} from '@mui/material';
import { PlayArrow, DragIndicator, Clear, Delete } from '@mui/icons-material';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { UserCollectionItem } from '../api/client';

export interface SortableMediaListItemProps {
  item: UserCollectionItem;
  index: number;
  onItemClick: (item: UserCollectionItem) => void;
  onPlayItem: (item: UserCollectionItem, index: number, event: React.MouseEvent) => void;
  onRemoveItem: (item: UserCollectionItem, event: React.MouseEvent) => void;
  getItemImage: (item: UserCollectionItem) => string | null;
  getItemName: (item: UserCollectionItem) => string;
  getItemSubtitle: (item: UserCollectionItem) => string;
  getItemIcon: (item: UserCollectionItem) => React.ReactNode;
  removeTooltip: string;
  showDragHandle?: boolean;
  showRemoveButton?: boolean;
  showPlayButton?: boolean;
  useDeleteIcon?: boolean;
}

export function SortableMediaListItem({
  item,
  index,
  onItemClick,
  onPlayItem,
  onRemoveItem,
  getItemImage,
  getItemName,
  getItemSubtitle,
  getItemIcon,
  removeTooltip,
  showDragHandle = true,
  showRemoveButton = true,
  showPlayButton,
  useDeleteIcon = false,
}: SortableMediaListItemProps) {
  // Default: show play button only if item has media
  const shouldShowPlayButton = showPlayButton ?? !!item.media;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : 'auto',
  };

  const imageUrl = getItemImage(item);
  const name = getItemName(item);
  const subtitle = getItemSubtitle(item);
  const duration = item.media?.duration;

  return (
    <Card ref={setNodeRef} style={style} sx={{ display: 'flex' }}>
      {/* Drag handle */}
      {showDragHandle && (
        <Box
          {...attributes}
          {...listeners}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            px: 1,
            cursor: 'grab',
            '&:active': { cursor: 'grabbing' },
            color: 'text.secondary',
            '&:hover': { color: 'text.primary' },
          }}
        >
          <DragIndicator />
        </Box>
      )}

      {/* Image and Details - single clickable area */}
      <CardActionArea
        onClick={() => onItemClick(item)}
        sx={{ flexGrow: 1, display: 'flex', alignItems: 'stretch' }}
      >
        {/* Image */}
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
              alt={name}
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
              {getItemIcon(item)}
            </Box>
          )}
        </Box>

        {/* Details */}
        <CardContent sx={{ py: 1.5, px: 2, flexGrow: 1 }}>
          <Typography variant="subtitle1" fontWeight="medium">
            {name}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography
              variant="caption"
              sx={{
                bgcolor: 'action.selected',
                px: 0.5,
                borderRadius: 0.5,
                fontWeight: 600,
              }}
            >
              #{index + 1}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary">
                {subtitle}
              </Typography>
            )}
            {duration && (
              <Typography variant="caption" color="text.secondary">
                {Math.floor(duration / 3600) > 0
                  ? `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m`
                  : `${Math.floor(duration / 60)}m`}
              </Typography>
            )}
          </Stack>
        </CardContent>
      </CardActionArea>

      {/* Actions */}
      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 0.5 }}>
        {shouldShowPlayButton && (
          <IconButton
            color="primary"
            onClick={(e) => onPlayItem(item, index, e)}
            sx={{ width: 40, height: 56, borderRadius: 0.5 }}
          >
            <PlayArrow sx={{ fontSize: 28 }} />
          </IconButton>
        )}
        {showRemoveButton && (
          <Tooltip title={removeTooltip}>
            <IconButton
              size="small"
              onClick={(e) => onRemoveItem(item, e)}
            >
              {useDeleteIcon ? <Delete /> : <Clear />}
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Card>
  );
}
