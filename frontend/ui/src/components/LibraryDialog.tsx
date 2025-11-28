import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Box,
} from '@mui/material';
import {
  apiClient,
  type Library,
  type LibraryType,
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
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const lastLibraryIdRef = useRef<string | null>(null);

  const isEditing = !!library;

  // Reset form when library changes (using ref to avoid re-render loop)
  const currentLibraryId = library?.id ?? null;
  if (currentLibraryId !== lastLibraryIdRef.current) {
    lastLibraryIdRef.current = currentLibraryId;
    if (library) {
      setName(library.name);
      setPath(library.path);
      setLibraryType(library.libraryType);
    } else {
      setName('');
      setPath('');
      setLibraryType('Film');
    }
    setError(null);
  }

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
