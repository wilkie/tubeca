import {
  getShowNameFromCollectionPath,
  parseEpisodeFromFilename,
  parseSeasonFromFolderName,
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

describe('parseSeasonFromFolderName', () => {
  it('reads the number a season folder names', () => {
    expect(parseSeasonFromFolderName('Season 3')).toBe(3);
    expect(parseSeasonFromFolderName('season 03')).toBe(3);
    expect(parseSeasonFromFolderName('Season1')).toBe(1);
  });

  it('calls specials season zero, as every scraper numbers them', () => {
    expect(parseSeasonFromFolderName('Specials')).toBe(0);
    expect(parseSeasonFromFolderName('special')).toBe(0);
  });

  it('says nothing for a folder that is not a season', () => {
    expect(parseSeasonFromFolderName('Brooklyn Nine-Nine')).toBeUndefined();
    expect(parseSeasonFromFolderName('The Matrix (1999)')).toBeUndefined();
    expect(parseSeasonFromFolderName('Season 08 Extras')).toBeUndefined();
  });
});

describe('parsing an episode the folder has to help with', () => {
  it('reads a leading number as the episode, given the season', () => {
    // Two in five episodes in a real library are named this way.
    expect(parseEpisodeFromFilename('14 - Karen Peralta', { seasonHint: 3 })).toMatchObject({
      season: 3,
      episode: 14,
      episodeTitle: 'Karen Peralta',
    });
    expect(parseEpisodeFromFilename('01 - Pilot', { seasonHint: 1 })).toMatchObject({
      season: 1,
      episode: 1,
    });
    expect(parseEpisodeFromFilename('014', { seasonHint: 1 })).toMatchObject({
      season: 1,
      episode: 14,
    });
  });

  it('reads a spelled-out episode number', () => {
    expect(parseEpisodeFromFilename('Episode 3', { seasonHint: 1 })).toMatchObject({
      season: 1,
      episode: 3,
    });
    expect(parseEpisodeFromFilename('Ep 12 - The One', { seasonHint: 2 })).toMatchObject({
      season: 2,
      episode: 12,
    });
  });

  it('refuses to guess without a season', () => {
    // A leading number in a flat folder could be anything.
    expect(parseEpisodeFromFilename('14 - Karen Peralta')).toBeNull();
    expect(parseEpisodeFromFilename('Episode 3')).toBeNull();
  });

  it('does not mistake a title that merely starts with a number', () => {
    expect(parseEpisodeFromFilename('12 Angry Men', { seasonHint: 1 })).toBeNull();
    expect(parseEpisodeFromFilename('2012 - Something', { seasonHint: 1 })).toBeNull();
  });

  it('lets the filename overrule the folder when it names a season', () => {
    // A file that says s02e05 inside a "Season 1" folder means season 2.
    expect(parseEpisodeFromFilename('s02e05 - Title', { seasonHint: 1 })).toMatchObject({
      season: 2,
      episode: 5,
    });
  });
});

describe('episode numbers the old patterns missed', () => {
  it('reads a three-digit episode', () => {
    // Long-running shows number straight through; s01e118 parsed as nothing.
    expect(parseEpisodeFromFilename('s01e118')).toMatchObject({ season: 1, episode: 118 });
    expect(parseEpisodeFromFilename('s06e182')).toMatchObject({ season: 6, episode: 182 });
  });

  it('reads a season token with the episode after a separator', () => {
    expect(parseEpisodeFromFilename('Ace Attorney S2 - 22')).toMatchObject({
      season: 2,
      episode: 22,
    });
    expect(parseEpisodeFromFilename('[HorribleSubs] Ace Attorney S2 - 01 [1080p]')).toMatchObject({
      season: 2,
      episode: 1,
    });
  });

  it('still reads everything it read before', () => {
    expect(parseEpisodeFromFilename('s08e03 - Chaotic Collabs')).toMatchObject({ season: 8, episode: 3 });
    expect(parseEpisodeFromFilename('Show.Name.S01E05.720p')).toMatchObject({ season: 1, episode: 5 });
    expect(parseEpisodeFromFilename('1x01')).toMatchObject({ season: 1, episode: 1 });
    expect(parseEpisodeFromFilename('aaf-murdoch.mysteries.s05e11.720p.bluray.x264')).toMatchObject({
      season: 5,
      episode: 11,
    });
  });
});
