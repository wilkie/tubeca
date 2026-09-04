import { act, renderHook } from '@testing-library/react';
import { useDebouncedValue } from '../useDebouncedValue';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('useDebouncedValue', () => {
  it('starts out at the value it was given', () => {
    const { result } = renderHook(() => useDebouncedValue('heat'));

    expect(result.current).toBe('heat');
  });

  it('waits out the delay before catching up', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'h' },
    });

    rerender({ value: 'he' });
    act(() => { jest.advanceTimersByTime(299); });
    expect(result.current).toBe('h');

    act(() => { jest.advanceTimersByTime(1); });
    expect(result.current).toBe('he');
  });

  it('only settles once typing stops', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'h' },
    });

    for (const value of ['he', 'hea', 'heat']) {
      rerender({ value });
      act(() => { jest.advanceTimersByTime(200); });
    }
    expect(result.current).toBe('h');

    act(() => { jest.advanceTimersByTime(300); });
    expect(result.current).toBe('heat');
  });

  it('honours a delay of its own', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 50), {
      initialProps: { value: 'a' },
    });

    rerender({ value: 'b' });
    act(() => { jest.advanceTimersByTime(50); });

    expect(result.current).toBe('b');
  });
});
