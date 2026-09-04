import { readdirSync, readFileSync, statSync } from 'fs';
import * as path from 'path';
import en from '../locales/en.json';

/**
 * Every `t()` call in the source, checked against `en.json`.
 *
 * i18next falls back to the inline default when a key is missing, so a wrong
 * or absent key renders correctly in English and is invisible until someone
 * adds a second language. When this test was written, 98 of the 291 keys in
 * use were missing for exactly that reason.
 */
const SOURCE_ROOT = path.join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** `t(` but not `format(`, `at(` or `.t(`. */
const LITERAL_KEY = /(?<![A-Za-z0-9_$.])t\(\s*'([^']+)'/g;
/** A key built from a variable, e.g. t(`users.roles.${role}`); the prefix is checkable. */
const TEMPLATE_PREFIX = /(?<![A-Za-z0-9_$.])t\(\s*`([^`$]*)\$\{/g;

const files = sourceFiles(SOURCE_ROOT);

function collect(pattern: RegExp): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(pattern)) {
      if (!found.has(match[1])) found.set(match[1], path.relative(SOURCE_ROOT, file));
    }
  }
  return found;
}

const resolve = (key: string): unknown =>
  key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    en
  );

describe('translations', () => {
  it('reads the source it is checking', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has an English string for every key the code asks for', () => {
    const missing = [...collect(LITERAL_KEY)]
      .filter(([key]) => typeof resolve(key) !== 'string')
      .map(([key, file]) => `${key} (${file})`);

    expect(missing).toEqual([]);
  });

  it('has a group for every key the code builds from a variable', () => {
    const missing = [...collect(TEMPLATE_PREFIX)]
      .map(([prefix, file]) => [prefix.replace(/\.$/, ''), file] as const)
      .filter(([prefix]) => {
        const group = resolve(prefix);
        return !group || typeof group !== 'object' || Object.keys(group).length === 0;
      })
      .map(([prefix, file]) => `${prefix} (${file})`);

    expect(missing).toEqual([]);
  });

  it('spells a key the same way in the file as in the call', () => {
    // A key whose inline default disagrees with en.json means one of the two
    // was edited alone, and which one wins depends on whether the key exists.
    const withDefault = /(?<![A-Za-z0-9_$.])t\(\s*'([^']+)'\s*,\s*'((?:[^'\\]|\\.)*)'/g;
    const disagreements: string[] = [];
    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(withDefault)) {
        const translated = resolve(match[1]);
        const inline = match[2].replace(/\\'/g, "'");
        if (typeof translated === 'string' && translated !== inline) {
          disagreements.push(`${match[1]}: en.json ${JSON.stringify(translated)} vs default ${JSON.stringify(inline)}`);
        }
      }
    }

    expect(disagreements).toEqual([]);
  });
});
