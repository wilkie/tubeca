import { useState } from 'react';
import { Autocomplete, TextField, Chip, Box, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Keyword } from '../api/client';
import { FILTER_LABEL_WIDTH } from './FilterChips';

interface KeywordFilterProps {
  keywords: Keyword[];
  selectedKeywords: Keyword[];
  onSelectionChange: (keywords: Keyword[]) => void;
}

export function KeywordFilter({
  keywords,
  selectedKeywords,
  onSelectionChange,
}: KeywordFilterProps) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState('');

  if (keywords.length === 0) return null;

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{
          width: FILTER_LABEL_WIDTH,
          flexShrink: 0,
          pt: 0.75,
          // Allow wrapping for longer localized labels
          wordBreak: 'break-word',
        }}
      >
        {t('library.filter.tags', 'Tags')}:
      </Typography>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap sx={{ flex: 1 }}>
        <Autocomplete
          multiple
          size="small"
          options={keywords}
          getOptionLabel={(option) => option.name}
          value={selectedKeywords}
          onChange={(_event, newValue) => onSelectionChange(newValue)}
          inputValue={inputValue}
          onInputChange={(_event, newInputValue) => setInputValue(newInputValue)}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => {
              const { key, ...tagProps } = getTagProps({ index });
              return (
                <Chip
                  key={key}
                  label={option.name}
                  size="small"
                  color="primary"
                  {...tagProps}
                />
              );
            })
          }
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder={selectedKeywords.length === 0 ? t('library.filter.searchTags', 'Search tags...') : ''}
              sx={{ minWidth: 200 }}
            />
          )}
          sx={{ flexGrow: 1, maxWidth: 400 }}
          filterOptions={(options, { inputValue }) => {
            const filterValue = inputValue.toLowerCase();
            return options.filter((option) =>
              option.name.toLowerCase().includes(filterValue)
            );
          }}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          noOptionsText={t('library.filter.noTags', 'No tags found')}
        />
        {selectedKeywords.length > 0 && (
          <Chip
            label={t('library.filter.clearAll', 'Clear')}
            size="small"
            variant="outlined"
            onClick={() => onSelectionChange([])}
          />
        )}
      </Stack>
    </Box>
  );
}
