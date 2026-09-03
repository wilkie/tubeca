import { render, screen } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { ScrapeStatusAlert } from '../ScrapeStatusAlert';

describe('ScrapeStatusAlert', () => {
  it('renders nothing for matched or unscraped items', () => {
    const { container } = render(<ScrapeStatusAlert scrapeStatus="Matched" canEdit />);
    expect(container).toBeEmptyDOMElement();
    const { container: none } = render(<ScrapeStatusAlert scrapeStatus={null} canEdit />);
    expect(none).toBeEmptyDOMElement();
  });

  it('shows a warning with the message and actions for editors on no match', async () => {
    const user = userEvent.setup();
    const onIdentify = jest.fn();
    const onRetry = jest.fn();
    render(
      <ScrapeStatusAlert
        scrapeStatus="NoMatch"
        scrapeMessage='No confident match for "Heat (1995)"'
        canEdit
        onIdentify={onIdentify}
        onRetry={onRetry}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/No confident match for "Heat \(1995\)"/);
    await user.click(screen.getByRole('button', { name: /identify/i }));
    expect(onIdentify).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('hides actions from viewers and while pending', () => {
    render(<ScrapeStatusAlert scrapeStatus="Failed" scrapeMessage="fetch failed" canEdit={false} onRetry={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/fetch failed/);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    render(<ScrapeStatusAlert scrapeStatus="Pending" canEdit onRetry={() => {}} />);
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
