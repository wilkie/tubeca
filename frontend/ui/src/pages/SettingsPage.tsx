import { useState, useEffect, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Container,
  TextField,
  Typography,
  Paper,
  Alert,
  CircularProgress,
} from '@mui/material';
import { apiClient, type Settings } from '../api/client';

export function SettingsPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [instanceName, setInstanceName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      const result = await apiClient.getSettings();
      if (cancelled) return;

      if (result.error) {
        setError(result.error);
      } else if (result.data) {
        setSettings(result.data.settings);
        setInstanceName(result.data.settings.instanceName);
      }
      setIsLoading(false);
    }

    loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setIsSaving(true);

    const result = await apiClient.updateSettings({ instanceName });
    setIsSaving(false);

    if (result.error) {
      setError(result.error);
    } else if (result.data) {
      setSettings(result.data.settings);
      setSuccess(true);
    }
  };

  if (isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '50vh',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        {t('settings.title')}
      </Typography>

      <Paper elevation={2} sx={{ p: 3, mt: 3 }}>
        <Typography variant="h6" gutterBottom>
          {t('settings.general')}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {t('settings.saved')}
          </Alert>
        )}

        <Box component="form" onSubmit={handleSubmit}>
          <TextField
            fullWidth
            label={t('settings.instanceName')}
            value={instanceName}
            onChange={(e) => setInstanceName(e.target.value)}
            margin="normal"
            helperText={t('settings.instanceNameHelp')}
          />

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              type="submit"
              variant="contained"
              disabled={isSaving || instanceName === settings?.instanceName}
            >
              {isSaving ? <CircularProgress size={24} /> : t('settings.save')}
            </Button>
          </Box>
        </Box>
      </Paper>
    </Container>
  );
}
