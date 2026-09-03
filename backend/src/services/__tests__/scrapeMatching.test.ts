import { normalizeTitle, titleSimilarity, scoreCandidate, pickBestMatch } from '../scrapeMatching';

describe('normalizeTitle', () => {
  it('lower-cases, strips punctuation and diacritics, drops a leading article', () => {
    expect(normalizeTitle('The Matrix')).toBe('matrix');
    expect(normalizeTitle('Amélie!')).toBe('amelie');
    expect(normalizeTitle('Fast & Furious 6')).toBe('fast and furious 6');
    expect(normalizeTitle('  Blade   Runner: 2049 ')).toBe('blade runner 2049');
  });
});

describe('titleSimilarity', () => {
  it('is 1 for equivalent titles and lower for partial overlap', () => {
    expect(titleSimilarity('The Matrix', 'Matrix')).toBe(1);
    expect(titleSimilarity('Blade Runner', 'Blade Runner 2049')).toBeGreaterThan(0.6);
    expect(titleSimilarity('Blade Runner', 'Blade Runner 2049')).toBeLessThan(1);
    expect(titleSimilarity('Alien', 'Predator')).toBe(0);
  });
});

describe('pickBestMatch', () => {
  const results = [
    { externalId: 'wrong', title: 'Blade Runner 2049', year: 2017, confidence: 0.9 },
    { externalId: 'right', title: 'Blade Runner', year: 1982, confidence: 0.8 },
  ];

  it('prefers the exact title with the matching year over a more popular first hit', () => {
    const best = pickBestMatch({ title: 'Blade Runner', year: 1982 }, results);
    expect(best?.result.externalId).toBe('right');
  });

  it('uses the year to disambiguate identical titles', () => {
    const remakes = [
      { externalId: 'old', title: 'Dune', year: 1984 },
      { externalId: 'new', title: 'Dune', year: 2021 },
    ];
    expect(pickBestMatch({ title: 'Dune', year: 2021 }, remakes)?.result.externalId).toBe('new');
    expect(pickBestMatch({ title: 'Dune', year: 1984 }, remakes)?.result.externalId).toBe('old');
  });

  it('falls back to scraper order when nothing else separates candidates', () => {
    const twins = [
      { externalId: 'first', title: 'Heat' },
      { externalId: 'second', title: 'Heat' },
    ];
    expect(pickBestMatch({ title: 'Heat' }, twins)?.result.externalId).toBe('first');
  });

  it('returns null when no candidate is close enough', () => {
    expect(pickBestMatch({ title: 'Only Murders in the Building' }, [{ externalId: 'x', title: 'Murder, She Wrote' }])).toBeNull();
    expect(pickBestMatch({ title: 'Anything' }, [])).toBeNull();
  });

  it('penalises a contradicting year', () => {
    const score = scoreCandidate({ title: 'Dune', year: 2021 }, { externalId: 'x', title: 'Dune', year: 1984 });
    expect(score).toBeLessThan(scoreCandidate({ title: 'Dune', year: 2021 }, { externalId: 'y', title: 'Dune' }));
  });
});
