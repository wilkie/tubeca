import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  CardActionArea,
  CardMedia,
} from '@mui/material';
import { Person } from '@mui/icons-material';
import { apiClient, type Image } from '../api/client';

interface CreditWithPerson {
  id: string;
  name: string;
  role?: string | null;
  creditType: string;
  personId?: string | null;
  person?: {
    id: string;
    images?: Image[];
  } | null;
}

interface CastCrewGridProps {
  credits: CreditWithPerson[];
  onPersonClick: (personId: string) => void;
  maxActors?: number;
  title?: string;
}

export function CastCrewGrid({
  credits,
  onPersonClick,
  maxActors = 10,
  title,
}: CastCrewGridProps) {
  const { t } = useTranslation();

  // Order: Actors (limited), Directors, Writers
  const orderedCredits = [
    ...credits.filter((c) => c.creditType === 'Actor').slice(0, maxActors),
    ...credits.filter((c) => c.creditType === 'Director'),
    ...credits.filter((c) => c.creditType === 'Writer'),
  ];

  if (orderedCredits.length === 0) return null;

  return (
    <Box sx={{ mt: 4 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        {title || t('media.castAndCrew', 'Cast & Crew')}
      </Typography>
      <Grid container spacing={2}>
        {orderedCredits.map((credit) => {
          const creditImage = credit.person?.images?.[0];

          return (
            <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={credit.id}>
              <Card
                sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
              >
                <CardActionArea
                  onClick={() => credit.personId && onPersonClick(credit.personId)}
                  disabled={!credit.personId}
                  sx={{
                    flexGrow: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                  }}
                >
                  {creditImage ? (
                    <CardMedia
                      component="img"
                      image={apiClient.getImageUrl(creditImage.id)}
                      alt={credit.name}
                      sx={{
                        aspectRatio: '2/3',
                        objectFit: 'cover',
                      }}
                    />
                  ) : (
                    <Box
                      sx={{
                        aspectRatio: '2/3',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor: 'action.hover',
                      }}
                    >
                      <Person sx={{ fontSize: 64, color: 'text.secondary' }} />
                    </Box>
                  )}
                  <CardContent
                    sx={{
                      textAlign: 'center',
                      py: 1,
                      flexGrow: 1,
                      overflow: 'hidden',
                    }}
                  >
                    <Typography
                      variant="body2"
                      noWrap
                      title={credit.name}
                      sx={{ textOverflow: 'ellipsis', overflow: 'hidden' }}
                    >
                      {credit.name}
                    </Typography>
                    {credit.creditType === 'Actor' && credit.role ? (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                        title={credit.role}
                        sx={{
                          display: 'block',
                          textOverflow: 'ellipsis',
                          overflow: 'hidden',
                        }}
                      >
                        {credit.role}
                      </Typography>
                    ) : (
                      credit.creditType !== 'Actor' && (
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {credit.creditType}
                        </Typography>
                      )
                    )}
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}
