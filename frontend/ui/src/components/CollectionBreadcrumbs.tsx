import { Breadcrumbs, Link, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';

export interface BreadcrumbItem {
  id: string;
  name: string;
  type: 'library' | 'collection';
}

interface CollectionBreadcrumbsProps {
  breadcrumbs: BreadcrumbItem[];
  currentName: string;
  onNavigate: (item: BreadcrumbItem) => void;
  variant?: 'default' | 'hero';
  sx?: SxProps<Theme>;
}

export function CollectionBreadcrumbs({
  breadcrumbs,
  currentName,
  onNavigate,
  variant = 'default',
  sx,
}: CollectionBreadcrumbsProps) {
  const isHero = variant === 'hero';

  return (
    <Breadcrumbs
      sx={{
        ...(isHero && {
          '& .MuiBreadcrumbs-separator': { color: 'grey.400' },
        }),
        ...sx,
      }}
    >
      {breadcrumbs.map((crumb) => (
        <Link
          key={crumb.id}
          component="button"
          variant="body2"
          onClick={() => onNavigate(crumb)}
          underline="hover"
          sx={{
            cursor: 'pointer',
            ...(isHero
              ? {
                  color: 'grey.300',
                  '&:hover': { color: 'white' },
                }
              : {
                  color: 'inherit',
                }),
          }}
        >
          {crumb.name}
        </Link>
      ))}
      <Typography
        color={isHero ? undefined : 'text.primary'}
        sx={isHero ? { color: 'grey.100' } : undefined}
      >
        {currentName}
      </Typography>
    </Breadcrumbs>
  );
}
