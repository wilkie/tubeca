import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from '@mui/material';

interface DeleteCollectionDialogProps {
  open: boolean;
  collectionName: string;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteCollectionDialog({
  open,
  collectionName,
  isDeleting,
  onCancel,
  onConfirm,
}: DeleteCollectionDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      aria-labelledby="delete-dialog-title"
      aria-describedby="delete-dialog-description"
    >
      <DialogTitle id="delete-dialog-title">
        {t('collection.deleteTitle', 'Delete Collection?')}
      </DialogTitle>
      <DialogContent>
        <DialogContentText id="delete-dialog-description">
          {t(
            'collection.deleteConfirmation',
            'Are you sure you want to delete "{{name}}"? This action cannot be undone and will remove all associated media and metadata.',
            { name: collectionName }
          )}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={isDeleting}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button
          onClick={onConfirm}
          color="error"
          variant="contained"
          disabled={isDeleting}
        >
          {isDeleting
            ? t('common.deleting', 'Deleting...')
            : t('common.delete', 'Delete')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
