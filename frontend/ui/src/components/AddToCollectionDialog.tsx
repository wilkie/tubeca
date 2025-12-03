import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Checkbox,
  CircularProgress,
  Box,
  TextField,
  Alert,
  Divider,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  Tooltip,
} from '@mui/material';
import { Add, FolderSpecial, SortByAlpha, Update, ArrowUpward, ArrowDownward } from '@mui/icons-material';
import { apiClient, type UserCollection } from '../api/client';

interface AddToCollectionDialogProps {
  open: boolean;
  onClose: () => void;
  collectionId?: string; // Library collection ID to add
  mediaId?: string; // Media ID to add
  itemName: string; // Name of the item for display
}

export function AddToCollectionDialog({
  open,
  onClose,
  collectionId,
  mediaId,
  itemName,
}: AddToCollectionDialogProps) {
  const { t } = useTranslation();
  const [collections, setCollections] = useState<UserCollection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isCreating, setIsCreating] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'updatedAt'>('updatedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function fetchCollections() {
      setIsLoading(true);
      setError(null);

      const result = await apiClient.getUserCollections();
      if (cancelled) return;

      if (result.error) {
        setError(result.error);
      } else if (result.data) {
        setCollections(result.data.userCollections);
      }

      setIsLoading(false);
    }

    fetchCollections();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleToggle = (collectionId: string) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(collectionId)) {
        newSet.delete(collectionId);
      } else {
        newSet.add(collectionId);
      }
      return newSet;
    });
  };

  const handleCreateNew = async () => {
    if (!newCollectionName.trim()) return;

    setIsSaving(true);
    const result = await apiClient.createUserCollection({
      name: newCollectionName.trim(),
    });

    if (result.error) {
      setError(result.error);
      setIsSaving(false);
      return;
    }

    if (result.data) {
      setCollections((prev) => [result.data!.userCollection, ...prev]);
      setSelectedIds((prev) => new Set([...prev, result.data!.userCollection.id]));
      setNewCollectionName('');
      setIsCreating(false);
    }

    setIsSaving(false);
  };

  const handleSave = async () => {
    if (selectedIds.size === 0) {
      onClose();
      return;
    }

    setIsSaving(true);
    setError(null);

    const input = collectionId ? { collectionId } : { mediaId };

    // Add to each selected collection
    const results = await Promise.all(
      Array.from(selectedIds).map((id) =>
        apiClient.addUserCollectionItem(id, input)
      )
    );

    const errors = results.filter((r) => r.error);
    if (errors.length > 0) {
      // Filter out "already exists" errors since they're not really failures
      const realErrors = errors.filter(
        (e) => !e.error?.includes('already exists')
      );
      if (realErrors.length > 0) {
        setError(realErrors.map((e) => e.error).join(', '));
        setIsSaving(false);
        return;
      }
    }

    setIsSaving(false);
    handleClose();
  };

  const handleClose = () => {
    setSelectedIds(new Set());
    setIsCreating(false);
    setNewCollectionName('');
    setError(null);
    onClose();
  };

  const handleSortByChange = (_: React.MouseEvent<HTMLElement>, value: 'name' | 'updatedAt' | null) => {
    if (value) setSortBy(value);
  };

  const toggleSortDir = () => {
    setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  };

  // Sort collections based on current settings
  const sortedCollections = [...collections].sort((a, b) => {
    let comparison = 0;
    if (sortBy === 'name') {
      comparison = a.name.localeCompare(b.name);
    } else {
      // Sort by updatedAt
      const dateA = new Date(a.updatedAt).getTime();
      const dateB = new Date(b.updatedAt).getTime();
      comparison = dateA - dateB;
    }
    return sortDir === 'asc' ? comparison : -comparison;
  });

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('userCollections.addToCollection')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {itemName}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {isCreating ? (
              <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                <TextField
                  label={t('userCollections.name')}
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  fullWidth
                  autoFocus
                  size="small"
                />
                <Button
                  variant="contained"
                  onClick={handleCreateNew}
                  disabled={!newCollectionName.trim() || isSaving}
                >
                  {t('common.create')}
                </Button>
                <Button onClick={() => setIsCreating(false)}>
                  {t('common.cancel')}
                </Button>
              </Box>
            ) : (
              <Button
                startIcon={<Add />}
                onClick={() => setIsCreating(true)}
                sx={{ mb: 2 }}
              >
                {t('userCollections.create')}
              </Button>
            )}

            <Divider sx={{ mb: 1 }} />

            {collections.length === 0 ? (
              <Alert severity="info">{t('userCollections.empty')}</Alert>
            ) : (
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <ToggleButtonGroup
                    value={sortBy}
                    exclusive
                    onChange={handleSortByChange}
                    size="small"
                  >
                    <ToggleButton value="name">
                      <Tooltip title={t('common.sortByName', 'Sort by name')}>
                        <SortByAlpha fontSize="small" />
                      </Tooltip>
                    </ToggleButton>
                    <ToggleButton value="updatedAt">
                      <Tooltip title={t('common.sortByDate', 'Sort by date')}>
                        <Update fontSize="small" />
                      </Tooltip>
                    </ToggleButton>
                  </ToggleButtonGroup>
                  <Tooltip title={sortDir === 'asc' ? t('common.ascending', 'Ascending') : t('common.descending', 'Descending')}>
                    <ToggleButton
                      value="dir"
                      selected
                      onChange={toggleSortDir}
                      size="small"
                    >
                      {sortDir === 'asc' ? <ArrowUpward fontSize="small" /> : <ArrowDownward fontSize="small" />}
                    </ToggleButton>
                  </Tooltip>
                </Box>
                <List sx={{ maxHeight: 300, overflow: 'auto' }}>
                  {sortedCollections.map((collection) => (
                  <ListItem key={collection.id} disablePadding>
                    <ListItemButton
                      onClick={() => handleToggle(collection.id)}
                      dense
                    >
                      <ListItemIcon>
                        <Checkbox
                          edge="start"
                          checked={selectedIds.has(collection.id)}
                          tabIndex={-1}
                          disableRipple
                        />
                      </ListItemIcon>
                      <ListItemIcon sx={{ minWidth: 40 }}>
                        <FolderSpecial />
                      </ListItemIcon>
                      <ListItemText
                        primary={collection.name}
                        secondary={t('userCollections.itemCount', {
                          count: collection._count?.items ?? 0,
                        })}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
                </List>
              </>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={isSaving}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={selectedIds.size === 0 || isSaving}
        >
          {isSaving ? <CircularProgress size={24} /> : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
