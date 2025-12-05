import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', 'data/'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,js}'],
    languageOptions: {
      parser: tsParser,
      globals: {
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
    },
    rules: {
      ...typescript.configs.recommended.rules,
      'semi': ['error', 'always'],
    },
  },
  {
    files: ['**/*.test.ts', '**/__tests__/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
];
