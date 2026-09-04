import { act, render, screen } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { StickyHeroBreadcrumbs } from '../StickyHeroBreadcrumbs';

const onNavigate = jest.fn();

const breadcrumbs = [
  { id: 'lib-1', name: 'Television', type: 'library' as const },
  { id: 'show-1', name: 'Breaking Bad', type: 'collection' as const },
];

function scrollTo(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
});

function renderCrumbs(props: Partial<Parameters<typeof StickyHeroBreadcrumbs>[0]> = {}) {
  return render(
    <StickyHeroBreadcrumbs
      breadcrumbs={breadcrumbs}
      currentName="Season 1"
      onNavigate={onNavigate}
      {...props}
    />
  );
}

/** The bar itself, which is what carries the background. */
const bar = (container: HTMLElement) => container.firstElementChild as HTMLElement;

describe('StickyHeroBreadcrumbs', () => {
  it('shows the trail and where it ends', () => {
    renderCrumbs();

    expect(screen.getByRole('button', { name: 'Television' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Breaking Bad' })).toBeInTheDocument();
    expect(screen.getByText('Season 1')).toBeInTheDocument();
  });

  it('navigates to the crumb that was clicked', async () => {
    const user = userEvent.setup();
    renderCrumbs();

    await user.click(screen.getByRole('button', { name: 'Breaking Bad' }));

    expect(onNavigate).toHaveBeenCalledWith(breadcrumbs[1]);
  });

  it('starts transparent over a hero', () => {
    const { container } = renderCrumbs();

    expect(bar(container)).toHaveStyle('background-color: rgba(0, 0, 0, 0)');
  });

  it('takes on a background once the hero has scrolled away', () => {
    const { container } = renderCrumbs();

    scrollTo(120);

    expect(bar(container)).not.toHaveStyle('background-color: rgba(0, 0, 0, 0)');
  });

  it('stays transparent for a short scroll', () => {
    const { container } = renderCrumbs();

    scrollTo(40);

    expect(bar(container)).toHaveStyle('background-color: rgba(0, 0, 0, 0)');
  });

  it('goes transparent again on the way back up', () => {
    const { container } = renderCrumbs();
    scrollTo(200);

    scrollTo(0);

    expect(bar(container)).toHaveStyle('background-color: rgba(0, 0, 0, 0)');
  });

  it('notices a page that is already scrolled when it mounts', () => {
    Object.defineProperty(window, 'scrollY', { value: 500, configurable: true });

    const { container } = renderCrumbs();

    expect(bar(container)).not.toHaveStyle('background-color: rgba(0, 0, 0, 0)');
  });

  it('is never transparent away from a hero', () => {
    const { container } = renderCrumbs({ variant: 'standard' });

    expect(bar(container)).not.toHaveStyle('background-color: rgba(0, 0, 0, 0)');
  });

  it('stops listening once it is gone', () => {
    const remove = jest.spyOn(window, 'removeEventListener');

    renderCrumbs().unmount();

    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
    remove.mockRestore();
  });
});
