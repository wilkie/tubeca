import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemAvatar,
  ListItemText,
  Avatar,
  CircularProgress,
  Alert,
  InputAdornment,
  IconButton,
} from '@mui/material';
import { Search, Movie, Tv } from '@mui/icons-material';
import { apiClient } from '../api/client';

interface SearchResult {
  externalId: string;
  scraperId: string;
  title: string;
  year?: number;
  posterUrl?: string;
  overview?: string;
}

interface IdentifyDialogProps {
  open: boolean;
  onClose: () => void;
  collectionId: string;
  collectionName: string;
  collectionType: 'Show' | 'Film';
  year?: number;
  onIdentified: () => void;
}

// Inner component that holds state - gets remounted when dialog opens via key prop
function IdentifyDialogContent({
  collectionId,
  collectionName,
  collectionType,
  year,
  onIdentified,
  onClose,
}: {
  collectionId: string;
  collectionName: string;
  collectionType: 'Show' | 'Film';
  year?: number;
  onIdentified: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(collectionName);
  const [yearFilter, setYearFilter] = useState(year?.toString() || '');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setSearching(true);
    setError(null);
    setHasSearched(true);

    const yearNum = yearFilter ? parseInt(yearFilter, 10) : undefined;
    const result = await apiClient.searchForIdentification(query.trim(), collectionType, yearNum);

    setSearching(false);

    if (result.error) {
      setError(result.error);
      setResults([]);
    } else if (result.data) {
      setResults(result.data.results);
    }
  };

  const handleSelect = async (result: SearchResult) => {
    setIdentifying(true);
    setError(null);

    const response = await apiClient.identifyCollection(
      collectionId,
      result.externalId,
      result.scraperId
    );

    setIdentifying(false);

    if (response.error) {
      setError(response.error);
    } else {
      onIdentified();
      onClose();
    }
  };

  const handleClose = () => {
    if (!identifying) {
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !searching) {
      handleSearch();
    }
  };

  const typeLabel = collectionType === 'Show'
    ? t('collection.identifyTypeShow', 'show')
    : t('collection.identifyTypeFilm', 'film');

  return (
    <>
      <DialogTitle>
        {t('collection.identifyTitle', 'Identify {{type}}', { type: typeLabel })}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('collection.identifyDescription', 'Search for the correct {{type}} to match this item', { type: typeLabel })}
        </Typography>

        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <TextField
            fullWidth
            size="small"
            label={t('collection.searchPlaceholder', 'Search by title...')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={searching || identifying}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={handleSearch}
                    disabled={searching || identifying || !query.trim()}
                    edge="end"
                    size="small"
                  >
                    {searching ? <CircularProgress size={20} /> : <Search />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          <TextField
            size="small"
            label={t('collection.yearPlaceholder', 'Year')}
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value.replace(/\D/g, '').slice(0, 4))}
            onKeyDown={handleKeyDown}
            disabled={searching || identifying}
            sx={{ width: 100 }}
          />
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {identifying && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} sx={{ mr: 2 }} />
            <Typography>{t('collection.identifying', 'Identifying...')}</Typography>
          </Box>
        )}

        {!identifying && hasSearched && results.length === 0 && !searching && !error && (
          <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
            {t('collection.noResults', 'No results found')}
          </Typography>
        )}

        {!identifying && results.length > 0 && (
          <List sx={{ maxHeight: 400, overflow: 'auto' }}>
            {results.map((result) => (
              <ListItem key={`${result.scraperId}-${result.externalId}`} disablePadding>
                <ListItemButton onClick={() => handleSelect(result)} disabled={identifying}>
                  <ListItemAvatar>
                    {result.posterUrl ? (
                      <Avatar
                        variant="rounded"
                        src={result.posterUrl}
                        sx={{ width: 48, height: 72 }}
                      />
                    ) : (
                      <Avatar variant="rounded" sx={{ width: 48, height: 72, bgcolor: 'action.selected' }}>
                        {collectionType === 'Show' ? <Tv /> : <Movie />}
                      </Avatar>
                    )}
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body1" component="span">
                          {result.title}
                        </Typography>
                        {result.year && (
                          <Typography variant="body2" color="text.secondary" component="span">
                            ({result.year})
                          </Typography>
                        )}
                      </Box>
                    }
                    secondary={
                      result.overview ? (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                          }}
                        >
                          {result.overview}
                        </Typography>
                      ) : null
                    }
                    sx={{ ml: 1 }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={identifying}>
          {t('common.cancel', 'Cancel')}
        </Button>
      </DialogActions>
    </>
  );
}

// Wrapper component that manages the Dialog open state
// Uses key prop to force remount of content when dialog opens
export function IdentifyDialog({
  open,
  onClose,
  collectionId,
  collectionName,
  collectionType,
  year,
  onIdentified,
}: IdentifyDialogProps) {
  // Key changes when dialog opens to reset content state
  const [contentKey, setContentKey] = useState(0);

  const handleClose = () => {
    onClose();
    // Increment key so next open gets fresh state
    setContentKey((k) => k + 1);
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      {open && (
        <IdentifyDialogContent
          key={contentKey}
          collectionId={collectionId}
          collectionName={collectionName}
          collectionType={collectionType}
          year={year}
          onIdentified={onIdentified}
          onClose={handleClose}
        />
      )}
    </Dialog>
  );
}
