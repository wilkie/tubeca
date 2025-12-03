import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Box,
  Menu,
  MenuItem,
  Divider,
  Button,
} from '@mui/material';
import { Menu as MenuIcon, Search, AccountCircle } from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';
import { useActiveLibrary } from '../context/ActiveLibraryContext';
import { apiClient, type Library } from '../api/client';
import styles from './Header.module.scss';

interface HeaderProps {
  onMenuClick?: () => void
}

export function Header({ onMenuClick }: HeaderProps) {
  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const { user, logout } = useAuth();
  const { activeLibraryId, setActiveLibrary } = useActiveLibrary();
  const navigate = useNavigate();

  // Fetch libraries when user is logged in
  useEffect(() => {
    if (user) {
      apiClient.getLibraries().then((result) => {
        if (result.data) {
          setLibraries(result.data.libraries);
        }
      });
    }
  }, [user]);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = () => {
    handleMenuClose();
    logout();
    navigate('/login');
  };

  const handleLibraryClick = (libraryId: string) => {
    // Set active library before navigating to prevent flash
    setActiveLibrary(libraryId);
    navigate(`/library/${libraryId}`);
  };

  return (
    <AppBar position="static" className={styles.header}>
      <Toolbar sx={{ minHeight: '48px !important' }}>
        <IconButton
          size="large"
          edge="start"
          color="inherit"
          aria-label={t('header.menu')}
          onClick={onMenuClick}
          sx={{ mr: 2 }}
        >
          <MenuIcon />
        </IconButton>

        <Typography
          variant="h6"
          component="div"
          className={styles.title}
          sx={{ fontFamily: '"Praise", cursive', fontSize: '1.75rem' }}
        >
          {t('app.name')}
        </Typography>

        {/* Library Navigation Buttons */}
        <Box sx={{ display: 'flex', gap: 1, mx: 2 }}>
          {libraries.map((library) => {
            const isActive = activeLibraryId === library.id;
            return (
              <Button
                key={library.id}
                color="inherit"
                onClick={() => handleLibraryClick(library.id)}
                sx={{
                  textTransform: 'none',
                  fontWeight: isActive ? 'bold' : 'normal',
                  borderBottom: isActive ? '2px solid white' : '2px solid transparent',
                  borderRadius: 0,
                  px: 2,
                }}
              >
                {library.name}
              </Button>
            );
          })}
        </Box>

        <Box sx={{ flexGrow: 1 }} />

        <IconButton
          size="large"
          color="inherit"
          aria-label={t('header.search')}
          onClick={() => navigate('/search')}
        >
          <Search />
        </IconButton>

        <IconButton
          size="large"
          color="inherit"
          aria-label={t('header.account')}
          onClick={handleMenuOpen}
        >
          <AccountCircle />
        </IconButton>

        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleMenuClose}
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'right',
          }}
          transformOrigin={{
            vertical: 'top',
            horizontal: 'right',
          }}
        >
          {user && (
            <Box sx={{ px: 2, py: 1 }}>
              <Typography variant="subtitle1">{user.name}</Typography>
            </Box>
          )}
          <Divider />
          <MenuItem onClick={handleLogout}>{t('auth.logout')}</MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
}
