import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useApiQuery } from '../useApiQuery';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useApiQuery', () => {
  it('returns the payload the client resolved with', async () => {
    const { result } = renderHook(() => useApiQuery(['thing'], async () => ({ data: { name: 'Heat' } })), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toEqual({ name: 'Heat' }));
    expect(result.current.errorMessage).toBeNull();
  });

  it('turns the client error into a message the page can render', async () => {
    const { result } = renderHook(() => useApiQuery(['thing'], async () => ({ error: 'Library not found' })), {
      wrapper,
    });

    await waitFor(() => expect(result.current.errorMessage).toBe('Library not found'));
    expect(result.current.data).toBeUndefined();
  });

  it('treats an empty response as an error rather than as data', async () => {
    const { result } = renderHook(() => useApiQuery(['thing'], async () => ({})), { wrapper });

    await waitFor(() => expect(result.current.errorMessage).toBe('No data returned'));
  });

  it('does not call through while disabled', async () => {
    const call = jest.fn(async () => ({ data: 'x' }));
    const { result } = renderHook(() => useApiQuery(['thing'], call, { enabled: false }), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(call).not.toHaveBeenCalled();
  });

  it('shares one request between two callers asking for the same key', async () => {
    const call = jest.fn(async () => ({ data: 'shared' }));
    const sharedClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const sharedWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={sharedClient}>{children}</QueryClientProvider>
    );

    const first = renderHook(() => useApiQuery(['same'], call), { wrapper: sharedWrapper });
    const second = renderHook(() => useApiQuery(['same'], call), { wrapper: sharedWrapper });

    await waitFor(() => expect(first.result.current.data).toBe('shared'));
    await waitFor(() => expect(second.result.current.data).toBe('shared'));
    expect(call).toHaveBeenCalledTimes(1);
  });
});
