import { AppBar, Toolbar, Typography, IconButton, Box } from '@mui/material'
import { Menu as MenuIcon, Search, AccountCircle } from '@mui/icons-material'
import styles from './Header.module.scss'

interface HeaderProps {
  onMenuClick?: () => void
}

export function Header({ onMenuClick }: HeaderProps) {
  return (
    <AppBar position="static" className={styles.header}>
      <Toolbar>
        <IconButton
          size="large"
          edge="start"
          color="inherit"
          aria-label="menu"
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
          Tubeca
        </Typography>

        <Box sx={{ flexGrow: 1 }} />

        <IconButton
          size="large"
          color="inherit"
          aria-label="search"
        >
          <Search />
        </IconButton>

        <IconButton
          size="large"
          color="inherit"
          aria-label="account"
        >
          <AccountCircle />
        </IconButton>
      </Toolbar>
    </AppBar>
  )
}
