import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Paper,
  Stack,
  Typography,
  Button,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Divider,
  TextField,
  Box,
  CircularProgress,
} from '@mui/material';
import { Close, Add, FolderSpecial, PlaylistAdd } from '@mui/icons-material';
import { apiClient, type UserCollection } from '../api/client';

interface SelectionActionBarProps {
  selectedCount: number;
  selectedIds: string[];
  onClear: () => void;
  onAddComplete?: () => void;
}

export function SelectionActionBar({
  selectedCount,
  selectedIds,
  onClear,
  onAddComplete,
}: SelectionActionBarProps) {
  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [collections, setCollections] = useState<UserCollection[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');

  const menuOpen = Boolean(anchorEl);

  // Fetch user collections when menu opens
  useEffect(() => {
    if (!menuOpen) return;

    let cancelled = false;

    async function fetchCollections() {
      setIsLoading(true);
      const result = await apiClient.getUserCollections();
      if (cancelled) return;

      if (result.data) {
        // Sort by updatedAt descending (most recent first)
        const sorted = [...result.data.userCollections].sort((a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        setCollections(sorted);
      }
      setIsLoading(false);
    }

    fetchCollections();

    return () => {
      cancelled = true;
    };
  }, [menuOpen]);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setIsCreating(false);
    setNewCollectionName('');
  };

  const handleAddToCollection = async (collectionId: string) => {
    setIsAdding(true);

    // Add all selected items to the collection
    const results = await Promise.all(
      selectedIds.map((id) =>
        apiClient.addUserCollectionItem(collectionId, { collectionId: id })
      )
    );

    // Check for real errors (not "already exists")
    const errors = results.filter(
      (r) => r.error && !r.error.includes('already exists')
    );

    setIsAdding(false);

    if (errors.length === 0) {
      handleMenuClose();
      onClear();
      onAddComplete?.();
    }
  };

  const handleCreateNew = async () => {
    if (!newCollectionName.trim()) return;

    setIsAdding(true);
    const result = await apiClient.createUserCollection({
      name: newCollectionName.trim(),
    });

    if (result.data) {
      // Add items to the new collection
      await handleAddToCollection(result.data.userCollection.id);
    }

    setIsAdding(false);
  };

  if (selectedCount === 0) return null;

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1200,
        borderRadius: 2,
        px: 2,
        py: 1.5,
      }}
    >
      <Stack direction="row" spacing={2} alignItems="center">
        <Typography variant="body1" fontWeight="medium">
          {t('selection.itemsSelected', { count: selectedCount })}
        </Typography>

        <Button
          variant="contained"
          startIcon={<PlaylistAdd />}
          onClick={handleMenuOpen}
          disabled={isAdding}
        >
          {t('userCollections.addToCollection')}
        </Button>

        <IconButton size="small" onClick={onClear} aria-label={t('selection.clear')}>
          <Close />
        </IconButton>
      </Stack>

      <Menu
        anchorEl={anchorEl}
        open={menuOpen}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        slotProps={{
          paper: {
            sx: { minWidth: 280, maxHeight: 400 },
          },
        }}
      >
        <ListSubheader>{t('userCollections.addTo')}</ListSubheader>

        {isCreating ? (
          <Box sx={{ px: 2, py: 1 }}>
            <TextField
              label={t('userCollections.name')}
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              fullWidth
              autoFocus
              size="small"
              sx={{ mb: 1 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCreateNew();
                } else if (e.key === 'Escape') {
                  setIsCreating(false);
                  setNewCollectionName('');
                }
              }}
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                size="small"
                onClick={handleCreateNew}
                disabled={!newCollectionName.trim() || isAdding}
              >
                {isAdding ? <CircularProgress size={20} /> : t('common.create')}
              </Button>
              <Button
                size="small"
                onClick={() => {
                  setIsCreating(false);
                  setNewCollectionName('');
                }}
              >
                {t('common.cancel')}
              </Button>
            </Stack>
          </Box>
        ) : (
          <MenuItem onClick={() => setIsCreating(true)}>
            <ListItemIcon>
              <Add />
            </ListItemIcon>
            <ListItemText>{t('userCollections.create')}</ListItemText>
          </MenuItem>
        )}

        <Divider />

        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={24} />
          </Box>
        ) : collections.length === 0 ? (
          <MenuItem disabled>
            <ListItemText>{t('userCollections.empty')}</ListItemText>
          </MenuItem>
        ) : (
          collections.map((collection) => (
            <MenuItem
              key={collection.id}
              onClick={() => handleAddToCollection(collection.id)}
              disabled={isAdding}
            >
              <ListItemIcon>
                <FolderSpecial />
              </ListItemIcon>
              <ListItemText
                primary={collection.name}
                secondary={t('userCollections.itemCount', {
                  count: collection._count?.items ?? 0,
                })}
              />
            </MenuItem>
          ))
        )}
      </Menu>
    </Paper>
  );
}
