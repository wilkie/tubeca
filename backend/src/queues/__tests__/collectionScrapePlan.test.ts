import { planCollectionScrapeJobs, type CollectionScrapeJobData } from '../collectionScrapePlan';

function job(
  collectionId: string,
  collectionType: CollectionScrapeJobData['collectionType'],
  extra: Partial<CollectionScrapeJobData> = {}
): CollectionScrapeJobData {
  return { collectionId, collectionName: collectionId, collectionType, ...extra };
}

describe('planCollectionScrapeJobs', () => {
  it('leaves out a season whose show is in the same batch', () => {
    const planned = planCollectionScrapeJobs([
      job('show-1', 'Show'),
      job('season-1', 'Season', { parentShowId: 'show-1', seasonNumber: 1 }),
      job('season-2', 'Season', { parentShowId: 'show-1', seasonNumber: 2 }),
    ]);

    expect(planned.map((p) => p.data.collectionId)).toEqual(['show-1']);
  });

  it('queues a season whose show is not in the batch', () => {
    const planned = planCollectionScrapeJobs([
      job('season-9', 'Season', { parentShowId: 'show-elsewhere', seasonNumber: 9 }),
    ]);

    expect(planned.map((p) => p.data.collectionId)).toEqual(['season-9']);
  });

  it('asks every show to cascade to its seasons', () => {
    const planned = planCollectionScrapeJobs([job('show-1', 'Show')]);

    expect(planned[0].data.cascade).toBe('seasons');
  });

  it('keeps a deeper cascade the caller asked for', () => {
    const planned = planCollectionScrapeJobs([job('show-1', 'Show', { cascade: 'all' })]);

    expect(planned[0].data.cascade).toBe('all');
  });

  it('does not set a cascade on films', () => {
    const planned = planCollectionScrapeJobs([job('film-1', 'Film')]);

    expect(planned[0].data.cascade).toBeUndefined();
  });

  it('puts shows before the other collections', () => {
    const planned = planCollectionScrapeJobs([
      job('film-1', 'Film'),
      job('show-1', 'Show'),
      job('album-1', 'Album'),
    ]);

    expect(planned.map((p) => p.data.collectionId)).toEqual(['show-1', 'film-1', 'album-1']);
  });

  it('gives every job a distinct id and no delay', () => {
    const planned = planCollectionScrapeJobs([job('film-1', 'Film'), job('film-2', 'Film')], 1234);

    expect(planned.map((p) => p.opts.jobId)).toEqual([
      'collection-scrape-film-1-1234',
      'collection-scrape-film-2-1234',
    ]);
    expect(planned.every((p) => !('delay' in p.opts))).toBe(true);
  });
});
