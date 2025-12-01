import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Container,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  CircularProgress,
  Alert,
  Chip,
  LinearProgress,
  Tooltip,
} from '@mui/material';
import { Add, Edit, Delete, Refresh, Stop, Visibility, VisibilityOff } from '@mui/icons-material';
import { apiClient, type Library, type ScanStatusResponse } from '../api/client';
import { LibraryDialog } from '../components/LibraryDialog';

interface ScanState {
  [libraryId: string]: ScanStatusResponse;
}

export function LibrariesPage() {
  const { t } = useTranslation();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLibrary, setEditingLibrary] = useState<Library | null>(null);
  const [scanStates, setScanStates] = useState<ScanState>({});
  const pollIntervalRef = useRef<number | null>(null);

  const loadLibraries = useCallback(async () => {
    const result = await apiClient.getLibraries();
    if (result.error) {
      setError(result.error);
    } else if (result.data) {
      setLibraries(result.data.libraries);
    }
    setIsLoading(false);
  }, []);

  const loadScanStatuses = useCallback(async (libraryIds: string[]) => {
    const statuses: ScanState = {};
    await Promise.all(
      libraryIds.map(async (id) => {
        const result = await apiClient.getLibraryScanStatus(id);
        if (result.data) {
          statuses[id] = result.data;
        }
      })
    );
    setScanStates(statuses);
    return statuses;
  }, []);

  // Initial load
  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      const result = await apiClient.getLibraries();
      if (cancelled) return;

      if (result.error) {
        setError(result.error);
      } else if (result.data) {
        setLibraries(result.data.libraries);
        // Load initial scan statuses
        await loadScanStatuses(result.data.libraries.map((l) => l.id));
      }
      setIsLoading(false);
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [loadScanStatuses]);

  // Poll for scan status updates when any scan is active
  useEffect(() => {
    const hasActiveScans = Object.values(scanStates).some((s) => s.scanning);

    if (hasActiveScans && !pollIntervalRef.current) {
      pollIntervalRef.current = window.setInterval(() => {
        loadScanStatuses(libraries.map((l) => l.id));
      }, 2000);
    } else if (!hasActiveScans && pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [scanStates, libraries, loadScanStatuses]);

  const handleCreate = () => {
    setEditingLibrary(null);
    setDialogOpen(true);
  };

  const handleEdit = (library: Library) => {
    setEditingLibrary(library);
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('libraries.confirmDelete'))) {
      return;
    }

    const result = await apiClient.deleteLibrary(id);
    if (result.error) {
      setError(result.error);
    } else {
      setLibraries(libraries.filter((lib) => lib.id !== id));
    }
  };

  const handleDialogClose = () => {
    setDialogOpen(false);
    setEditingLibrary(null);
  };

  const handleDialogSave = async () => {
    handleDialogClose();
    await loadLibraries();
  };

  const handleStartScan = async (libraryId: string) => {
    const result = await apiClient.startLibraryScan(libraryId);
    if (result.error) {
      setError(result.error);
    } else {
      // Update scan state immediately
      setScanStates((prev) => ({
        ...prev,
        [libraryId]: {
          status: 'waiting',
          scanning: true,
          progress: 0,
        },
      }));
    }
  };

  const handleCancelScan = async (libraryId: string) => {
    const result = await apiClient.cancelLibraryScan(libraryId);
    if (result.error) {
      setError(result.error);
    } else {
      // Refresh scan status
      const statusResult = await apiClient.getLibraryScanStatus(libraryId);
      if (statusResult.data) {
        setScanStates((prev) => ({
          ...prev,
          [libraryId]: statusResult.data!,
        }));
      }
    }
  };

  if (isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '50vh',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1">
          {t('libraries.title')}
        </Typography>
        <Button variant="contained" startIcon={<Add />} onClick={handleCreate}>
          {t('libraries.create')}
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('libraries.name')}</TableCell>
              <TableCell>{t('libraries.path')}</TableCell>
              <TableCell>{t('libraries.libraryType')}</TableCell>
              <TableCell>{t('libraries.groups')}</TableCell>
              <TableCell>{t('libraries.scan')}</TableCell>
              <TableCell align="right">{t('libraries.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {libraries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  {t('libraries.noLibraries')}
                </TableCell>
              </TableRow>
            ) : (
              libraries.map((library) => {
                const scanState = scanStates[library.id];
                const isScanning = scanState?.scanning;

                return (
                  <TableRow key={library.id}>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {library.watchForChanges ? (
                          <Tooltip title={t('libraries.watchForChanges')}>
                            <Visibility fontSize="small" color="action" sx={{ opacity: 0.6 }} />
                          </Tooltip>
                        ) : (
                          <Tooltip title={t('libraries.notWatching')}>
                            <VisibilityOff fontSize="small" sx={{ opacity: 0.25, color: 'text.disabled' }} />
                          </Tooltip>
                        )}
                        {library.name}
                      </Box>
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                      {library.path}
                    </TableCell>
                    <TableCell>{t(`libraries.libraryTypes.${library.libraryType}`)}</TableCell>
                    <TableCell>
                      {library.groups.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          {t('libraries.noGroups')}
                        </Typography>
                      ) : (
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                          {library.groups.map((group) => (
                            <Chip key={group.id} label={group.name} size="small" />
                          ))}
                        </Box>
                      )}
                    </TableCell>
                    <TableCell sx={{ minWidth: 180 }}>
                      {isScanning ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ flexGrow: 1 }}>
                            <LinearProgress
                              variant="determinate"
                              value={scanState.progress}
                              sx={{ height: 8, borderRadius: 4 }}
                            />
                            <Typography variant="caption" color="text.secondary">
                              {scanState.progress}%
                            </Typography>
                          </Box>
                          <Tooltip title={t('libraries.cancelScan')}>
                            <IconButton
                              size="small"
                              onClick={() => handleCancelScan(library.id)}
                              color="warning"
                            >
                              <Stop />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      ) : (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {scanState?.status === 'completed' && scanState.result && (
                            <Tooltip
                              title={t('libraries.scanResult', {
                                files: scanState.result.filesProcessed,
                                collections: scanState.result.collectionsCreated,
                                media: scanState.result.mediaCreated,
                              })}
                            >
                              <Chip
                                label={t('libraries.scanComplete')}
                                size="small"
                                color="success"
                                variant="outlined"
                              />
                            </Tooltip>
                          )}
                          {scanState?.status === 'failed' && (
                            <Tooltip title={scanState.failedReason || t('libraries.scanFailed')}>
                              <Chip
                                label={t('libraries.scanFailed')}
                                size="small"
                                color="error"
                                variant="outlined"
                              />
                            </Tooltip>
                          )}
                          <Tooltip title={t('libraries.startScan')}>
                            <IconButton
                              size="small"
                              onClick={() => handleStartScan(library.id)}
                              color="primary"
                            >
                              <Refresh />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <IconButton onClick={() => handleEdit(library)} size="small">
                        <Edit />
                      </IconButton>
                      <IconButton
                        onClick={() => handleDelete(library.id)}
                        size="small"
                        color="error"
                        disabled={isScanning}
                      >
                        <Delete />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <LibraryDialog
        open={dialogOpen}
        library={editingLibrary}
        onClose={handleDialogClose}
        onSave={handleDialogSave}
      />
    </Container>
  );
}
