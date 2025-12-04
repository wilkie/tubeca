import { Stack, Typography, Chip } from '@mui/material';
import { useTranslation } from 'react-i18next';

interface FilterChipsProps {
  label: string;
  options: string[];
  excluded: Set<string>;
  onToggle: (value: string) => void;
  onClear: () => void;
}

export function FilterChips({
  label,
  options,
  excluded,
  onToggle,
  onClear,
}: FilterChipsProps) {
  const { t } = useTranslation();

  if (options.length === 0) return null;

  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 3 }} flexWrap="wrap" useFlexGap>
      <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
        {label}:
      </Typography>
      {options.map((option) => (
        <Chip
          key={option}
          label={option}
          size="small"
          variant={excluded.has(option) ? 'outlined' : 'filled'}
          color={excluded.has(option) ? 'default' : 'primary'}
          onClick={() => onToggle(option)}
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
  );
}
