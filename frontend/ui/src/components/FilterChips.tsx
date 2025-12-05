import { Box, Stack, Typography, Chip } from '@mui/material';
import { useTranslation } from 'react-i18next';

// Shared label width for consistent filter alignment
// Using a fixed width ensures alignment even with varying label text lengths
export const FILTER_LABEL_WIDTH = 60;

interface FilterChipsProps {
  label: string;
  options: string[];
  excluded: Set<string>;
  onToggle: (value: string) => void;
  onClear: () => void;
  onSelectOnly?: (value: string) => void;
}

export function FilterChips({
  label,
  options,
  excluded,
  onToggle,
  onClear,
  onSelectOnly,
}: FilterChipsProps) {
  const { t } = useTranslation();

  if (options.length === 0) return null;

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{
          width: FILTER_LABEL_WIDTH,
          flexShrink: 0,
          pt: 0.5,
          // Allow wrapping for longer localized labels
          wordBreak: 'break-word',
        }}
      >
        {label}:
      </Typography>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap sx={{ flex: 1 }}>
        {options.map((option) => (
          <Chip
            key={option}
            label={option}
            size="small"
            variant={excluded.has(option) ? 'outlined' : 'filled'}
            color={excluded.has(option) ? 'default' : 'primary'}
            onClick={() => onToggle(option)}
            onDoubleClick={onSelectOnly ? () => onSelectOnly(option) : undefined}
            sx={{
              opacity: excluded.has(option) ? 0.5 : 1,
              textDecoration: excluded.has(option) ? 'line-through' : 'none',
            }}
          />
        ))}
        {excluded.size > 0 && (
          <Chip
            label={t('library.filter.clearAll', 'Clear')}
            size="small"
            variant="outlined"
            onClick={onClear}
          />
        )}
      </Stack>
    </Box>
  );
}
