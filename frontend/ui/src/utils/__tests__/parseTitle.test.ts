import { parseTitleAndYear } from '../parseTitle';

describe('parseTitleAndYear', () => {
  it('parses "Name (Year)"', () => {
    expect(parseTitleAndYear('Blade Runner (1982)')).toEqual({
      title: 'Blade Runner',
      year: 1982,
    });
  });

  it('ignores trailing tags after the year', () => {
    expect(parseTitleAndYear('The Batman (2022) [1080p]')).toEqual({
      title: 'The Batman',
      year: 2022,
    });
    expect(parseTitleAndYear('The Batman (2022) {imdb-tt1877830}')).toEqual({
      title: 'The Batman',
      year: 2022,
    });
  });

  it('prefers a parenthesised year over digits in the title', () => {
    expect(parseTitleAndYear('Blade Runner 2049 (2017)')).toEqual({
      title: 'Blade Runner 2049',
      year: 2017,
    });
  });

  it('falls back to a bare trailing year', () => {
    expect(parseTitleAndYear('Dune 2021')).toEqual({ title: 'Dune', year: 2021 });
  });

  it('normalises separators', () => {
    expect(parseTitleAndYear('Blade.Runner.(1982)')).toEqual({
      title: 'Blade Runner',
      year: 1982,
    });
  });

  it('returns just the title when there is no year', () => {
    expect(parseTitleAndYear('Only Murders in the Building')).toEqual({
      title: 'Only Murders in the Building',
    });
  });

  it('does not treat a leading number as a year', () => {
    expect(parseTitleAndYear('2001 A Space Odyssey')).toEqual({
      title: '2001 A Space Odyssey',
    });
  });
});
