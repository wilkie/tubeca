import { ListItemIcon, ListItemText, MenuItem } from '@mui/material';
import { FolderSpecial } from '@mui/icons-material';
import type { UserCollection } from '../api/client';

interface RecentCollectionMenuItemProps {
  collection: UserCollection | null;
  disabled?: boolean;
  onClick: (event: React.MouseEvent) => void;
}

/**
 * The one-click "add to the collection I used last" entry shared by every add
 * menu. Renders nothing until the collection is known.
 */
export function RecentCollectionMenuItem({ collection, disabled, onClick }: RecentCollectionMenuItemProps) {
  if (!collection) return null;

  return (
    <MenuItem onClick={onClick} disabled={disabled}>
      <ListItemIcon>
        <FolderSpecial fontSize="small" />
      </ListItemIcon>
      <ListItemText>{collection.name}</ListItemText>
    </MenuItem>
  );
}
