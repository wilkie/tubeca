import { useTranslation } from 'react-i18next';
import {
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
} from '@mui/material';
import {
  Collections,
  Refresh,
  Image as ImageIcon,
  Delete,
  Search,
  CheckCircle,
  RemoveDone,
} from '@mui/icons-material';

interface CollectionOptionsMenuProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  onImagesClick: () => void;
  onIdentifyClick?: () => void;
  onRefreshMetadata: () => void;
  onRefreshImages: () => void;
  onDeleteClick: () => void;
  /** Mark the whole subtree watched. Omitted when there is nothing to mark. */
  onMarkAllWatched?: () => void;
  /** Clear the whole subtree. Omitted when nothing under it has been watched. */
  onMarkAllUnwatched?: () => void;
  isMarkingWatched?: boolean;
  canEdit: boolean;
  canIdentify: boolean;
  isRefreshing: boolean;
  isRefreshingImages: boolean;
}

export function CollectionOptionsMenu({
  anchorEl,
  open,
  onClose,
  onImagesClick,
  onIdentifyClick,
  onRefreshMetadata,
  onRefreshImages,
  onDeleteClick,
  onMarkAllWatched,
  onMarkAllUnwatched,
  isMarkingWatched = false,
  canEdit,
  canIdentify,
  isRefreshing,
  isRefreshingImages,
}: CollectionOptionsMenuProps) {
  const { t } = useTranslation();

  return (
    <Menu
      id="collection-menu"
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      anchorOrigin={{
        vertical: 'bottom',
        horizontal: 'right',
      }}
      transformOrigin={{
        vertical: 'top',
        horizontal: 'right',
      }}
    >
      {onMarkAllWatched && (
        <MenuItem onClick={onMarkAllWatched} disabled={isMarkingWatched}>
          <ListItemIcon>
            <CheckCircle fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('watch.markAllWatched', 'Mark all watched')}</ListItemText>
        </MenuItem>
      )}
      {onMarkAllUnwatched && (
        <MenuItem onClick={onMarkAllUnwatched} disabled={isMarkingWatched}>
          <ListItemIcon>
            <RemoveDone fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('watch.markAllUnwatched', 'Mark all unwatched')}</ListItemText>
        </MenuItem>
      )}
      {(onMarkAllWatched || onMarkAllUnwatched) && <Divider />}
      <MenuItem onClick={onImagesClick}>
        <ListItemIcon>
          <Collections fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t('collection.images', 'Images')}</ListItemText>
      </MenuItem>
      {canEdit && canIdentify && (
        <MenuItem onClick={onIdentifyClick}>
          <ListItemIcon>
            <Search fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('collection.identify', 'Identify')}</ListItemText>
        </MenuItem>
      )}
      {canEdit && <Divider />}
      {canEdit && (
        <MenuItem onClick={onRefreshMetadata} disabled={isRefreshing}>
          <ListItemIcon>
            <Refresh fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {isRefreshing
              ? t('collection.refreshing', 'Refreshing...')
              : t('collection.refreshMetadata', 'Refresh metadata')}
          </ListItemText>
        </MenuItem>
      )}
      {canEdit && (
        <MenuItem onClick={onRefreshImages} disabled={isRefreshingImages}>
          <ListItemIcon>
            <ImageIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {isRefreshingImages
              ? t('collection.refreshingImages', 'Refreshing...')
              : t('collection.refreshImages', 'Refresh images')}
          </ListItemText>
        </MenuItem>
      )}
      {canEdit && (
        <MenuItem onClick={onDeleteClick}>
          <ListItemIcon>
            <Delete fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ color: 'error' }}>
            {t('collection.delete', 'Delete')}
          </ListItemText>
        </MenuItem>
      )}
    </Menu>
  );
}
