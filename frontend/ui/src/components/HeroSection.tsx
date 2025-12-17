import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { apiClient } from '../api/client';

interface HeroSectionProps {
  backdropImageId?: string;
  children: ReactNode;
}

export function HeroSection({ backdropImageId, children }: HeroSectionProps) {
  const theme = useTheme();

  return (
    <Box
      sx={{
        position: 'relative',
        mx: -3,
        mt: -4,
        mb: 0,
        minHeight: 'calc(100vh - 48px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Fixed Backdrop Image - stays in place as content scrolls */}
      {backdropImageId ? (
        <Box
          component="img"
          src={apiClient.getImageUrl(backdropImageId)}
          alt=""
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            objectFit: 'cover',
            zIndex: 0,
            pointerEvents: 'none',
          }}
        />
      ) : (
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            bgcolor: 'grey.900',
            zIndex: 0,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Fixed Gradient Overlay */}
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background:
            'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 50%, rgba(0,0,0,0.3) 100%)',
          zIndex: 1,
          pointerEvents: 'none',
        }}
      />

      {/* Content wrapper */}
      <Box sx={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', flexDirection: 'column' }}>
        {children}
      </Box>

      {/* Solid background that content below will scroll over the fixed backdrop */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 32,
          background: `linear-gradient(to bottom, transparent, ${theme.palette.background.default})`,
          zIndex: 2,
          pointerEvents: 'none',
        }}
      />
    </Box>
  );
}

interface HeroPosterProps {
  imageId: string;
  alt: string;
}

export function HeroPoster({ imageId, alt }: HeroPosterProps) {
  return (
    <Box
      component="img"
      src={apiClient.getImageUrl(imageId)}
      alt={alt}
      sx={{
        width: { xs: 120, sm: 150, md: 200 },
        aspectRatio: '2/3',
        objectFit: 'cover',
        borderRadius: 1,
        boxShadow: 6,
        flexShrink: 0,
      }}
    />
  );
}

interface HeroLogoProps {
  imageId: string;
  alt: string;
}

export function HeroLogo({ imageId, alt }: HeroLogoProps) {
  return (
    <Box
      component="img"
      src={apiClient.getImageUrl(imageId)}
      alt={alt}
      sx={{
        maxWidth: { xs: 200, sm: 300, md: 400 },
        maxHeight: { xs: 60, sm: 80, md: 100 },
        objectFit: 'contain',
        objectPosition: 'left',
        mb: 1,
      }}
    />
  );
}
