import { useState, useEffect } from 'react';
import { Box } from '@mui/material';
import { CollectionBreadcrumbs, type BreadcrumbItem } from './CollectionBreadcrumbs';

interface StickyHeroBreadcrumbsProps {
  breadcrumbs: BreadcrumbItem[];
  currentName: string;
  onNavigate: (item: BreadcrumbItem) => void;
  /** 'hero' for use over hero backdrops, 'standard' for regular pages */
  variant?: 'hero' | 'standard';
}

export function StickyHeroBreadcrumbs({
  breadcrumbs,
  currentName,
  onNavigate,
  variant = 'hero',
}: StickyHeroBreadcrumbsProps) {
  const [scrolled, setScrolled] = useState(false);
  const isHero = variant === 'hero';

  useEffect(() => {
    const handleScroll = () => {
      // Transition to solid background after 80px of scroll
      setScrolled(window.scrollY > 80);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Check initial scroll position

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <Box
      sx={{
        position: 'sticky',
        top: 48, // Header height
        zIndex: 10,
        mx: -3, // Extend to full width (counteract container padding)
        // Hero variant has negative margins to overlap with backdrop
        mt: isHero ? '-38px' : '-32px',
        mb: isHero ? -6 : 2,
        px: 3, // Add padding back for content
        pt: 2,
        pb: 1.5,
        transition: 'background-color 0.2s ease-in-out, border-color 0.2s ease-in-out',
        // Hero variant starts transparent, standard always has background
        bgcolor: isHero ? (scrolled ? 'background.paper' : 'transparent') : 'background.paper',
        borderBottom: 1,
        borderColor: isHero ? (scrolled ? 'divider' : 'transparent') : 'divider',
      }}
    >
      <CollectionBreadcrumbs
        breadcrumbs={breadcrumbs}
        currentName={currentName}
        onNavigate={onNavigate}
        // Hero variant uses white text until scrolled
        variant={isHero && !scrolled ? 'hero' : 'default'}
      />
    </Box>
  );
}
