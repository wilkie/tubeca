import { act, renderHook } from '@testing-library/react';
import { useQuickSearch } from '../useQuickSearch';

function press(key: string, target: EventTarget = document.body, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(event); });
  return event;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('useQuickSearch', () => {
  it('builds a query out of what is typed', () => {
    const { result } = renderHook(() => useQuickSearch());

    press('h');
    press('e');
    press('a');
    press('t');

    expect(result.current.query).toBe('heat');
    expect(result.current.isActive).toBe(true);
  });

  it('swallows the keystrokes it uses', () => {
    renderHook(() => useQuickSearch());

    expect(press('h').defaultPrevented).toBe(true);
  });

  it('rubs out the last character on backspace', () => {
    const { result } = renderHook(() => useQuickSearch());

    press('h');
    press('i');
    press('Backspace');

    expect(result.current.query).toBe('h');
  });

  it('is unbothered by a backspace on an empty query', () => {
    const { result } = renderHook(() => useQuickSearch());

    press('Backspace');

    expect(result.current.query).toBe('');
    expect(result.current.isActive).toBe(false);
  });

  it('clears on escape', () => {
    const { result } = renderHook(() => useQuickSearch());

    press('h');
    press('Escape');

    expect(result.current.query).toBe('');
  });

  it('clears on request', () => {
    const { result } = renderHook(() => useQuickSearch());
    press('h');

    act(() => { result.current.clear(); });

    expect(result.current.query).toBe('');
  });

  it('ignores keys that are not printable', () => {
    const { result } = renderHook(() => useQuickSearch());

    press('h');
    press('ArrowDown');
    press('Enter');
    press('Shift');

    expect(result.current.query).toBe('h');
  });

  it('leaves shortcuts alone', () => {
    const { result } = renderHook(() => useQuickSearch());

    press('f', document.body, { ctrlKey: true });
    press('f', document.body, { metaKey: true });
    press('f', document.body, { altKey: true });

    expect(result.current.query).toBe('');
  });

  it('keeps out of the way of a text field', () => {
    const { result } = renderHook(() => useQuickSearch());
    const input = document.createElement('input');
    document.body.appendChild(input);

    press('h', input);

    expect(result.current.query).toBe('');
  });

  it('keeps out of the way of a dialog or a menu', () => {
    const { result } = renderHook(() => useQuickSearch());
    document.body.innerHTML = '<div role="dialog"><span id="in-dialog"></span></div><ul role="menu"><li id="in-menu"></li></ul>';

    press('h', document.getElementById('in-dialog')!);
    press('i', document.getElementById('in-menu')!);

    expect(result.current.query).toBe('');
  });

  it('listens for nothing while disabled', () => {
    const { result } = renderHook(() => useQuickSearch({ enabled: false }));

    press('h');

    expect(result.current.query).toBe('');
  });

  it('stops listening once unmounted', () => {
    const { result, unmount } = renderHook(() => useQuickSearch());
    press('h');

    unmount();
    press('i');

    expect(result.current.query).toBe('h');
  });
});
