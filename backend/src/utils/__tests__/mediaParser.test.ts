import {
  getShowNameFromCollectionPath,
  parseEpisodeFromFilename,
  parseTitleAndYear,
} from '../mediaParser';

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

// Callers pass a base name with the extension already stripped
// (`importService.buildMediaHints`, `scrapeCascade.queueEpisodeScrapes`).
describe('parseEpisodeFromFilename', () => {
  it('reads S##E## and the show name in front of it', () => {
    expect(parseEpisodeFromFilename('Breaking Bad S01E03 - Cat in the Bag')).toEqual({
      showName: 'Breaking Bad',
      season: 1,
      episode: 3,
      episodeTitle: 'Cat in the Bag',
    });
  });

  it('reads a single-digit season and episode', () => {
    expect(parseEpisodeFromFilename('Show Name S1E3 Title')).toMatchObject({
      season: 1,
      episode: 3,
      episodeTitle: 'Title',
    });
  });

  it('reads the ##x## form', () => {
    expect(parseEpisodeFromFilename('Betty 1x02')).toMatchObject({
      showName: 'Betty',
      season: 1,
      episode: 2,
    });
  });

  it('reads a three-digit episode in the ##x## form', () => {
    expect(parseEpisodeFromFilename('Show 12x105 Title')).toMatchObject({
      season: 12,
      episode: 105,
    });
  });

  it('does not mind the case or the separators', () => {
    expect(parseEpisodeFromFilename('breaking.bad.s01e03')).toMatchObject({
      showName: 'breaking bad',
      season: 1,
      episode: 3,
    });
  });

  it('stops the episode title at the quality tags', () => {
    expect(parseEpisodeFromFilename('Show.Name.S01E01.Pilot.1080p.WEB')).toEqual({
      showName: 'Show Name',
      season: 1,
      episode: 1,
      episodeTitle: 'Pilot',
    });
  });

  it('leaves out a show name when the file starts with the episode', () => {
    expect(parseEpisodeFromFilename('S01E03')).toEqual({
      showName: undefined,
      season: 1,
      episode: 3,
      episodeTitle: undefined,
    });
  });

  it('leaves out an episode title when there is nothing after the number', () => {
    expect(parseEpisodeFromFilename('The Wire s02e11')).toEqual({
      showName: 'The Wire',
      season: 2,
      episode: 11,
      episodeTitle: undefined,
    });
  });

  it('says nothing about a film', () => {
    expect(parseEpisodeFromFilename('Random Movie 2019')).toBeNull();
  });

  it('is not fooled by a resolution that looks like an episode', () => {
    expect(parseEpisodeFromFilename('Some Movie 1080p')).toBeNull();
  });
});

describe('getShowNameFromCollectionPath', () => {
  it('takes the show above a season folder', () => {
    expect(getShowNameFromCollectionPath(['Breaking Bad', 'Season 1'])).toBe('Breaking Bad');
  });

  it('does not mind how the season folder is spelled', () => {
    expect(getShowNameFromCollectionPath(['Breaking Bad', 'season2'])).toBe('Breaking Bad');
  });

  it('takes the folder itself when it is not a season', () => {
    expect(getShowNameFromCollectionPath(['Shows', 'Breaking Bad', 'Specials'])).toBe('Specials');
  });

  it('has nothing to go on for a file at the library root', () => {
    expect(getShowNameFromCollectionPath([])).toBeUndefined();
  });

  it('settles for the season folder when there is nothing above it', () => {
    expect(getShowNameFromCollectionPath(['Season 1'])).toBe('Season 1');
  });
});
