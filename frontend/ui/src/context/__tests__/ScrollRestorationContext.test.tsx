import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ScrollRestorationProvider, useScrollRestoration } from '../ScrollRestorationContext';

let navigationType: 'PUSH' | 'POP' | 'REPLACE' = 'PUSH';
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigationType: () => navigationType,
}));

const scrollTo = jest.fn();

/** jsdom has no layout: give the page a height and a scroll offset to remember. */
function pageOf(height: number, scrolledTo = 0) {
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    value: height,
    configurable: true,
  });
  Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: scrolledTo, configurable: true });
}

beforeEach(() => {
  navigationType = 'PUSH';
  scrollTo.mockClear();
  Object.defineProperty(window, 'scrollTo', { value: scrollTo, writable: true });
  pageOf(3000);
});

function Page({ cacheKey = 'library-1' }: { cacheKey?: string }) {
  useScrollRestoration(cacheKey);
  return (
    <div>
      {/* jsdom refuses to navigate, so the click is stopped after the listener sees it. */}
      <a href="/collections/1" onClick={(e) => e.preventDefault()}>
        A link
      </a>
      <button type="button">A button</button>
      <span>Just text</span>
    </div>
  );
}

function renderPage(props: { cacheKey?: string } = {}) {
  return render(
    <MemoryRouter>
      <ScrollRestorationProvider>
        <Page {...props} />
      </ScrollRestorationProvider>
    </MemoryRouter>
  );
}

describe('useScrollRestoration', () => {
  it('insists on its provider', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => renderHook(() => useScrollRestoration('key'))).toThrow(
      /within a ScrollRestorationProvider/
    );

    consoleError.mockRestore();
  });

  it('puts the page back where it was on a back navigation', async () => {
    const user = userEvent.setup();
    pageOf(3000, 900);
    const first = renderPage({ cacheKey: 'library-restore' });
    await user.click(screen.getByRole('button', { name: 'A button' }));
    first.unmount();

    navigationType = 'POP';
    renderPage({ cacheKey: 'library-restore' });

    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 900));
  });

  it('leaves a fresh navigation at the top', async () => {
    const user = userEvent.setup();
    pageOf(3000, 900);
    const first = renderPage({ cacheKey: 'library-fresh' });
    await user.click(screen.getByRole('button', { name: 'A button' }));
    first.unmount();

    navigationType = 'PUSH';
    renderPage({ cacheKey: 'library-fresh' });

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('remembers each page separately', async () => {
    const user = userEvent.setup();
    pageOf(3000, 450);
    const first = renderPage({ cacheKey: 'library-a' });
    await user.click(screen.getByRole('button', { name: 'A button' }));
    first.unmount();

    navigationType = 'POP';
    renderPage({ cacheKey: 'library-b' });

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('never scrolls past the bottom of a page that came back shorter', async () => {
    const user = userEvent.setup();
    pageOf(5000, 3000);
    const first = renderPage({ cacheKey: 'library-shrunk' });
    await user.click(screen.getByRole('button', { name: 'A button' }));
    first.unmount();

    navigationType = 'POP';
    pageOf(1500, 0);
    renderPage({ cacheKey: 'library-shrunk' });

    await waitFor(() => expect(scrollTo).toHaveBeenCalled());
    expect(scrollTo).toHaveBeenCalledWith(0, 1500 - 768);
  });

  it('saves when a link is clicked', async () => {
    const user = userEvent.setup();
    pageOf(3000, 300);
    const first = renderPage({ cacheKey: 'library-link' });

    await user.click(screen.getByRole('link', { name: 'A link' }));
    first.unmount();

    navigationType = 'POP';
    renderPage({ cacheKey: 'library-link' });
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 300));
  });

  it('saves nothing when a click lands on nothing clickable', async () => {
    const user = userEvent.setup();
    pageOf(3000, 300);
    const first = renderPage({ cacheKey: 'library-text' });

    await user.click(screen.getByText('Just text'));
    first.unmount();

    navigationType = 'POP';
    renderPage({ cacheKey: 'library-text' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('hands back a save it can call itself', async () => {
    pageOf(3000, 640);
    const { result, unmount } = renderHook(() => useScrollRestoration('library-manual'), {
      wrapper: ({ children }) => (
        <MemoryRouter>
          <ScrollRestorationProvider>{children}</ScrollRestorationProvider>
        </MemoryRouter>
      ),
    });

    act(() => result.current.saveState());
    unmount();

    navigationType = 'POP';
    renderPage({ cacheKey: 'library-manual' });
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 640));
  });
});
