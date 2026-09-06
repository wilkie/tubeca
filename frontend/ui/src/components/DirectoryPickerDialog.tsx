import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';
import { ArrowUpward, Folder } from '@mui/icons-material';
import { apiClient } from '../api/client';
import { useApiQuery } from '../hooks/useApiQuery';
import { useNarrowScreen } from '../hooks/useNarrowScreen';

interface DirectoryPickerDialogProps {
  open: boolean;
  /** Where to start browsing; falls back to the filesystem root. */
  initialPath?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}

/**
 * Browse the server's folders and pick one.
 *
 * A library path is typed by an admin who is often not sitting at the server,
 * so a typo is only caught when the scan finds nothing. Listing the real
 * directories removes the guesswork. It shows folders only, and the endpoint
 * behind it is admin-only.
 */
export function DirectoryPickerDialog({ open, initialPath, onClose, onSelect }: DirectoryPickerDialogProps) {
  const { t } = useTranslation();
  // A dialog sized for a desktop is unusable on a phone; below `sm` it takes
  // the screen, and its Cancel button is the way out with no backdrop to tap.
  const narrow = useNarrowScreen();
  const [browsingPath, setBrowsingPath] = useState<string | undefined>(initialPath);

  const { data, isPending, errorMessage } = useApiQuery(
    ['browse', browsingPath ?? ''],
    () => apiClient.browseDirectories(browsingPath),
    { enabled: open }
  );

  const currentPath = data?.path ?? browsingPath ?? '';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      fullScreen={narrow}
    >
      <DialogTitle>{t('libraries.choosePath', 'Choose a folder')}</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Button
            size="small"
            startIcon={<ArrowUpward />}
            disabled={!data?.parent}
            onClick={() => setBrowsingPath(data?.parent ?? undefined)}
          >
            {t('libraries.parentFolder', 'Up')}
          </Button>
          <Breadcrumbs sx={{ overflow: 'hidden' }}>
            <Typography variant="body2" noWrap title={currentPath}>
              {currentPath}
            </Typography>
          </Breadcrumbs>
        </Box>

        {errorMessage && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {errorMessage}
          </Alert>
        )}

        {isPending ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : data && data.directories.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            {t('libraries.noSubfolders', 'No folders here.')}
          </Typography>
        ) : (
          <List dense sx={{ maxHeight: 320, overflow: 'auto' }}>
            {data?.directories.map((directory) => (
              <ListItemButton key={directory.path} onClick={() => setBrowsingPath(directory.path)}>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <Folder fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={directory.name} />
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!currentPath}
          onClick={() => {
            onSelect(currentPath);
            onClose();
          }}
        >
          {t('libraries.useThisFolder', 'Use this folder')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
