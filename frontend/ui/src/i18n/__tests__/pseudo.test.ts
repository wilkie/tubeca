import en from '../locales/en.json';
import { pseudoLocale, pseudoTranslate } from '../pseudo';

describe('the pseudo-locale', () => {
  it('accents the letters, so a string that went through t() is obvious', () => {
    expect(pseudoTranslate('Play')).toMatch(/^Þľáý/);
  });

  it('pads the string, so a layout that only fits English shows it', () => {
    expect(pseudoTranslate('Play').length).toBeGreaterThan('Play'.length);
  });

  it('leaves interpolation alone', () => {
    expect(pseudoTranslate('{{count}} of {{total}}')).toContain('{{count}}');
    expect(pseudoTranslate('{{count}} of {{total}}')).toContain('{{total}}');
  });

  it('leaves tags and nested references alone', () => {
    expect(pseudoTranslate('Read <0>the docs</0>')).toContain('<0>');
    expect(pseudoTranslate('$t(common.play) now')).toContain('$t(common.play)');
  });

  it('leaves punctuation and digits as they are', () => {
    expect(pseudoTranslate('S1:E3')).toContain('1:');
    expect(pseudoTranslate('S1:E3')).toContain('3');
  });

  it('keeps the shape of the English tree, leaf for leaf', () => {
    const shape = (node: unknown): unknown =>
      typeof node === 'string'
        ? 'string'
        : Object.fromEntries(Object.entries(node as object).map(([k, v]) => [k, shape(v)]));

    expect(shape(pseudoLocale(en))).toEqual(shape(en));
  });

  it('translates every leaf, however deep', () => {
    const leaves = (node: unknown): string[] =>
      typeof node === 'string' ? [node] : Object.values(node as object).flatMap(leaves);

    expect(leaves(pseudoLocale(en)).every((leaf) => /[áéíóúñŧ·]/.test(leaf))).toBe(true);
  });
});
