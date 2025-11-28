import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
} from '@mui/material';
import { Settings as SettingsIcon, VideoLibrary } from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleNavigate = (path: string) => {
    navigate(path);
    onClose();
  };

  const isAdmin = user?.role === 'Admin';

  return (
    <Drawer open={open} onClose={onClose}>
      <Toolbar />
      <List sx={{ width: 250 }}>
        {isAdmin && (
          <>
            <ListItem disablePadding>
              <ListItemButton
                selected={location.pathname === '/libraries'}
                onClick={() => handleNavigate('/libraries')}
              >
                <ListItemIcon>
                  <VideoLibrary />
                </ListItemIcon>
                <ListItemText primary={t('nav.libraries')} />
              </ListItemButton>
            </ListItem>
            <ListItem disablePadding>
              <ListItemButton
                selected={location.pathname === '/settings'}
                onClick={() => handleNavigate('/settings')}
              >
                <ListItemIcon>
                  <SettingsIcon />
                </ListItemIcon>
                <ListItemText primary={t('nav.settings')} />
              </ListItemButton>
            </ListItem>
          </>
        )}
      </List>
    </Drawer>
  );
}
