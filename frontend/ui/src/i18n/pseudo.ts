/**
 * A pseudo-locale, generated from the English one.
 *
 * It exists to answer a question no test can: which strings on this page never
 * went through `t()` at all? Every translated string comes back accented and
 * padded, so anything still in plain English is hard-coded — and anything that
 * overflows its space here will overflow it in German too.
 *
 * It is generated rather than written, so it cannot drift from `en.json`, and
 * it is not a language: it is not offered in any picker, and is reached with
 * `?lng=en-XA` or by setting `i18nextLng` in localStorage.
 */
const ACCENTS: Record<string, string> = {
  a: 'á', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ǧ', h: 'ĥ', i: 'í', j: 'ĵ',
  k: 'ķ', l: 'ľ', m: 'ɱ', n: 'ñ', o: 'ó', p: 'þ', q: 'ǫ', r: 'ř', s: 'š', t: 'ŧ',
  u: 'ú', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Á', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ǧ', H: 'Ĥ', I: 'Í', J: 'Ĵ',
  K: 'Ķ', L: 'Ľ', M: 'Ṁ', N: 'Ñ', O: 'Ó', P: 'Þ', Q: 'Ǫ', R: 'Ř', S: 'Š', T: 'Ŧ',
  U: 'Ú', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
};

/** Interpolation and tags have to survive: `{{count}}` and `<0>` mean something. */
const PLACEHOLDER = /(\{\{[^}]*\}\}|<[^>]*>|\$t\([^)]*\))/g;

/** Roughly what a German translation costs over English. */
const PADDING = 0.3;

export function pseudoTranslate(text: string): string {
  const accented = text
    .split(PLACEHOLDER)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(/[a-z]/gi, (c) => ACCENTS[c] ?? c)
    )
    .join('');

  const visible = text.replace(PLACEHOLDER, '').length;
  const padding = '·'.repeat(Math.ceil(visible * PADDING));
  return padding ? `${accented}${padding}` : accented;
}

type Tree = { [key: string]: string | Tree };

/** The same tree, every leaf pseudo-translated. */
export function pseudoLocale(source: Tree): Tree {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key,
      typeof value === 'string' ? pseudoTranslate(value) : pseudoLocale(value),
    ])
  );
}
