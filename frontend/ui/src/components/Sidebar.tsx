import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Toolbar,
} from '@mui/material';
import {
  Settings as SettingsIcon,
  VideoLibrary,
  People,
  Tv,
  Movie,
  MusicNote,
  FolderSpecial,
} from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';
import { useActiveLibrary } from '../context/ActiveLibraryContext';
import { apiClient, type Library, type LibraryType } from '../api/client';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

const libraryTypeIcons: Record<LibraryType, React.ReactNode> = {
  Television: <Tv />,
  Film: <Movie />,
  Music: <MusicNote />,
};

export function Sidebar({ open, onClose }: SidebarProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { setActiveLibrary } = useActiveLibrary();
  const navigate = useNavigate();
  const location = useLocation();
  const [libraries, setLibraries] = useState<Library[]>([]);

  useEffect(() => {
    if (open && user) {
      apiClient.getLibraries().then((result) => {
        if (result.data) {
          setLibraries(result.data.libraries);
        }
      });
    }
  }, [open, user]);

  const handleNavigate = (path: string) => {
    navigate(path);
    onClose();
  };

  const handleLibraryNavigate = (libraryId: string) => {
    // Set active library before navigating to prevent flash
    setActiveLibrary(libraryId);
    navigate(`/library/${libraryId}`);
    onClose();
  };

  const isAdmin = user?.role === 'Admin';

  return (
    <Drawer open={open} onClose={onClose}>
      <Toolbar />
      <List sx={{ width: 250 }}>
        {/* Libraries section */}
        <ListSubheader>{t('nav.librariesSection')}</ListSubheader>
        {libraries.length === 0 ? (
          <ListItem>
            <ListItemText
              secondary={t('nav.noLibraries')}
              sx={{ pl: 2 }}
            />
          </ListItem>
        ) : (
          libraries.map((library) => (
            <ListItem key={library.id} disablePadding>
              <ListItemButton
                selected={location.pathname === `/library/${library.id}`}
                onClick={() => handleLibraryNavigate(library.id)}
              >
                <ListItemIcon>
                  {libraryTypeIcons[library.libraryType]}
                </ListItemIcon>
                <ListItemText primary={library.name} />
              </ListItemButton>
            </ListItem>
          ))
        )}

        {/* My Collections */}
        <ListItem disablePadding sx={{ mt: 1 }}>
          <ListItemButton
            selected={location.pathname.startsWith('/my-collections')}
            onClick={() => handleNavigate('/my-collections')}
          >
            <ListItemIcon>
              <FolderSpecial />
            </ListItemIcon>
            <ListItemText primary={t('userCollections.title')} />
          </ListItemButton>
        </ListItem>

        {/* Administration section (Admin only) */}
        {isAdmin && (
          <>
            <ListSubheader sx={{ mt: 2 }}>{t('nav.administration')}</ListSubheader>
            <ListItem disablePadding>
              <ListItemButton
                selected={location.pathname === '/admin/libraries'}
                onClick={() => handleNavigate('/admin/libraries')}
              >
                <ListItemIcon>
                  <VideoLibrary />
                </ListItemIcon>
                <ListItemText primary={t('nav.libraries')} />
              </ListItemButton>
            </ListItem>
            <ListItem disablePadding>
              <ListItemButton
                selected={location.pathname === '/admin/users'}
                onClick={() => handleNavigate('/admin/users')}
              >
                <ListItemIcon>
                  <People />
                </ListItemIcon>
                <ListItemText primary={t('nav.users')} />
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
