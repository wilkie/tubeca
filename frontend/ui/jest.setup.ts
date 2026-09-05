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
