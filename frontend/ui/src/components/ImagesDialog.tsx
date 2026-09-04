import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardMedia,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  Typography,
} from '@mui/material';
import { Check, Close, Delete, Download, Upload } from '@mui/icons-material';
import { apiClient, type ArtworkCandidate, type Image } from '../api/client';

interface ImagesDialogProps {
  open: boolean;
  onClose: () => void;
  images: Image[];
  title?: string;
  /** The entity these images belong to; enables uploading. */
  collectionId?: string;
  mediaId?: string;
  /** Editors can choose, upload and remove artwork. */
  canEdit?: boolean;
  /** Called after a change, so the page can reload the entity. */
  onChanged?: () => void;
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let size = bytes;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * The artwork an entity has, and for an editor, which of it to use.
 *
 * A scrape saves one image per type, but a provider usually has a dozen. Those
 * others are listed underneath as URLs and fetched only when one is chosen, so
 * a library does not carry ten posters per title that nobody asked for.
 */
export function ImagesDialog({
  open,
  onClose,
  images,
  title,
  collectionId,
  mediaId,
  canEdit = false,
  onChanged,
}: ImagesDialogProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canUpload = canEdit && Boolean(collectionId || mediaId);
  // Only a collection has a provider identity to ask about.
  const canBrowseProvider = canEdit && Boolean(collectionId);

  const [candidates, setCandidates] = useState<ArtworkCandidate[]>([]);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);

  const loadCandidates = useCallback(async () => {
    if (!collectionId) return;
    const result = await apiClient.getArtworkCandidates(collectionId);
    // A collection nobody has identified has nothing to offer, which is a
    // normal state rather than a failure worth an alert.
    setCandidatesError(result.error ?? null);
    setCandidates(result.data?.candidates ?? []);
  }, [collectionId]);

  // Asked for when the dialog opens, not when the page renders: it makes the
  // provider work. Nothing is set until the answer arrives, so a dialog closed
  // in the meantime leaves no state behind.
  useEffect(() => {
    if (!open || !canBrowseProvider) return;
    let cancelled = false;

    void apiClient.getArtworkCandidates(collectionId!).then((result) => {
      if (cancelled) return;
      setCandidatesError(result.error ?? null);
      setCandidates(result.data?.candidates ?? []);
    });

    return () => {
      cancelled = true;
    };
  }, [open, canBrowseProvider, collectionId]);

  const handleSetPrimary = async (image: Image) => {
    setBusy(true);
    setError(null);
    const result = await apiClient.setPrimaryImage(image.id);
    setBusy(false);
    if (result.error) setError(result.error);
    else onChanged?.();
  };

  const handleDelete = async (image: Image) => {
    setBusy(true);
    setError(null);
    const result = await apiClient.deleteImage(image.id);
    setBusy(false);
    if (result.error) setError(result.error);
    else onChanged?.();
  };

  const handleUseCandidate = async (candidate: ArtworkCandidate) => {
    setBusy(true);
    setError(null);
    const result = await apiClient.saveArtworkFromUrl({
      url: candidate.url,
      imageType: candidate.imageType,
      collectionId,
      mediaId,
      isPrimary: true,
    });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    await loadCandidates();
    onChanged?.();
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    // Uploaded artwork takes over as the poster; a backdrop or logo is added
    // as a candidate, since the type is inferred from what the file replaces.
    const result = await apiClient.uploadImage(file, {
      imageType: 'Poster',
      collectionId,
      mediaId,
      isPrimary: true,
    });
    setBusy(false);
    if (result.error) setError(result.error);
    else onChanged?.();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth aria-labelledby="images-dialog-title">
      <DialogTitle
        id="images-dialog-title"
        sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        {title || t('images.title', 'Images')}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {canUpload && (
            <>
              <Button
                size="small"
                startIcon={<Upload />}
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                {t('images.upload', 'Upload poster')}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  void handleUpload(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </>
          )}
          <IconButton onClick={onClose} size="small">
            <Close />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {images && images.length > 0 ? (
          <Grid container spacing={2}>
            {images.map((image: Image) => (
              <Grid size={{ xs: 6, sm: 4, md: 3 }} key={image.id}>
                <Card sx={image.isPrimary ? { outline: '2px solid', outlineColor: 'primary.main' } : undefined}>
                  <CardMedia
                    component="img"
                    image={apiClient.getImageUrl(image.id, 'w400')}
                    alt={image.imageType}
                    sx={{
                      aspectRatio: image.imageType === 'Poster' ? '2/3' : '16/9',
                      objectFit: 'cover',
                    }}
                  />
                  <CardContent sx={{ py: 1, textAlign: 'center' }}>
                    <Chip
                      label={image.imageType}
                      size="small"
                      color={image.isPrimary ? 'primary' : 'default'}
                      variant={image.isPrimary ? 'filled' : 'outlined'}
                    />
                    {(image.width || image.height || image.fileSize) && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        {image.width && image.height && `${image.width}×${image.height}`}
                        {image.width && image.height && image.fileSize && ' • '}
                        {image.fileSize && formatFileSize(image.fileSize)}
                      </Typography>
                    )}
                    {canEdit && (
                      <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.5, mt: 0.5 }}>
                        {!image.isPrimary && (
                          <Button
                            size="small"
                            startIcon={<Check />}
                            disabled={busy}
                            onClick={() => handleSetPrimary(image)}
                          >
                            {t('images.useThis', 'Use this')}
                          </Button>
                        )}
                        <IconButton
                          size="small"
                          aria-label={t('images.delete', 'Delete image')}
                          disabled={busy}
                          onClick={() => handleDelete(image)}
                        >
                          <Delete fontSize="small" />
                        </IconButton>
                      </Box>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        ) : (
          <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
            {t('images.noImages', 'No images available.')}
          </Typography>
        )}

        {canBrowseProvider && (candidates.length > 0 || candidatesError) && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t('images.fromProvider', 'More artwork from the provider')}
            </Typography>

            {candidatesError ? (
              <Typography variant="body2" color="text.secondary">
                {candidatesError}
              </Typography>
            ) : (
              <Grid container spacing={2}>
                {candidates.map((candidate) => (
                  <Grid size={{ xs: 6, sm: 4, md: 3 }} key={candidate.url}>
                    <Card sx={candidate.saved ? { opacity: 0.5 } : undefined}>
                      <CardMedia
                        component="img"
                        image={candidate.url}
                        alt={candidate.imageType}
                        sx={{
                          aspectRatio: candidate.imageType === 'Poster' ? '2/3' : '16/9',
                          objectFit: 'cover',
                        }}
                      />
                      <CardContent sx={{ py: 1, textAlign: 'center' }}>
                        <Chip label={candidate.imageType} size="small" variant="outlined" />
                        <Box sx={{ mt: 0.5 }}>
                          {candidate.saved ? (
                            <Typography variant="caption" color="text.secondary">
                              {t('images.alreadySaved', 'Already saved')}
                            </Typography>
                          ) : (
                            <Button
                              size="small"
                              startIcon={<Download />}
                              disabled={busy}
                              onClick={() => handleUseCandidate(candidate)}
                            >
                              {t('images.useThis', 'Use this')}
                            </Button>
                          )}
                        </Box>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            )}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
