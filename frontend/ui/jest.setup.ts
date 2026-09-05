import '@testing-library/jest-dom';

// Polyfill TextEncoder/TextDecoder for jsdom
// eslint-disable-next-line @typescript-eslint/no-require-imports
const util = require('util');
Object.assign(globalThis, {
  TextEncoder: util.TextEncoder,
  TextDecoder: util.TextDecoder,
});

// jsdom has no layout, so scrolling is not implemented and calling it prints
// an error. The router scrolls on navigation; make it a no-op instead.
Object.defineProperty(window, 'scrollTo', { value: () => {}, writable: true });

// jsdom has no layout engine and so no ResizeObserver; components that measure
// themselves only need it to exist.
Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  value: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});

// jsdom implements no matchMedia, so every `useMediaQuery` would answer "no"
// and a component's narrow-screen layout could never be tested. This answers
// min-width and max-width queries from `window.innerWidth`, which a test sets.
const mediaQueryListeners = new Set<(event: MediaQueryListEvent) => void>();
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => {
    const matches = () => {
      const min = /\(min-width:\s*([\d.]+)px\)/.exec(query);
      const max = /\(max-width:\s*([\d.]+)px\)/.exec(query);
      if (min && window.innerWidth < Number(min[1])) return false;
      if (max && window.innerWidth > Number(max[1])) return false;
      return Boolean(min || max);
    };
    return {
      get matches() {
        return matches();
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        mediaQueryListeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        mediaQueryListeners.delete(listener),
      addListener: (listener: (event: MediaQueryListEvent) => void) => mediaQueryListeners.add(listener),
      removeListener: (listener: (event: MediaQueryListEvent) => void) =>
        mediaQueryListeners.delete(listener),
      dispatchEvent: () => false,
    };
  },
});

/** Resize the window a test is rendering into, and tell whoever is listening. */
Object.defineProperty(globalThis, 'setViewportWidth', {
  writable: true,
  value: (width: number) => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
    for (const listener of mediaQueryListeners) listener({} as MediaQueryListEvent);
    window.dispatchEvent(new Event('resize'));
  },
});

// jsdom implements no pointer events, but the player handles mouse, touch and
// pen through them. A MouseEvent carrying pointerType is enough for tests.
if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  Object.defineProperty(globalThis, 'PointerEvent', { writable: true, value: PointerEventPolyfill });
  Object.defineProperty(window, 'PointerEvent', { writable: true, value: PointerEventPolyfill });
}

// Fail tests on console.error (catches React act() warnings, etc.)
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  originalConsoleError(...args);
  throw new Error(`console.error was called: ${args[0]}`);
};
