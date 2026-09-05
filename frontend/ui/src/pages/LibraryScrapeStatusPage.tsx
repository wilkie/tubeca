import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Container,
  Link,
  Pagination,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { apiClient } from '../api/client';
import type { ScrapeCounts, ScrapeOverviewStatus, UnmatchedItem } from '../api/client';
import { queryKeys, useApiQuery } from '../hooks/useApiQuery';

const PAGE_SIZE = 50;

/** The statuses a viewer can do something about, in the order they are offered. */
const ACTIONABLE: ScrapeOverviewStatus[] = ['NoMatch', 'Failed', 'Pending', 'Unscraped'];

const STATUS_COLOUR: Record<ScrapeOverviewStatus, 'default' | 'info' | 'warning' | 'error' | 'success'> = {
  Matched: 'success',
  NoMatch: 'warning',
  Failed: 'error',
  Pending: 'info',
  Unscraped: 'default',
};

/**
 * What a library's metadata looks like as a whole, and a list of what did not
 * land.
 *
 * Per-item scrape status has been on the collection and media pages since
 * 2026-09-03, which answers the question one item at a time. On a library of
 * thirty thousand files that is not an answer: nobody opens thirty thousand
 * pages to find the eleven that failed.
 */
export function LibraryScrapeStatusPage() {
  const { libraryId } = useParams<{ libraryId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('sm'));

  const [selected, setSelected] = useState<ScrapeOverviewStatus[]>([]);
  const [page, setPage] = useState(1);

  const library = useApiQuery(queryKeys.library(libraryId!), () => apiClient.getLibrary(libraryId!), {
    enabled: Boolean(libraryId),
  });
  const overview = useApiQuery(
    queryKeys.libraryScrapeStatus(libraryId!),
    () => apiClient.getLibraryScrapeStatus(libraryId!),
    { enabled: Boolean(libraryId) }
  );

  const statuses = selected.length > 0 ? selected : undefined;
  const skip = (page - 1) * PAGE_SIZE;
  const unmatched = useApiQuery(
    queryKeys.libraryUnmatched(libraryId!, { statuses, skip }),
    () => apiClient.getLibraryUnmatched(libraryId!, { statuses, skip, take: PAGE_SIZE }),
    { enabled: Boolean(libraryId) }
  );

  /** Collections and media added together: a viewer cares about items, not tables. */
  const totals = useMemo((): ScrapeCounts | null => {
    if (!overview.data) return null;
    const { collections, media } = overview.data;
    return {
      Matched: collections.Matched + media.Matched,
      NoMatch: collections.NoMatch + media.NoMatch,
      Failed: collections.Failed + media.Failed,
      Pending: collections.Pending + media.Pending,
      Unscraped: collections.Unscraped + media.Unscraped,
    };
  }, [overview.data]);

  const toggle = (status: ScrapeOverviewStatus) => {
    setPage(1);
    setSelected((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  };

  const openItem = (item: UnmatchedItem) => {
    navigate(item.kind === 'collection' ? `/collection/${item.id}` : `/media/${item.id}`);
  };

  if (library.errorMessage) {
    return (
      <Container maxWidth={false} sx={{ py: 4 }}>
        <Alert severity="error">{library.errorMessage}</Alert>
      </Container>
    );
  }

  const items = unmatched.data?.items ?? [];
  const total = unmatched.data?.total ?? 0;

  return (
    <Container maxWidth={false} sx={{ py: 4 }}>
      <Typography variant="h5" gutterBottom>
        {t('scrapeStatus.title', 'Metadata status')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {library.data?.library?.name ?? ''}
      </Typography>

      {overview.isPending ? (
        <CircularProgress size={24} />
      ) : totals ? (
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 3 }}>
          <Chip
            label={t('scrapeStatus.matched', '{{count}} matched', { count: totals.Matched })}
            color="success"
            variant="outlined"
          />
          {ACTIONABLE.map((status) => (
            <Chip
              key={status}
              label={t(`scrapeStatus.count.${status}`, { count: totals[status] })}
              color={STATUS_COLOUR[status]}
              variant={selected.includes(status) ? 'filled' : 'outlined'}
              onClick={() => toggle(status)}
              disabled={totals[status] === 0 && !selected.includes(status)}
            />
          ))}
        </Stack>
      ) : null}

      {unmatched.errorMessage && <Alert severity="error">{unmatched.errorMessage}</Alert>}

      {!unmatched.isPending && items.length === 0 && !unmatched.errorMessage && (
        <Alert severity="success">
          {t('scrapeStatus.allMatched', 'Everything in this library has its metadata.')}
        </Alert>
      )}

      {items.length > 0 && (
        <>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('scrapeStatus.item', 'Item')}</TableCell>
                  {!narrow && <TableCell>{t('scrapeStatus.type', 'Type')}</TableCell>}
                  <TableCell>{t('scrapeStatus.statusColumn', 'Status')}</TableCell>
                  {!narrow && <TableCell>{t('scrapeStatus.reason', 'Reason')}</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={`${item.kind}-${item.id}`} hover>
                    <TableCell>
                      <Link
                        component="button"
                        underline="hover"
                        onClick={() => openItem(item)}
                        sx={{ textAlign: 'left' }}
                      >
                        {item.name}
                      </Link>
                      {item.parentName && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {item.parentName}
                        </Typography>
                      )}
                      {/* The narrow layout drops the reason column; keep the
                          reason itself, which is the point of the row. */}
                      {narrow && item.message && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {item.message}
                        </Typography>
                      )}
                    </TableCell>
                    {!narrow && <TableCell>{item.type}</TableCell>}
                    <TableCell>
                      <Chip
                        size="small"
                        label={t(`scrapeStatus.status.${item.status}`, item.status)}
                        color={STATUS_COLOUR[item.status]}
                        variant="outlined"
                      />
                    </TableCell>
                    {!narrow && (
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {item.message ?? ''}
                        </Typography>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {total > PAGE_SIZE && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              <Pagination
                count={Math.ceil(total / PAGE_SIZE)}
                page={page}
                onChange={(_event, value) => setPage(value)}
                siblingCount={narrow ? 0 : 1}
              />
            </Box>
          )}
        </>
      )}
    </Container>
  );
}
