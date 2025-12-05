import { useState, useEffect } from 'react';
import { Box } from '@mui/material';
import { CollectionBreadcrumbs, type BreadcrumbItem } from './CollectionBreadcrumbs';

interface StickyHeroBreadcrumbsProps {
  breadcrumbs: BreadcrumbItem[];
  currentName: string;
  onNavigate: (item: BreadcrumbItem) => void;
}

export function StickyHeroBreadcrumbs({
  breadcrumbs,
  currentName,
  onNavigate,
}: StickyHeroBreadcrumbsProps) {
  const [scrolled, setScrolled] = useState(false);

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
        mt: -4, // Align with HeroSection's negative margin
        mb: -6, // Overlap into HeroSection below
        px: 3, // Add padding back for content
        pt: 2,
        pb: 1.5,
        transition: 'background-color 0.2s ease-in-out, border-color 0.2s ease-in-out',
        bgcolor: scrolled ? 'background.paper' : 'transparent',
        borderBottom: 1,
        borderColor: scrolled ? 'divider' : 'transparent',
      }}
    >
      <CollectionBreadcrumbs
        breadcrumbs={breadcrumbs}
        currentName={currentName}
        onNavigate={onNavigate}
        variant={scrolled ? 'default' : 'hero'}
      />
    </Box>
  );
}
