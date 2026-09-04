import { render, screen } from '../../test-utils';
import { QuickSearchOverlay } from '../QuickSearchOverlay';

describe('QuickSearchOverlay', () => {
  it('shows what has been typed', () => {
    render(<QuickSearchOverlay query="brea" />);

    expect(screen.getByText('brea')).toBeVisible();
  });

  it('stays out of sight until something is typed', () => {
    render(<QuickSearchOverlay query="" />);

    expect(screen.getByText('', { selector: '.MuiTypography-body1' })).not.toBeVisible();
  });

  it('counts the matches when it is told them', () => {
    render(<QuickSearchOverlay query="brea" matchCount={2} totalCount={40} />);

    expect(screen.getByText('2 of 40')).toBeInTheDocument();
  });

  it('counts nothing when only one half is known', () => {
    render(<QuickSearchOverlay query="brea" matchCount={2} />);

    expect(screen.queryByText(/of/)).not.toBeInTheDocument();
  });

  it('is honest about a search that matches nothing', () => {
    render(<QuickSearchOverlay query="zzz" matchCount={0} totalCount={40} />);

    expect(screen.getByText('0 of 40')).toBeInTheDocument();
  });
});
