import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  FormControlLabel,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  Alert,
  CircularProgress,
  Box,
  Chip,
  OutlinedInput,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import {
  apiClient,
  type Library,
  type LibraryType,
  type Group,
} from '../api/client';

interface LibraryDialogProps {
  open: boolean;
  library: Library | null;
  onClose: () => void;
  onSave: () => void;
}

const LIBRARY_TYPES: LibraryType[] = ['Television', 'Film', 'Music'];

export function LibraryDialog({ open, library, onClose, onSave }: LibraryDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [libraryType, setLibraryType] = useState<LibraryType>('Film');
  const [watchForChanges, setWatchForChanges] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [availableGroups, setAvailableGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const lastLibraryIdRef = useRef<string | null>(null);

  const isEditing = !!library;

  // Load available groups when dialog opens
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    async function loadGroups() {
      const result = await apiClient.getGroups();
      if (cancelled) return;
      if (result.data) {
        setAvailableGroups(result.data.groups);
      }
    }
    loadGroups();
    return () => { cancelled = true; };
  }, [open]);

  // Reset form when library changes (using ref to avoid re-render loop)
  const currentLibraryId = library?.id ?? null;
  if (currentLibraryId !== lastLibraryIdRef.current) {
    lastLibraryIdRef.current = currentLibraryId;
    if (library) {
      setName(library.name);
      setPath(library.path);
      setLibraryType(library.libraryType);
      setWatchForChanges(library.watchForChanges);
      setSelectedGroupIds(library.groups.map(g => g.id));
    } else {
      setName('');
      setPath('');
      setLibraryType('Film');
      setWatchForChanges(false);
      setSelectedGroupIds([]);
    }
    setError(null);
  }

  const handleGroupChange = (event: SelectChangeEvent<string[]>) => {
    const value = event.target.value;
    setSelectedGroupIds(typeof value === 'string' ? value.split(',') : value);
  };

  const handleSubmit = async () => {
    setError(null);

    if (!name.trim() || !path.trim()) {
      setError(t('libraries.validation.required'));
      return;
    }

    setIsSaving(true);

    const input = {
      name: name.trim(),
      path: path.trim(),
      libraryType,
      watchForChanges,
      groupIds: selectedGroupIds,
    };

    const result = isEditing
      ? await apiClient.updateLibrary(library.id, input)
      : await apiClient.createLibrary(input);

    setIsSaving(false);

    if (result.error) {
      setError(result.error);
    } else {
      onSave();
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {isEditing ? t('libraries.edit') : t('libraries.create')}
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2, mt: 1 }}>
            {error}
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label={t('libraries.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
            autoFocus
          />

          <TextField
            label={t('libraries.path')}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            fullWidth
            required
            helperText={t('libraries.pathHelp')}
          />

          <FormControl fullWidth>
            <InputLabel>{t('libraries.libraryType')}</InputLabel>
            <Select
              value={libraryType}
              label={t('libraries.libraryType')}
              onChange={(e) => setLibraryType(e.target.value as LibraryType)}
            >
              {LIBRARY_TYPES.map((type) => (
                <MenuItem key={type} value={type}>
                  {t(`libraries.libraryTypes.${type}`)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth>
            <InputLabel>{t('libraries.groups')}</InputLabel>
            <Select
              multiple
              value={selectedGroupIds}
              onChange={handleGroupChange}
              input={<OutlinedInput label={t('libraries.groups')} />}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {selected.length === 0 ? (
                    <Chip label={t('libraries.noGroups')} size="small" />
                  ) : (
                    selected.map((id) => {
                      const group = availableGroups.find(g => g.id === id);
                      return <Chip key={id} label={group?.name ?? id} size="small" />;
                    })
                  )}
                </Box>
              )}
            >
              {availableGroups.map((group) => (
                <MenuItem key={group.id} value={group.id}>
                  {group.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Box sx={{ mt: -1.5, ml: 0.5, color: 'text.secondary', fontSize: '0.75rem' }}>
            {t('libraries.groupsHelp')}
          </Box>

          <FormControlLabel
            control={
              <Switch
                checked={watchForChanges}
                onChange={(e) => setWatchForChanges(e.target.checked)}
              />
            }
            label={t('libraries.watchForChanges')}
          />
          <Box sx={{ mt: -1.5, ml: 0.5, color: 'text.secondary', fontSize: '0.75rem' }}>
            {t('libraries.watchForChangesHelp')}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSaving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={isSaving}>
          {isSaving ? <CircularProgress size={24} /> : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
