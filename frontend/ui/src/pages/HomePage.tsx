import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  Typography,
} from '@mui/material';
import { Movie, MusicNote, Tv } from '@mui/icons-material';
import { apiClient } from '../api/client';
import type { Library, LibraryType } from '../api/client';
import { useActiveLibrary } from '../context/ActiveLibraryContext';
import { useAuth } from '../context/AuthContext';

const TYPE_ICONS: Record<LibraryType, typeof Movie> = {
  Television: Tv,
  Film: Movie,
  Music: MusicNote,
};

/**
 * Landing page for `/`: lists the libraries the current user can see and
 * links into each one. Login and setup both redirect here.
 */
export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { setActiveLibrary } = useActiveLibrary();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const result = await apiClient.getLibraries();
      if (cancelled) return;

      if (result.error) {
        setError(result.error);
      } else if (result.data) {
        setLibraries(result.data.libraries);
      }
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const openLibrary = (library: Library) => {
    setActiveLibrary(library.id);
    navigate(`/library/${library.id}`);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ m: 3 }}>
        {error}
      </Alert>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        {t('home.title')}
      </Typography>

      {libraries.length === 0 ? (
        <Box>
          <Typography color="text.secondary">{t('home.empty')}</Typography>
          {user?.role === 'Admin' && (
            <Button
              variant="contained"
              sx={{ mt: 2 }}
              onClick={() => navigate('/admin/libraries')}
            >
              {t('home.addLibrary')}
            </Button>
          )}
        </Box>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 2,
          }}
        >
          {libraries.map((library) => {
            const Icon = TYPE_ICONS[library.libraryType] ?? Movie;
            return (
              <Card key={library.id}>
                <CardActionArea onClick={() => openLibrary(library)} aria-label={library.name}>
                  <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Icon fontSize="large" color="primary" />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="h6" noWrap>
                        {library.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t(`libraries.libraryTypes.${library.libraryType}`)}
                      </Typography>
                    </Box>
                  </CardContent>
                </CardActionArea>
              </Card>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
