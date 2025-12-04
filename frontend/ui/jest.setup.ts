import '@testing-library/jest-dom';

// Polyfill TextEncoder/TextDecoder for jsdom
// eslint-disable-next-line @typescript-eslint/no-require-imports
const util = require('util');
Object.assign(globalThis, {
  TextEncoder: util.TextEncoder,
  TextDecoder: util.TextDecoder,
});

// Fail tests on console.error (catches React act() warnings, etc.)
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  originalConsoleError(...args);
  throw new Error(`console.error was called: ${args[0]}`);
};
