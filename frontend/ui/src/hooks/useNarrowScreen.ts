import { useMediaQuery, useTheme } from '@mui/material';

/**
 * True on a phone-width viewport (below MUI's `sm`, 600px).
 *
 * `useMediaQuery` rather than an `sx` breakpoint object wherever the answer
 * changes *what renders* rather than only how it looks — a dialog going full
 * screen, a control disappearing. Emotion's rules are invisible to jsdom, so
 * only the hook form can be tested; `test-utils` exports `setViewportWidth` to
 * drive it.
 */
export function useNarrowScreen(): boolean {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down('sm'));
}
