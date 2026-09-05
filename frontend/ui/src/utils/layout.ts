/**
 * Page gutters.
 *
 * MUI's `Container` pads its contents by 16px below `sm` and 24px above it
 * (`@mui/system/Container/createContainer.js`). A full-bleed section inside a
 * page — a hero, a sticky breadcrumb bar — cancels that padding with a negative
 * margin, and the two have to agree at every breakpoint. They did not: four
 * places used a flat `-3`, so on a phone the section reached 8px past both
 * edges of the container and gave the page a horizontal scroll.
 *
 * Both values live here so they cannot drift apart again.
 */
export const PAGE_GUTTER = { xs: 2, sm: 3 } as const;

/** The negative margin that cancels {@link PAGE_GUTTER}. */
export const FULL_BLEED_MARGIN = { xs: -2, sm: -3 } as const;
