import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  InputAdornment,
  InputBase,
  Box,
  Menu,
  MenuItem,
  Divider,
  Button,
} from '@mui/material';
import { Menu as MenuIcon, Search, AccountCircle, Favorite, WatchLater, QueueMusic } from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';
import { useActiveLibrary } from '../context/ActiveLibraryContext';
import { useLibraries } from '../hooks/useLibraries';
import styles from './Header.module.scss';

interface HeaderProps {
  onMenuClick?: () => void
}

export function Header({ onMenuClick }: HeaderProps) {
  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [search, setSearch] = useState('');
  const { user, logout } = useAuth();
  const { activeLibraryId, setActiveLibrary } = useActiveLibrary();
  const navigate = useNavigate();

  // Shared with the sidebar and the home page through the query cache.
  const { libraries } = useLibraries(Boolean(user));

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

  /**
   * The search page reads its query from `?q=`, so the box only has to send
   * one there; the page owns the searching, the history entry and the results.
   */
  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const query = search.trim();
    navigate(query ? `/search?q=${encodeURIComponent(query)}` : '/search');
  };

  const handleLibraryClick = (libraryId: string) => {
    // Set active library before navigating to prevent flash
    setActiveLibrary(libraryId);
    navigate(`/library/${libraryId}`);
  };

  return (
    <AppBar position="sticky" className={styles.header}>
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

        {/* A box from sm up, the icon alone on a narrow screen. */}
        <Box
          component="form"
          role="search"
          onSubmit={handleSearchSubmit}
          sx={{
            display: { xs: 'none', sm: 'flex' },
            alignItems: 'center',
            mr: 1,
            px: 1,
            borderRadius: 1,
            bgcolor: 'rgba(255, 255, 255, 0.12)',
            '&:focus-within': { bgcolor: 'rgba(255, 255, 255, 0.2)' },
          }}
        >
          <InputBase
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('header.searchPlaceholder', 'Search')}
            // type=search gives it the searchbox role and, on a phone, a
            // keyboard with a search key rather than a return key.
            inputProps={{ 'aria-label': t('header.search'), type: 'search' }}
            sx={{ color: 'inherit', width: { sm: 140, md: 200 } }}
            startAdornment={
              <InputAdornment position="start" sx={{ color: 'inherit' }}>
                <Search fontSize="small" />
              </InputAdornment>
            }
          />
        </Box>

        <IconButton
          size="large"
          color="inherit"
          aria-label={t('header.search')}
          onClick={() => navigate('/search')}
          sx={{ display: { xs: 'inline-flex', sm: 'none' } }}
        >
          <Search />
        </IconButton>

        <IconButton
          size="large"
          color="inherit"
          aria-label={t('header.favorites')}
          onClick={() => navigate('/favorites')}
          sx={{ display: { xs: 'none', md: 'inline-flex' } }}
        >
          <Favorite />
        </IconButton>

        <IconButton
          size="large"
          color="inherit"
          aria-label={t('header.watchLater')}
          onClick={() => navigate('/watch-later')}
          sx={{ display: { xs: 'none', md: 'inline-flex' } }}
        >
          <WatchLater />
        </IconButton>

        <IconButton
          size="large"
          color="inherit"
          aria-label={t('header.queue')}
          onClick={() => navigate('/queue')}
          sx={{ display: { xs: 'none', md: 'inline-flex' } }}
        >
          <QueueMusic />
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
