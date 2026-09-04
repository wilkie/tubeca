import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { NavigationLoadingOverlay } from '../NavigationLoadingOverlay';

function Page({ name }: { name: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/second')}>
      {name}
    </button>
  );
}

function renderOverlay() {
  return render(
    <MemoryRouter initialEntries={['/first']}>
      <NavigationLoadingOverlay />
      <Routes>
        <Route path="/first" element={<Page name="First" />} />
        <Route path="/second" element={<Page name="Second" />} />
      </Routes>
    </MemoryRouter>
  );
}

const goBack = () =>
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

describe('NavigationLoadingOverlay', () => {
  it('shows nothing while nobody is navigating', () => {
    renderOverlay();

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('covers the page the moment the back button is pressed', () => {
    renderOverlay();

    goBack();

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('gets out of the way once the new page has rendered', async () => {
    renderOverlay();
    goBack();

    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  });

  it('stops listening once it is gone', () => {
    const { unmount } = renderOverlay();

    unmount();
    goBack();

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
