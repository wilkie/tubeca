import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';

/**
 * Shows a loading overlay when navigating via back/forward button.
 * The overlay appears immediately on popstate and disappears when the new route renders.
 */
export function NavigationLoadingOverlay() {
  const [isNavigating, setIsNavigating] = useState(false);
  const location = useLocation();

  // Show loading on popstate (back/forward button)
  useEffect(() => {
    const handlePopState = () => {
      setIsNavigating(true);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Hide loading when location changes (new page has rendered)
  // Use pathname + search as dependency for reliable change detection
  useEffect(() => {
    if (isNavigating) {
      // Small delay to ensure the new page has started rendering
      const timeout = setTimeout(() => setIsNavigating(false), 50);
      return () => clearTimeout(timeout);
    }
  }, [location.pathname, location.search, isNavigating]);

  if (!isNavigating) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        bgcolor: 'rgba(0, 0, 0, 0.7)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <CircularProgress size={48} />
    </Box>
  );
}
