import { Box, Typography, Fade } from '@mui/material';
import { Search } from '@mui/icons-material';

interface QuickSearchOverlayProps {
  /** The current search query */
  query: string;
  /** Number of items matching the filter */
  matchCount?: number;
  /** Total number of items */
  totalCount?: number;
}

/**
 * Floating overlay that shows the current quick search query.
 * Appears when user starts typing to filter items.
 */
export function QuickSearchOverlay({ query, matchCount, totalCount }: QuickSearchOverlayProps) {
  const isActive = query.length > 0;

  return (
    <Fade in={isActive}>
      <Box
        sx={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1300,
          bgcolor: 'background.paper',
          borderRadius: 2,
          boxShadow: 6,
          px: 3,
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          minWidth: 200,
          border: 1,
          borderColor: 'divider',
        }}
      >
        <Search color="action" />
        <Box sx={{ flex: 1 }}>
          <Typography
            variant="body1"
            sx={{
              fontWeight: 500,
              fontFamily: 'monospace',
              letterSpacing: 0.5,
            }}
          >
            {query}
            <Box
              component="span"
              sx={{
                display: 'inline-block',
                width: 2,
                height: '1em',
                bgcolor: 'primary.main',
                ml: 0.25,
                animation: 'blink 1s step-end infinite',
                '@keyframes blink': {
                  '50%': { opacity: 0 },
                },
              }}
            />
          </Typography>
          {matchCount !== undefined && totalCount !== undefined && (
            <Typography variant="caption" color="text.secondary">
              {matchCount} of {totalCount}
            </Typography>
          )}
        </Box>
      </Box>
    </Fade>
  );
}
