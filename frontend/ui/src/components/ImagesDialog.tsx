import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Grid,
  Card,
  CardMedia,
  CardContent,
  Chip,
  Typography,
  IconButton,
} from '@mui/material';
import { Close } from '@mui/icons-material';
import { apiClient, type Image } from '../api/client';

interface ImagesDialogProps {
  open: boolean;
  onClose: () => void;
  images: Image[];
  title?: string;
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

export function ImagesDialog({ open, onClose, images, title }: ImagesDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      aria-labelledby="images-dialog-title"
    >
      <DialogTitle
        id="images-dialog-title"
        sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        {title || t('images.title', 'Images')}
        <IconButton onClick={onClose} size="small">
          <Close />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {images && images.length > 0 ? (
          <Grid container spacing={2}>
            {images.map((image: Image) => (
              <Grid size={{ xs: 6, sm: 4, md: 3 }} key={image.id}>
                <Card>
                  <CardMedia
                    component="img"
                    image={apiClient.getImageUrl(image.id)}
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
      </DialogContent>
    </Dialog>
  );
}
