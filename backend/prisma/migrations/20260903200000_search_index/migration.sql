-- Full-text index over the things a person actually searches for: the title,
-- alternative titles, the description, the keywords and the cast.
--
-- It is a plain FTS5 table rather than an external-content one because the
-- text is gathered from half a dozen tables (Collection, ShowDetails,
-- FilmDetails, Keyword, ShowCredit/FilmCredit/Credit, Person) and is written
-- by the scan and scrape workers, not by triggers.
--
-- The UNINDEXED columns carry what a query needs to filter on without a join:
-- which library a row belongs to, and its content rating.
CREATE VIRTUAL TABLE search_index USING fts5(
  entityId UNINDEXED,
  entityType UNINDEXED,
  libraryId UNINDEXED,
  contentRating UNINDEXED,
  name,
  altNames,
  description,
  keywords,
  people,
  tokenize = 'unicode61 remove_diacritics 2'
);
