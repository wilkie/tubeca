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
