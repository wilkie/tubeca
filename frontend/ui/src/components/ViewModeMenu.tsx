import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, Menu, MenuItem, ListItemIcon, ListItemText, Tooltip } from '@mui/material';
import { ViewModule, ViewList, Check } from '@mui/icons-material';

export type ViewMode = 'poster' | 'list';

interface ViewModeMenuProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ViewModeMenu({ value, onChange }: ViewModeMenuProps) {
  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleSelect = (mode: ViewMode) => {
    onChange(mode);
    handleClose();
  };

  const ViewIcon = value === 'poster' ? ViewModule : ViewList;

  return (
    <>
      <Tooltip title={t('view.toggle', 'Change view')}>
        <IconButton
          size="small"
          onClick={handleClick}
          aria-label={t('view.toggle', 'Change view')}
          aria-controls={open ? 'view-mode-menu' : undefined}
          aria-haspopup="true"
          aria-expanded={open ? 'true' : undefined}
        >
          <ViewIcon />
        </IconButton>
      </Tooltip>
      <Menu
        id="view-mode-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
      >
        <MenuItem onClick={() => handleSelect('poster')}>
          <ListItemIcon>
            <ViewModule fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('view.poster', 'Poster')}</ListItemText>
          {value === 'poster' && <Check fontSize="small" sx={{ ml: 1 }} />}
        </MenuItem>
        <MenuItem onClick={() => handleSelect('list')}>
          <ListItemIcon>
            <ViewList fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('view.list', 'List')}</ListItemText>
          {value === 'list' && <Check fontSize="small" sx={{ ml: 1 }} />}
        </MenuItem>
      </Menu>
    </>
  );
}
