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
  Tabs,
  Tab,
  Switch,
  FormControlLabel,
  Slider,
  Divider,
  Chip,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  FormHelperText,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import { apiClient, type Settings, type TranscodingSettings } from '../api/client';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const [tabValue, setTabValue] = useState(0);

  // General settings
  const [settings, setSettings] = useState<Settings | null>(null);
  const [instanceName, setInstanceName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Transcoding settings
  const [transcodingSettings, setTranscodingSettings] = useState<TranscodingSettings | null>(null);
  const [isLoadingTranscoding, setIsLoadingTranscoding] = useState(false);
  const [isSavingTranscoding, setIsSavingTranscoding] = useState(false);
  const [transcodingError, setTranscodingError] = useState<string | null>(null);
  const [transcodingSuccess, setTranscodingSuccess] = useState(false);

  // Transcoding form state
  const [enableHardwareAccel, setEnableHardwareAccel] = useState(true);
  const [preset, setPreset] = useState('veryfast');
  const [enableLowLatency, setEnableLowLatency] = useState(true);
  const [threadCount, setThreadCount] = useState(0);
  const [maxConcurrentTranscodes, setMaxConcurrentTranscodes] = useState(2);
  const [segmentDuration, setSegmentDuration] = useState(6);
  const [prefetchSegments, setPrefetchSegments] = useState(2);
  const [bitrate1080p, setBitrate1080p] = useState(8000);
  const [bitrate720p, setBitrate720p] = useState(5000);
  const [bitrate480p, setBitrate480p] = useState(2500);
  const [bitrate360p, setBitrate360p] = useState(1000);

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

  // Load transcoding settings when tab changes to transcoding
  useEffect(() => {
    if (tabValue !== 1 || transcodingSettings) return;

    let cancelled = false;

    async function loadTranscodingSettings() {
      setIsLoadingTranscoding(true);
      const result = await apiClient.getTranscodingSettings();
      if (cancelled) return;

      if (result.error) {
        setTranscodingError(result.error);
      } else if (result.data) {
        const s = result.data.settings;
        setTranscodingSettings(s);
        setEnableHardwareAccel(s.enableHardwareAccel);
        setPreset(s.preset);
        setEnableLowLatency(s.enableLowLatency);
        setThreadCount(s.threadCount);
        setMaxConcurrentTranscodes(s.maxConcurrentTranscodes);
        setSegmentDuration(s.segmentDuration);
        setPrefetchSegments(s.prefetchSegments);
        setBitrate1080p(s.bitrate1080p);
        setBitrate720p(s.bitrate720p);
        setBitrate480p(s.bitrate480p);
        setBitrate360p(s.bitrate360p);
      }
      setIsLoadingTranscoding(false);
    }

    loadTranscodingSettings();

    return () => {
      cancelled = true;
    };
  }, [tabValue, transcodingSettings]);

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

  const handleTranscodingSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTranscodingError(null);
    setTranscodingSuccess(false);
    setIsSavingTranscoding(true);

    const result = await apiClient.updateTranscodingSettings({
      enableHardwareAccel,
      preferredEncoder: null,
      preset,
      enableLowLatency,
      threadCount,
      maxConcurrentTranscodes,
      segmentDuration,
      prefetchSegments,
      bitrate1080p,
      bitrate720p,
      bitrate480p,
      bitrate360p,
    });

    setIsSavingTranscoding(false);

    if (result.error) {
      setTranscodingError(result.error);
    } else if (result.data) {
      setTranscodingSettings(result.data.settings);
      setTranscodingSuccess(true);
    }
  };

  const hasTranscodingChanges = transcodingSettings && (
    enableHardwareAccel !== transcodingSettings.enableHardwareAccel ||
    preset !== transcodingSettings.preset ||
    enableLowLatency !== transcodingSettings.enableLowLatency ||
    threadCount !== transcodingSettings.threadCount ||
    maxConcurrentTranscodes !== transcodingSettings.maxConcurrentTranscodes ||
    segmentDuration !== transcodingSettings.segmentDuration ||
    prefetchSegments !== transcodingSettings.prefetchSegments ||
    bitrate1080p !== transcodingSettings.bitrate1080p ||
    bitrate720p !== transcodingSettings.bitrate720p ||
    bitrate480p !== transcodingSettings.bitrate480p ||
    bitrate360p !== transcodingSettings.bitrate360p
  );

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

      <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tab label={t('settings.general')} />
        <Tab label={t('settings.transcoding', 'Transcoding')} />
      </Tabs>

      {/* General Settings Tab */}
      <TabPanel value={tabValue} index={0}>
        <Paper elevation={2} sx={{ p: 3 }}>
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
      </TabPanel>

      {/* Transcoding Settings Tab */}
      <TabPanel value={tabValue} index={1}>
        {isLoadingTranscoding ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box component="form" onSubmit={handleTranscodingSubmit}>
            {transcodingError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {transcodingError}
              </Alert>
            )}

            {transcodingSuccess && (
              <Alert severity="success" sx={{ mb: 2 }}>
                {t('settings.saved')}
              </Alert>
            )}

            {/* Encoder Info */}
            <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                {t('settings.encoder', 'Video Encoder')}
              </Typography>

              {transcodingSettings && (
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {t('settings.detectedEncoder', 'Detected Encoder')}
                    </Typography>
                    <Chip
                      label={transcodingSettings.detectedEncoder.name}
                      color={transcodingSettings.detectedEncoder.type === 'hardware' ? 'success' : 'default'}
                      size="small"
                    />
                  </Box>
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {t('settings.activeEncoder', 'Active Encoder')}
                    </Typography>
                    <Chip
                      label={transcodingSettings.activeEncoder.name}
                      color={transcodingSettings.activeEncoder.type === 'hardware' ? 'success' : 'default'}
                      size="small"
                    />
                  </Box>
                </Box>
              )}

              <FormControlLabel
                control={
                  <Switch
                    checked={enableHardwareAccel}
                    onChange={(e) => setEnableHardwareAccel(e.target.checked)}
                  />
                }
                label={t('settings.enableHardwareAccel', 'Enable hardware acceleration')}
              />
              <FormHelperText>
                {t('settings.enableHardwareAccelHelp', 'Use GPU encoding when available for better performance')}
              </FormHelperText>
            </Paper>

            {/* Performance Settings */}
            <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                {t('settings.performance', 'Performance')}
              </Typography>

              <FormControl fullWidth margin="normal">
                <InputLabel>{t('settings.preset', 'Encoding Preset')}</InputLabel>
                <Select
                  value={preset}
                  label={t('settings.preset', 'Encoding Preset')}
                  onChange={(e: SelectChangeEvent) => setPreset(e.target.value)}
                >
                  {transcodingSettings?.availablePresets.map((p) => (
                    <MenuItem key={p} value={p}>
                      {p}
                    </MenuItem>
                  )) || (
                    <>
                      <MenuItem value="ultrafast">ultrafast</MenuItem>
                      <MenuItem value="superfast">superfast</MenuItem>
                      <MenuItem value="veryfast">veryfast</MenuItem>
                      <MenuItem value="faster">faster</MenuItem>
                      <MenuItem value="fast">fast</MenuItem>
                      <MenuItem value="medium">medium</MenuItem>
                    </>
                  )}
                </Select>
                <FormHelperText>
                  {t('settings.presetHelp', 'Faster presets use less CPU but produce larger files')}
                </FormHelperText>
              </FormControl>

              <FormControlLabel
                control={
                  <Switch
                    checked={enableLowLatency}
                    onChange={(e) => setEnableLowLatency(e.target.checked)}
                  />
                }
                label={t('settings.enableLowLatency', 'Enable low latency mode')}
              />
              <FormHelperText sx={{ mb: 2 }}>
                {t('settings.enableLowLatencyHelp', 'Optimize for streaming with minimal buffering')}
              </FormHelperText>

              <Box sx={{ mt: 2 }}>
                <Typography gutterBottom>
                  {t('settings.threadCount', 'Threads Per Process')}: {threadCount === 0 ? t('settings.auto', 'Auto') : threadCount}
                </Typography>
                <Slider
                  value={threadCount}
                  onChange={(_, v) => setThreadCount(v as number)}
                  min={0}
                  max={16}
                  marks={[
                    { value: 0, label: 'Auto' },
                    { value: 4, label: '4' },
                    { value: 8, label: '8' },
                    { value: 16, label: '16' },
                  ]}
                />
                <FormHelperText>
                  {t('settings.threadCountHelp', 'Number of CPU threads each FFmpeg process uses (0 = auto-detect)')}
                </FormHelperText>
              </Box>

              <Box sx={{ mt: 3 }}>
                <Typography gutterBottom>
                  {t('settings.maxConcurrentTranscodes', 'Max Concurrent Transcodes')}: {maxConcurrentTranscodes}
                </Typography>
                <Slider
                  value={maxConcurrentTranscodes}
                  onChange={(_, v) => setMaxConcurrentTranscodes(v as number)}
                  min={1}
                  max={8}
                  marks={[
                    { value: 1, label: '1' },
                    { value: 2, label: '2' },
                    { value: 4, label: '4' },
                    { value: 8, label: '8' },
                  ]}
                />
                <FormHelperText>
                  {t('settings.maxConcurrentTranscodesHelp', 'Maximum FFmpeg processes that can run simultaneously. Lower values reduce CPU load but may increase buffering.')}
                </FormHelperText>
              </Box>
            </Paper>

            {/* Segment Settings */}
            <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                {t('settings.segments', 'HLS Segments')}
              </Typography>

              <Box sx={{ mt: 2 }}>
                <Typography gutterBottom>
                  {t('settings.segmentDuration', 'Segment Duration')}: {segmentDuration}s
                </Typography>
                <Slider
                  value={segmentDuration}
                  onChange={(_, v) => setSegmentDuration(v as number)}
                  min={2}
                  max={10}
                  marks={[
                    { value: 2, label: '2s' },
                    { value: 4, label: '4s' },
                    { value: 6, label: '6s' },
                    { value: 10, label: '10s' },
                  ]}
                />
                <FormHelperText>
                  {t('settings.segmentDurationHelp', 'Shorter segments allow faster quality switching')}
                </FormHelperText>
              </Box>

              <Box sx={{ mt: 3 }}>
                <Typography gutterBottom>
                  {t('settings.prefetchSegments', 'Prefetch Segments')}: {prefetchSegments}
                </Typography>
                <Slider
                  value={prefetchSegments}
                  onChange={(_, v) => setPrefetchSegments(v as number)}
                  min={0}
                  max={5}
                  marks={[
                    { value: 0, label: '0' },
                    { value: 2, label: '2' },
                    { value: 5, label: '5' },
                  ]}
                />
                <FormHelperText>
                  {t('settings.prefetchSegmentsHelp', 'Number of segments to generate ahead for smoother playback')}
                </FormHelperText>
              </Box>
            </Paper>

            {/* Quality Settings */}
            <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                {t('settings.quality', 'Quality Bitrates')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('settings.qualityHelp', 'Higher bitrates produce better quality but require more bandwidth')}
              </Typography>

              <Divider sx={{ my: 2 }} />

              <Box sx={{ mt: 2 }}>
                <Typography gutterBottom>
                  1080p: {bitrate1080p} kbps ({(bitrate1080p / 1000).toFixed(1)} Mbps)
                </Typography>
                <Slider
                  value={bitrate1080p}
                  onChange={(_, v) => setBitrate1080p(v as number)}
                  min={4000}
                  max={15000}
                  step={500}
                />
              </Box>

              <Box sx={{ mt: 2 }}>
                <Typography gutterBottom>
                  720p: {bitrate720p} kbps ({(bitrate720p / 1000).toFixed(1)} Mbps)
                </Typography>
                <Slider
                  value={bitrate720p}
                  onChange={(_, v) => setBitrate720p(v as number)}
                  min={2000}
                  max={10000}
                  step={500}
                />
              </Box>

              <Box sx={{ mt: 2 }}>
                <Typography gutterBottom>
                  480p: {bitrate480p} kbps ({(bitrate480p / 1000).toFixed(1)} Mbps)
                </Typography>
                <Slider
                  value={bitrate480p}
                  onChange={(_, v) => setBitrate480p(v as number)}
                  min={1000}
                  max={5000}
                  step={250}
                />
              </Box>

              <Box sx={{ mt: 2 }}>
                <Typography gutterBottom>
                  360p: {bitrate360p} kbps ({(bitrate360p / 1000).toFixed(1)} Mbps)
                </Typography>
                <Slider
                  value={bitrate360p}
                  onChange={(_, v) => setBitrate360p(v as number)}
                  min={500}
                  max={2500}
                  step={100}
                />
              </Box>
            </Paper>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                type="submit"
                variant="contained"
                disabled={isSavingTranscoding || !hasTranscodingChanges}
              >
                {isSavingTranscoding ? <CircularProgress size={24} /> : t('settings.save')}
              </Button>
            </Box>
          </Box>
        )}
      </TabPanel>
    </Container>
  );
}
