import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { CheckBox, CheckBoxOutlineBlank, Clear, FilterList } from '@mui/icons-material';
import { SortControls, type SortDirection, type SortOption } from './SortControls';
import { ViewModeMenu, type ViewMode } from './ViewModeMenu';

export interface LibraryToolbarProps {
  libraryName: string;
  total: number;
  /** Hidden entirely when a library has nothing to filter on. */
  showFilterButton: boolean;
  activeFilterCount: number;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  onClearFilters: () => void;
  isSelectionMode: boolean;
  onToggleSelectionMode: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  sortOptions: SortOption[];
  sortField: string;
  sortDirection: SortDirection;
  onSortFieldChange: (field: string) => void;
  onSortDirectionChange: (direction: SortDirection) => void;
}

/**
 * The library heading and its controls: filters, multi-select, view mode and
 * sort.
 *
 * The filter badge doubles as a clear button; hovering it while filters are
 * active swaps the count for a cross.
 */
export function LibraryToolbar(props: LibraryToolbarProps) {
  const { t } = useTranslation();
  const [badgeHovered, setBadgeHovered] = useState(false);
  const canClear = props.activeFilterCount > 0;
  const showClear = canClear && badgeHovered;

  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }} flexWrap="wrap" gap={2}>
      <Typography variant="h4" component="h1">
        {props.libraryName}
        {props.total > 0 && (
          <Typography component="span" variant="body1" color="text.secondary" sx={{ ml: 2 }}>
            ({props.total})
          </Typography>
        )}
      </Typography>

      <Stack direction="row" spacing={1} alignItems="center">
        {props.showFilterButton && (
          <Tooltip
            title={showClear ? t('library.filter.clearAll', 'Clear') : t('library.filter.toggle', 'Toggle filters')}
          >
            <Badge
              badgeContent={showClear ? <Clear sx={{ fontSize: 12 }} /> : props.activeFilterCount}
              color={showClear ? 'error' : 'primary'}
              max={99}
              slotProps={{
                badge: {
                  onMouseEnter: () => canClear && setBadgeHovered(true),
                  onMouseLeave: () => setBadgeHovered(false),
                  onClick: (e: React.MouseEvent) => {
                    if (!canClear) return;
                    e.stopPropagation();
                    props.onClearFilters();
                    setBadgeHovered(false);
                  },
                  style: { width: 20, height: 20, ...(canClear ? { cursor: 'pointer' } : {}) },
                },
              }}
            >
              <IconButton
                size="small"
                onClick={props.onToggleFilters}
                color={props.filtersOpen ? 'primary' : 'default'}
                aria-label={t('library.filter.toggle', 'Toggle filters')}
              >
                <FilterList />
              </IconButton>
            </Badge>
          </Tooltip>
        )}

        <Tooltip title={props.isSelectionMode ? t('selection.exitMode') : t('selection.enterMode')}>
          <IconButton
            size="small"
            onClick={props.onToggleSelectionMode}
            color={props.isSelectionMode ? 'primary' : 'default'}
          >
            {props.isSelectionMode ? <CheckBox /> : <CheckBoxOutlineBlank />}
          </IconButton>
        </Tooltip>

        <ViewModeMenu value={props.viewMode} onChange={props.onViewModeChange} />
        <SortControls
          options={props.sortOptions}
          value={props.sortField}
          direction={props.sortDirection}
          onValueChange={props.onSortFieldChange}
          onDirectionChange={props.onSortDirectionChange}
        />
      </Stack>
    </Stack>
  );
}
