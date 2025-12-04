import { FormControl, InputLabel, Select, MenuItem, IconButton, Stack } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import { ArrowUpward, ArrowDownward } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

export type SortDirection = 'asc' | 'desc';

export interface SortOption {
  value: string;
  label: string;
}

interface SortControlsProps {
  options: SortOption[];
  value: string;
  direction: SortDirection;
  onValueChange: (value: string) => void;
  onDirectionChange: (direction: SortDirection) => void;
}

export function SortControls({
  options,
  value,
  direction,
  onValueChange,
  onDirectionChange,
}: SortControlsProps) {
  const { t } = useTranslation();

  const handleValueChange = (event: SelectChangeEvent<string>) => {
    onValueChange(event.target.value);
  };

  const toggleDirection = () => {
    onDirectionChange(direction === 'asc' ? 'desc' : 'asc');
  };

  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      <FormControl size="small" sx={{ minWidth: 150 }}>
        <InputLabel id="sort-field-label">{t('library.sortBy')}</InputLabel>
        <Select
          labelId="sort-field-label"
          value={value}
          label={t('library.sortBy')}
          onChange={handleValueChange}
        >
          {options.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <IconButton
        onClick={toggleDirection}
        size="small"
        aria-label={direction === 'asc' ? t('library.sort.ascending') : t('library.sort.descending')}
        title={direction === 'asc' ? t('library.sort.ascending') : t('library.sort.descending')}
      >
        {direction === 'asc' ? <ArrowUpward /> : <ArrowDownward />}
      </IconButton>
    </Stack>
  );
}
