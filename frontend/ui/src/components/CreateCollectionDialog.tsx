import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControlLabel,
  Switch,
  Box,
} from '@mui/material';

interface CreateCollectionDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string, isPublic: boolean) => void;
}

export function CreateCollectionDialog({ open, onClose, onCreate }: CreateCollectionDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    if (!name.trim()) {
      setError(t('userCollections.validation.nameRequired'));
      return;
    }
    onCreate(name.trim(), description.trim(), isPublic);
    handleClose();
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setIsPublic(false);
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('userCollections.create')}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField
            label={t('userCollections.name')}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            error={!!error}
            helperText={error}
            fullWidth
            autoFocus
          />
          <TextField
            label={t('userCollections.description')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={3}
          />
          <FormControlLabel
            control={
              <Switch
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />
            }
            label={isPublic ? t('userCollections.public') : t('userCollections.private')}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{t('common.cancel')}</Button>
        <Button onClick={handleSubmit} variant="contained">
          {t('common.create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
