import { createTheme } from '@mui/material/styles';
import { FULL_BLEED_MARGIN, PAGE_GUTTER } from '../layout';

describe('page gutters', () => {
  it('cancels exactly, at every breakpoint', () => {
    expect(Object.keys(FULL_BLEED_MARGIN)).toEqual(Object.keys(PAGE_GUTTER));
    for (const [breakpoint, gutter] of Object.entries(PAGE_GUTTER)) {
      expect(FULL_BLEED_MARGIN[breakpoint as keyof typeof FULL_BLEED_MARGIN]).toBe(-gutter);
    }
  });

  it('matches what MUI Container actually pads by', () => {
    // The bug this guards against: a flat -3 against a 16px gutter on a phone,
    // which reached 8px past both edges and scrolled the page sideways.
    const theme = createTheme();
    expect(theme.spacing(PAGE_GUTTER.xs)).toBe('16px');
    expect(theme.spacing(PAGE_GUTTER.sm)).toBe('24px');
  });
});
