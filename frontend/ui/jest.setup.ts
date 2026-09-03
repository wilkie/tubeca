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

// Fail tests on console.error (catches React act() warnings, etc.)
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  originalConsoleError(...args);
  throw new Error(`console.error was called: ${args[0]}`);
};
