import {
  DEFAULT_VIEWPORT_WIDTH,
  fireEvent,
  render,
  screen,
  setViewportWidth,
  waitFor,
} from '../../test-utils';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import {
  languageName,
  VideoControls,
  formatTime,
  formatAudioTrackLabel,
  formatSubtitleTrackLabel,
  type AudioTrackInfo,
  type SubtitleTrackInfo,
} from '../VideoControls';

// Mock useNavigate
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

/** The real translations, so a label test reads what a viewer would see. */
const labels = { t: i18n.t, locale: 'en' };

const defaultProps = {
  isPlaying: false,
  currentTime: 0,
  duration: 3600,
  volume: 1,
  isMuted: false,
  isLoading: false,
  onPlayPause: jest.fn(),
  onSeek: jest.fn(),
  onSeekCommit: jest.fn(),
  onVolumeChange: jest.fn(),
  onMuteToggle: jest.fn(),
};

describe('VideoControls', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('formatTime utility', () => {
    it('formats seconds only', () => {
      expect(formatTime(45)).toBe('0:45');
    });

    it('formats minutes and seconds', () => {
      expect(formatTime(125)).toBe('2:05');
    });

    it('formats hours, minutes and seconds', () => {
      expect(formatTime(3661)).toBe('1:01:01');
    });

    it('pads single digit seconds', () => {
      expect(formatTime(65)).toBe('1:05');
    });

    it('handles zero', () => {
      expect(formatTime(0)).toBe('0:00');
    });
  });

  describe('formatAudioTrackLabel utility', () => {
    it('formats track with language', () => {
      const track: AudioTrackInfo = {
        streamIndex: 0,
        language: 'eng',
        title: null,
        channels: null,
        channelLayout: null,
        isDefault: true,
      };
      expect(formatAudioTrackLabel(track, labels)).toBe('English');
    });

    it('formats track with language and channel layout', () => {
      const track: AudioTrackInfo = {
        streamIndex: 0,
        language: 'eng',
        title: null,
        channels: null,
        channelLayout: '5.1',
        isDefault: true,
      };
      expect(formatAudioTrackLabel(track, labels)).toBe('English - 5.1');
    });

    it('formats track with title', () => {
      const track: AudioTrackInfo = {
        streamIndex: 0,
        language: 'eng',
        title: 'Commentary',
        channels: null,
        channelLayout: null,
        isDefault: false,
      };
      expect(formatAudioTrackLabel(track, labels)).toBe('English - Commentary');
    });

    it('formats track with only channels', () => {
      const track: AudioTrackInfo = {
        streamIndex: 0,
        language: null,
        title: null,
        channels: 6,
        channelLayout: null,
        isDefault: false,
      };
      expect(formatAudioTrackLabel(track, labels)).toBe('6ch');
    });

    it('falls back to track number', () => {
      const track: AudioTrackInfo = {
        streamIndex: 2,
        language: null,
        title: null,
        channels: null,
        channelLayout: null,
        isDefault: false,
      };
      expect(formatAudioTrackLabel(track, labels)).toBe('Track 2');
    });
  });

  describe('formatSubtitleTrackLabel utility', () => {
    it('formats track with language', () => {
      const track: SubtitleTrackInfo = {
        streamIndex: 0,
        language: 'spa',
        title: null,
        isDefault: false,
        isForced: false,
        url: '/subtitles/0',
      };
      expect(formatSubtitleTrackLabel(track, labels)).toBe('Spanish');
    });

    it('formats forced subtitle track', () => {
      const track: SubtitleTrackInfo = {
        streamIndex: 0,
        language: 'eng',
        title: null,
        isDefault: false,
        isForced: true,
        url: '/subtitles/0',
      };
      expect(formatSubtitleTrackLabel(track, labels)).toBe('English - (Forced)');
    });

    it('formats track with title', () => {
      const track: SubtitleTrackInfo = {
        streamIndex: 0,
        language: 'eng',
        title: 'SDH',
        isDefault: false,
        isForced: false,
        url: '/subtitles/0',
      };
      expect(formatSubtitleTrackLabel(track, labels)).toBe('English - SDH');
    });

    it('falls back to track number', () => {
      const track: SubtitleTrackInfo = {
        streamIndex: 3,
        language: null,
        title: null,
        isDefault: false,
        isForced: false,
        url: '/subtitles/3',
      };
      expect(formatSubtitleTrackLabel(track, labels)).toBe('Track 3');
    });
  });

  describe('rendering', () => {
    it('renders play button when not playing', () => {
      render(<VideoControls {...defaultProps} />);

      expect(screen.getByTestId('PlayArrowIcon')).toBeInTheDocument();
    });

    it('renders pause button when playing', () => {
      render(<VideoControls {...defaultProps} isPlaying={true} />);

      expect(screen.getByTestId('PauseIcon')).toBeInTheDocument();
    });

    it('renders loading spinner when loading', () => {
      render(<VideoControls {...defaultProps} isLoading={true} />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('renders time display', () => {
      render(<VideoControls {...defaultProps} currentTime={125} duration={3600} />);

      expect(screen.getByText('2:05 / 1:00:00')).toBeInTheDocument();
    });

    it('renders title when provided', () => {
      render(<VideoControls {...defaultProps} title="Test Video" />);

      expect(screen.getByText('Test Video')).toBeInTheDocument();
    });

    it('hides controls when showControls is false', () => {
      const { container } = render(<VideoControls {...defaultProps} showControls={false} />);

      // Controls should have opacity 0
      const controlsOverlay = container.querySelector('[class*="MuiBox-root"]');
      expect(controlsOverlay).toBeInTheDocument();
    });

    it('renders volume icon when not muted', () => {
      render(<VideoControls {...defaultProps} isMuted={false} />);

      expect(screen.getByTestId('VolumeUpIcon')).toBeInTheDocument();
    });

    it('renders muted icon when muted', () => {
      render(<VideoControls {...defaultProps} isMuted={true} />);

      expect(screen.getByTestId('VolumeOffIcon')).toBeInTheDocument();
    });
  });

  describe('compact mode', () => {
    it('hides title in compact mode', () => {
      render(<VideoControls {...defaultProps} title="Test Video" compact={true} />);

      expect(screen.queryByText('Test Video')).not.toBeInTheDocument();
    });

    it('hides time display in compact mode', () => {
      render(<VideoControls {...defaultProps} currentTime={125} compact={true} />);

      expect(screen.queryByText(/2:05/)).not.toBeInTheDocument();
    });

    it('hides volume slider in compact mode', () => {
      const { container } = render(<VideoControls {...defaultProps} compact={true} />);

      // In compact mode there's only the seek slider
      const sliders = container.querySelectorAll('.MuiSlider-root');
      expect(sliders.length).toBe(1); // Only seek slider
    });
  });

  describe('on a phone-sized screen', () => {
    const PHONE_WIDTH = 380;

    afterEach(() => setViewportWidth(DEFAULT_VIEWPORT_WIDTH));

    it('drops the volume slider, which the row has no room for', () => {
      setViewportWidth(PHONE_WIDTH);
      const { container } = render(<VideoControls {...defaultProps} />);

      // The seek slider is all that is left; muting is still a button.
      expect(container.querySelectorAll('.MuiSlider-root')).toHaveLength(1);
      expect(screen.getByTestId('VolumeUpIcon')).toBeInTheDocument();
    });

    it('moves the time under the progress bar rather than into the row', () => {
      setViewportWidth(PHONE_WIDTH);
      render(<VideoControls {...defaultProps} currentTime={125} duration={3600} />);

      // Two readouts rather than one "2:05 / 1:00:00".
      expect(screen.getByText('2:05')).toBeInTheDocument();
      expect(screen.getByText('1:00:00')).toBeInTheDocument();
      expect(screen.queryByText('2:05 / 1:00:00')).not.toBeInTheDocument();
    });

    it('keeps the controls a phone actually needs', () => {
      setViewportWidth(PHONE_WIDTH);
      render(
        <VideoControls
          {...defaultProps}
          audioTracks={[
            { streamIndex: 1, language: 'eng', title: null, channels: 2, channelLayout: 'stereo', isDefault: true },
            { streamIndex: 2, language: 'fra', title: null, channels: 2, channelLayout: 'stereo', isDefault: false },
          ]}
          subtitleTracks={[
            { streamIndex: 3, language: 'eng', title: null, isDefault: false, isForced: false, url: '/s.vtt' },
          ]}
          showFullscreenButton
          onFullscreenToggle={jest.fn()}
        />
      );

      expect(screen.getByLabelText('Select subtitle track')).toBeInTheDocument();
      expect(screen.getByLabelText('Select audio track')).toBeInTheDocument();
      expect(screen.getByTestId('FullscreenIcon')).toBeInTheDocument();
    });

    it('leaves a desktop-width player as it was', () => {
      const { container } = render(<VideoControls {...defaultProps} currentTime={125} duration={3600} />);

      expect(container.querySelectorAll('.MuiSlider-root')).toHaveLength(2);
      expect(screen.getByText('2:05 / 1:00:00')).toBeInTheDocument();
    });
  });

  describe('play/pause', () => {
    it('calls onPlayPause when play button clicked', async () => {
      const user = userEvent.setup();
      const onPlayPause = jest.fn();

      render(<VideoControls {...defaultProps} onPlayPause={onPlayPause} />);

      await user.click(screen.getByTestId('PlayArrowIcon').closest('button')!);

      expect(onPlayPause).toHaveBeenCalled();
    });
  });

  describe('volume controls', () => {
    it('calls onMuteToggle when volume button clicked', async () => {
      const user = userEvent.setup();
      const onMuteToggle = jest.fn();

      render(<VideoControls {...defaultProps} onMuteToggle={onMuteToggle} />);

      await user.click(screen.getByTestId('VolumeUpIcon').closest('button')!);

      expect(onMuteToggle).toHaveBeenCalled();
    });

    it('shows muted value on volume slider when muted', () => {
      render(<VideoControls {...defaultProps} isMuted={true} volume={0.5} />);

      const volumeSlider = screen.getAllByRole('slider')[1];
      expect(volumeSlider).toHaveAttribute('aria-valuenow', '0');
    });
  });

  describe('fullscreen button', () => {
    it('renders fullscreen button when showFullscreenButton is true', () => {
      const onFullscreenToggle = jest.fn();

      render(
        <VideoControls
          {...defaultProps}
          showFullscreenButton={true}
          onFullscreenToggle={onFullscreenToggle}
        />
      );

      expect(screen.getByTestId('FullscreenIcon')).toBeInTheDocument();
    });

    it('renders exit fullscreen icon when isFullscreen is true', () => {
      const onFullscreenToggle = jest.fn();

      render(
        <VideoControls
          {...defaultProps}
          showFullscreenButton={true}
          isFullscreen={true}
          onFullscreenToggle={onFullscreenToggle}
        />
      );

      expect(screen.getByTestId('FullscreenExitIcon')).toBeInTheDocument();
    });

    it('calls onFullscreenToggle when clicked', async () => {
      const user = userEvent.setup();
      const onFullscreenToggle = jest.fn();

      render(
        <VideoControls
          {...defaultProps}
          showFullscreenButton={true}
          onFullscreenToggle={onFullscreenToggle}
        />
      );

      await user.click(screen.getByTestId('FullscreenIcon').closest('button')!);

      expect(onFullscreenToggle).toHaveBeenCalled();
    });

    it('hides fullscreen button in compact mode', () => {
      render(
        <VideoControls
          {...defaultProps}
          showFullscreenButton={true}
          compact={true}
          onFullscreenToggle={jest.fn()}
        />
      );

      expect(screen.queryByTestId('FullscreenIcon')).not.toBeInTheDocument();
    });
  });

  describe('expand button', () => {
    it('renders expand button when showExpandButton is true', () => {
      render(<VideoControls {...defaultProps} showExpandButton={true} mediaId="media-1" />);

      expect(screen.getByTestId('OpenInFullIcon')).toBeInTheDocument();
    });

    it('navigates to play page when expand clicked', async () => {
      const user = userEvent.setup();

      render(<VideoControls {...defaultProps} showExpandButton={true} mediaId="media-1" />);

      await user.click(screen.getByTestId('OpenInFullIcon').closest('button')!);

      expect(mockNavigate).toHaveBeenCalledWith('/play/media-1');
    });
  });

  describe('close button', () => {
    it('renders close button when showCloseButton is true', () => {
      render(<VideoControls {...defaultProps} showCloseButton={true} onClose={jest.fn()} />);

      expect(screen.getByTestId('CloseIcon')).toBeInTheDocument();
    });

    it('calls onClose when clicked', async () => {
      const user = userEvent.setup();
      const onClose = jest.fn();

      render(<VideoControls {...defaultProps} showCloseButton={true} onClose={onClose} />);

      await user.click(screen.getByTestId('CloseIcon').closest('button')!);

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('audio track menu', () => {
    const audioTracks: AudioTrackInfo[] = [
      { streamIndex: 0, language: 'eng', title: null, channels: 6, channelLayout: '5.1', isDefault: true },
      { streamIndex: 1, language: 'spa', title: null, channels: 2, channelLayout: 'stereo', isDefault: false },
    ];

    it('does not render audio button with single track', () => {
      render(
        <VideoControls
          {...defaultProps}
          audioTracks={[audioTracks[0]]}
          currentAudioTrack={0}
        />
      );

      expect(screen.queryByLabelText('Select audio track')).not.toBeInTheDocument();
    });

    it('renders audio button with multiple tracks', () => {
      render(
        <VideoControls
          {...defaultProps}
          audioTracks={audioTracks}
          currentAudioTrack={0}
        />
      );

      expect(screen.getByLabelText('Select audio track')).toBeInTheDocument();
    });

    it('opens audio menu when button clicked', async () => {
      const user = userEvent.setup();

      render(
        <VideoControls
          {...defaultProps}
          audioTracks={audioTracks}
          currentAudioTrack={0}
        />
      );

      await user.click(screen.getByLabelText('Select audio track'));

      await waitFor(() => {
        expect(screen.getByText('English - 5.1')).toBeInTheDocument();
        expect(screen.getByText('Spanish - stereo')).toBeInTheDocument();
      });
    });

    it('calls onAudioTrackChange when track selected', async () => {
      const user = userEvent.setup();
      const onAudioTrackChange = jest.fn();

      render(
        <VideoControls
          {...defaultProps}
          audioTracks={audioTracks}
          currentAudioTrack={0}
          onAudioTrackChange={onAudioTrackChange}
        />
      );

      await user.click(screen.getByLabelText('Select audio track'));

      await waitFor(() => {
        expect(screen.getByText('Spanish - stereo')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Spanish - stereo'));

      expect(onAudioTrackChange).toHaveBeenCalledWith(1);
    });

    it('hides audio button in compact mode', () => {
      render(
        <VideoControls
          {...defaultProps}
          audioTracks={audioTracks}
          currentAudioTrack={0}
          compact={true}
        />
      );

      expect(screen.queryByLabelText('Select audio track')).not.toBeInTheDocument();
    });
  });

  describe('subtitle track menu', () => {
    const subtitleTracks: SubtitleTrackInfo[] = [
      { streamIndex: 0, language: 'eng', title: null, isDefault: false, isForced: false, url: '/sub/0' },
      { streamIndex: 1, language: 'spa', title: null, isDefault: false, isForced: false, url: '/sub/1' },
    ];

    it('renders subtitle button when tracks available', () => {
      render(
        <VideoControls
          {...defaultProps}
          subtitleTracks={subtitleTracks}
          currentSubtitleTrack={null}
        />
      );

      expect(screen.getByLabelText('Select subtitle track')).toBeInTheDocument();
    });

    it('opens subtitle menu when button clicked', async () => {
      const user = userEvent.setup();

      render(
        <VideoControls
          {...defaultProps}
          subtitleTracks={subtitleTracks}
          currentSubtitleTrack={null}
        />
      );

      await user.click(screen.getByLabelText('Select subtitle track'));

      await waitFor(() => {
        expect(screen.getByText('Off')).toBeInTheDocument();
        expect(screen.getByText('English')).toBeInTheDocument();
        expect(screen.getByText('Spanish')).toBeInTheDocument();
      });
    });

    it('calls onSubtitleTrackChange when track selected', async () => {
      const user = userEvent.setup();
      const onSubtitleTrackChange = jest.fn();

      render(
        <VideoControls
          {...defaultProps}
          subtitleTracks={subtitleTracks}
          currentSubtitleTrack={null}
          onSubtitleTrackChange={onSubtitleTrackChange}
        />
      );

      await user.click(screen.getByLabelText('Select subtitle track'));

      await waitFor(() => {
        expect(screen.getByText('English')).toBeInTheDocument();
      });

      await user.click(screen.getByText('English'));

      expect(onSubtitleTrackChange).toHaveBeenCalledWith(0);
    });

    it('calls onSubtitleTrackChange with null when Off selected', async () => {
      const user = userEvent.setup();
      const onSubtitleTrackChange = jest.fn();

      render(
        <VideoControls
          {...defaultProps}
          subtitleTracks={subtitleTracks}
          currentSubtitleTrack={0}
          onSubtitleTrackChange={onSubtitleTrackChange}
        />
      );

      await user.click(screen.getByLabelText('Select subtitle track'));

      await waitFor(() => {
        expect(screen.getByText('Off')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Off'));

      expect(onSubtitleTrackChange).toHaveBeenCalledWith(null);
    });

    it('shows subtitle button when track is selected', () => {
      render(
        <VideoControls
          {...defaultProps}
          subtitleTracks={subtitleTracks}
          currentSubtitleTrack={0}
        />
      );

      // Button should be present when track is selected
      expect(screen.getByLabelText('Select subtitle track')).toBeInTheDocument();
    });
  });

  describe('quality menu', () => {
    const qualityOptions = [
      { name: 'auto', label: 'Auto', bandwidth: 0 },
      { name: '1080p', label: '1080p (5000 kbps)', bandwidth: 5000000 },
      { name: '720p', label: '720p (2500 kbps)', bandwidth: 2500000 },
    ];

    it('renders quality button when options available', () => {
      render(
        <VideoControls
          {...defaultProps}
          qualityOptions={qualityOptions}
          currentQuality="auto"
        />
      );

      expect(screen.getByLabelText('Select quality')).toBeInTheDocument();
    });

    it('opens quality menu when button clicked', async () => {
      const user = userEvent.setup();

      render(
        <VideoControls
          {...defaultProps}
          qualityOptions={qualityOptions}
          currentQuality="auto"
        />
      );

      await user.click(screen.getByLabelText('Select quality'));

      await waitFor(() => {
        expect(screen.getByText('Auto')).toBeInTheDocument();
        expect(screen.getByText('1080p (5000 kbps)')).toBeInTheDocument();
        expect(screen.getByText('720p (2500 kbps)')).toBeInTheDocument();
      });
    });

    it('calls onQualityChange when quality selected', async () => {
      const user = userEvent.setup();
      const onQualityChange = jest.fn();

      render(
        <VideoControls
          {...defaultProps}
          qualityOptions={qualityOptions}
          currentQuality="auto"
          onQualityChange={onQualityChange}
        />
      );

      await user.click(screen.getByLabelText('Select quality'));

      await waitFor(() => {
        expect(screen.getByText('1080p (5000 kbps)')).toBeInTheDocument();
      });

      await user.click(screen.getByText('1080p (5000 kbps)'));

      expect(onQualityChange).toHaveBeenCalledWith('1080p');
    });

    it('shows quality button when quality is set', () => {
      render(
        <VideoControls
          {...defaultProps}
          qualityOptions={qualityOptions}
          currentQuality="1080p"
        />
      );

      // Button should be present when quality is set
      expect(screen.getByLabelText('Select quality')).toBeInTheDocument();
    });
  });

  describe('seek slider', () => {
    it('calls onSeek when slider value changes', () => {
      const onSeek = jest.fn();

      render(<VideoControls {...defaultProps} duration={100} onSeek={onSeek} />);

      const slider = screen.getAllByRole('slider')[0];
      fireEvent.change(slider, { target: { value: 50 } });

      expect(onSeek).toHaveBeenCalled();
    });
  });

  describe('trickplay preview', () => {
    const trickplay = {
      width: 320,
      columns: 5,
      rows: 5,
      tileWidth: 160,
      tileHeight: 90,
      tileCount: 25,
      interval: 10,
      imageCount: 4,
      spriteCount: 4,
    };

    it('does not show preview without trickplay data', () => {
      render(<VideoControls {...defaultProps} mediaId="media-1" />);

      expect(screen.queryByTestId('trickplay-preview')).not.toBeInTheDocument();
    });

    it('does not show preview in compact mode', () => {
      render(
        <VideoControls
          {...defaultProps}
          trickplay={trickplay}
          mediaId="media-1"
          compact={true}
        />
      );

      // Move mouse over slider
      const slider = screen.getByRole('slider');
      fireEvent.mouseMove(slider, { clientX: 100 });

      expect(screen.queryByTestId('trickplay-preview')).not.toBeInTheDocument();
    });
  });
});

describe('languageName', () => {
  it('names a language from its two-letter code', () => {
    expect(languageName('en', labels)).toBe('English');
    expect(languageName('nl', labels)).toBe('Dutch');
  });

  it('names one from the three-letter codes media files carry', () => {
    // Both the terminological and the bibliographic form of the same language.
    expect(languageName('deu', labels)).toBe('German');
    expect(languageName('ger', labels)).toBe('German');
    expect(languageName('fre', labels)).toBe('French');
  });

  it('names it in the viewer\'s own language', () => {
    // The point of naming a language rather than printing its code.
    expect(languageName('de', { t: i18n.t, locale: 'fr' })).toBe('allemand');
    expect(languageName('ja', { t: i18n.t, locale: 'es' })).toBe('japonés');
  });

  it('says "Unknown" for the code that means exactly that', () => {
    expect(languageName('und', labels)).toBe('Unknown');
  });

  it('falls back to the code when nothing knows it', () => {
    // Intl hands an unrecognised tag straight back, which is not a name.
    expect(languageName('zz', labels)).toBe('ZZ');
    expect(languageName('qaa', labels)).toBe('QAA');
  });

  it('does not throw on a code that is not a tag at all', () => {
    expect(languageName('not a tag', labels)).toBe('NOT A TAG');
  });
});

describe('every control has a name a screen reader can read', () => {
  const tracks = {
    audioTracks: [
      { streamIndex: 1, language: 'eng', title: null, channels: 2, channelLayout: 'stereo', isDefault: true },
      { streamIndex: 2, language: 'fra', title: null, channels: 2, channelLayout: 'stereo', isDefault: false },
    ],
    subtitleTracks: [
      { streamIndex: 3, language: 'eng', title: null, isDefault: false, isForced: false, url: '/s.vtt' },
    ],
  };

  it('names the play button for what it will do', () => {
    const { rerender } = render(<VideoControls {...defaultProps} {...tracks} isPlaying={false} />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();

    rerender(<VideoControls {...defaultProps} {...tracks} isPlaying />);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('names the mute button for what it will do', () => {
    const { rerender } = render(<VideoControls {...defaultProps} isMuted={false} />);
    expect(screen.getByRole('button', { name: 'Mute' })).toBeInTheDocument();

    rerender(<VideoControls {...defaultProps} isMuted />);
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeInTheDocument();
  });

  it('names the fullscreen button for what it will do', () => {
    const { rerender } = render(
      <VideoControls {...defaultProps} showFullscreenButton onFullscreenToggle={jest.fn()} isFullscreen={false} />
    );
    expect(screen.getByRole('button', { name: 'Enter full screen' })).toBeInTheDocument();

    rerender(
      <VideoControls {...defaultProps} showFullscreenButton onFullscreenToggle={jest.fn()} isFullscreen />
    );
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeInTheDocument();
  });

  it('names the skip, track and quality buttons', () => {
    render(
      <VideoControls
        {...defaultProps}
        {...tracks}
        showSkipPrevious
        showSkipNext
        onSkipPrevious={jest.fn()}
        onSkipNext={jest.fn()}
        qualityOptions={[
          { name: 'auto', label: 'Auto', bandwidth: 0 },
          { name: '720p', label: '720p', bandwidth: 5000 },
        ]}
      />
    );

    for (const name of [
      'Skip to previous',
      'Skip to next',
      'Select subtitle track',
      'Select audio track',
      'Select quality',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('names the mini player\'s own two buttons', () => {
    render(
      <VideoControls {...defaultProps} compact showExpandButton showCloseButton onClose={jest.fn()} />
    );

    expect(screen.getByRole('button', { name: 'Expand to full screen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close player' })).toBeInTheDocument();
  });
});
