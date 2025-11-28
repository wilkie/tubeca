import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Box,
  Menu,
  MenuItem,
  Divider,
} from '@mui/material'
import { Menu as MenuIcon, Search, AccountCircle } from '@mui/icons-material'
import { useAuth } from '../context/AuthContext'
import styles from './Header.module.scss'

interface HeaderProps {
  onMenuClick?: () => void
}

export function Header({ onMenuClick }: HeaderProps) {
  const { t } = useTranslation()
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget)
  }

  const handleMenuClose = () => {
    setAnchorEl(null)
  }

  const handleLogout = () => {
    handleMenuClose()
    logout()
    navigate('/login')
  }

  return (
    <AppBar position="static" className={styles.header}>
      <Toolbar>
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
        >
          {t('app.name')}
        </Typography>

        <Box sx={{ flexGrow: 1 }} />

        <IconButton
          size="large"
          color="inherit"
          aria-label={t('header.search')}
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
  )
}
