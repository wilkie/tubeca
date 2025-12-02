import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import { apiClient } from '../api/client';

interface HeroSectionProps {
  backdropImageId?: string;
  children: ReactNode;
}

export function HeroSection({ backdropImageId, children }: HeroSectionProps) {
  return (
    <Box
      sx={{
        position: 'relative',
        mx: -3,
        mt: -4,
        mb: 3,
        minHeight: 'calc(100vh - 48px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Backdrop Image */}
      {backdropImageId ? (
        <Box
          component="img"
          src={apiClient.getImageUrl(backdropImageId)}
          alt=""
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            zIndex: 0,
          }}
        />
      ) : (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            bgcolor: 'grey.900',
            zIndex: 0,
          }}
        />
      )}

      {/* Gradient Overlay */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background:
            'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 50%, rgba(0,0,0,0.3) 100%)',
          zIndex: 1,
        }}
      />

      {children}
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
