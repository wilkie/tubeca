import { useTranslation } from 'react-i18next';
import { Alert, Button } from '@mui/material';
import type { ScrapeState } from '../api/client';

interface ScrapeStatusAlertProps extends ScrapeState {
  /** Show action buttons (editors and admins). */
  canEdit: boolean;
  /** Offered for NoMatch/Failed when the entity supports Identify. */
  onIdentify?: () => void;
  /** Re-queue a scrape. */
  onRetry?: () => void;
}

/**
 * Surfaces the outcome of the last metadata scrape. Renders nothing when the
 * item matched (the metadata itself is the confirmation) or was never scraped.
 */
export function ScrapeStatusAlert({
  scrapeStatus,
  scrapeMessage,
  canEdit,
  onIdentify,
  onRetry,
}: ScrapeStatusAlertProps) {
  const { t } = useTranslation();

  if (!scrapeStatus || scrapeStatus === 'Matched') return null;

  const severity = scrapeStatus === 'Pending' ? 'info' : scrapeStatus === 'NoMatch' ? 'warning' : 'error';
  const label =
    scrapeStatus === 'Pending'
      ? t('scrape.pending')
      : scrapeStatus === 'NoMatch'
        ? t('scrape.noMatch')
        : t('scrape.failed');

  const actions =
    canEdit && scrapeStatus !== 'Pending' ? (
      <>
        {onIdentify && (
          <Button color="inherit" size="small" onClick={onIdentify}>
            {t('scrape.identify')}
          </Button>
        )}
        {onRetry && (
          <Button color="inherit" size="small" onClick={onRetry}>
            {t('scrape.retry')}
          </Button>
        )}
      </>
    ) : undefined;

  return (
    <Alert severity={severity} action={actions} sx={{ mb: 2 }} data-testid="scrape-status">
      {label}
      {scrapeMessage ? ` — ${scrapeMessage}` : ''}
    </Alert>
  );
}
