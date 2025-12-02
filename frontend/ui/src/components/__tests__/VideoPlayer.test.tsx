import { render, screen, fireEvent } from '../../test-utils';
import { VideoPlayer } from '../VideoPlayer';
import type { TrickplayResolution } from '../../api/client';

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    getTrickplaySpriteUrl: jest.fn((mediaId: string, width: number, index: number) =>
      `http://localhost/api/stream/trickplay/${mediaId}/${width}/${index}`
    ),
  },
}));

// Mock getBoundingClientRect for the slider element
const mockSliderWidth = 800;
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

describe('VideoPlayer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock getBoundingClientRect to return predictable values
    Element.prototype.getBoundingClientRect = jest.fn().mockReturnValue({
      width: mockSliderWidth,
      height: 20,
      top: 0,
      left: 0,
      right: mockSliderWidth,
      bottom: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  const defaultProps = {
    src: 'http://localhost/video.mp4',
    mediaDuration: 3600,
  };

  const trickplayData: TrickplayResolution = {
    width: 320,
    tileWidth: 160,
    tileHeight: 90,
    columns: 5,
    rows: 5,
    tileCount: 25,
    interval: 10,
    spriteCount: 10,
  };

  // Helper to find the slider container element that has onMouseMove handler
  const findSliderContainer = (): HTMLElement | null => {
    // The slider container is the Box that wraps the Slider and has position: relative
    const slider = document.querySelector('.MuiSlider-root');
    return slider?.parentElement as HTMLElement | null;
  };

  describe('trickplay preview', () => {
    it('shows trickplay preview on slider hover', () => {
      render(
        <VideoPlayer
          {...defaultProps}
          trickplay={trickplayData}
          mediaId="media-123"
        />
      );

      const sliderContainer = findSliderContainer();
      expect(sliderContainer).toBeTruthy();

      // Simulate mouse move over the slider
      fireEvent.mouseMove(sliderContainer!, { clientX: 400 });

      // The preview should be visible - check for the time display
      // At 400px on an 800px slider = 50% = 1800 seconds = "30:00"
      expect(screen.getByText('30:00')).toBeInTheDocument();
    });

    it('hides trickplay preview when mouse leaves slider', () => {
      render(
        <VideoPlayer
          {...defaultProps}
          trickplay={trickplayData}
          mediaId="media-123"
        />
      );

      const sliderContainer = findSliderContainer();

      // Show preview
      fireEvent.mouseMove(sliderContainer!, { clientX: 400 });
      expect(screen.getByText('30:00')).toBeInTheDocument();

      // Hide preview
      fireEvent.mouseLeave(sliderContainer!);
      expect(screen.queryByText('30:00')).not.toBeInTheDocument();
    });

    describe('preview position clamping', () => {
      // Helper to get the preview element's left position from data attribute
      const getPreviewPosition = (): number | null => {
        const preview = screen.queryByTestId('trickplay-preview');
        if (!preview) return null;
        const x = preview.getAttribute('data-preview-x');
        return x ? parseFloat(x) : null;
      };

      it('clamps preview position at the left edge', () => {
        render(
          <VideoPlayer
            {...defaultProps}
            trickplay={trickplayData}
            mediaId="media-123"
          />
        );

        const sliderContainer = findSliderContainer();

        // Mouse at x=0 (left edge)
        // Preview width is 160px, so halfWidth = 80px
        // Clamped position should be 80 (not 0)
        // Time at 0% = 0 seconds = "0:00"
        fireEvent.mouseMove(sliderContainer!, { clientX: 0 });

        const position = getPreviewPosition();
        expect(position).toBe(80); // halfWidth of preview
      });

      it('clamps preview position at the right edge', () => {
        render(
          <VideoPlayer
            {...defaultProps}
            trickplay={trickplayData}
            mediaId="media-123"
          />
        );

        const sliderContainer = findSliderContainer();

        // Mouse at x=800 (right edge)
        // Slider width = 800, preview width = 160, halfWidth = 80
        // Clamped position should be 800 - 80 = 720
        fireEvent.mouseMove(sliderContainer!, { clientX: mockSliderWidth });

        const position = getPreviewPosition();
        expect(position).toBe(mockSliderWidth - 80); // sliderWidth - halfWidth
      });

      it('does not clamp preview position in the center', () => {
        render(
          <VideoPlayer
            {...defaultProps}
            trickplay={trickplayData}
            mediaId="media-123"
          />
        );

        const sliderContainer = findSliderContainer();

        // Mouse at center (x=400)
        // This is within bounds, so position should be exactly 400
        fireEvent.mouseMove(sliderContainer!, { clientX: 400 });

        const position = getPreviewPosition();
        expect(position).toBe(400);
      });

      it('clamps near left edge but not exactly at zero', () => {
        render(
          <VideoPlayer
            {...defaultProps}
            trickplay={trickplayData}
            mediaId="media-123"
          />
        );

        const sliderContainer = findSliderContainer();

        // Mouse at x=50, which is less than halfWidth (80)
        // Should be clamped to 80
        fireEvent.mouseMove(sliderContainer!, { clientX: 50 });

        const position = getPreviewPosition();
        expect(position).toBe(80);
      });

      it('clamps near right edge but not exactly at max', () => {
        render(
          <VideoPlayer
            {...defaultProps}
            trickplay={trickplayData}
            mediaId="media-123"
          />
        );

        const sliderContainer = findSliderContainer();

        // Mouse at x=750, which is greater than sliderWidth - halfWidth (720)
        // Should be clamped to 720
        fireEvent.mouseMove(sliderContainer!, { clientX: 750 });

        const position = getPreviewPosition();
        expect(position).toBe(720);
      });

      it('allows position just inside left boundary', () => {
        render(
          <VideoPlayer
            {...defaultProps}
            trickplay={trickplayData}
            mediaId="media-123"
          />
        );

        const sliderContainer = findSliderContainer();

        // Mouse at x=100, which is greater than halfWidth (80)
        // Should not be clamped
        fireEvent.mouseMove(sliderContainer!, { clientX: 100 });

        const position = getPreviewPosition();
        expect(position).toBe(100);
      });

      it('allows position just inside right boundary', () => {
        render(
          <VideoPlayer
            {...defaultProps}
            trickplay={trickplayData}
            mediaId="media-123"
          />
        );

        const sliderContainer = findSliderContainer();

        // Mouse at x=700, which is less than sliderWidth - halfWidth (720)
        // Should not be clamped
        fireEvent.mouseMove(sliderContainer!, { clientX: 700 });

        const position = getPreviewPosition();
        expect(position).toBe(700);
      });
    });
  });

  describe('basic rendering', () => {
    it('renders video element', () => {
      render(<VideoPlayer {...defaultProps} />);

      const video = document.querySelector('video');
      expect(video).toBeInTheDocument();
      expect(video).toHaveAttribute('src', defaultProps.src);
    });

    it('renders play/pause button', () => {
      render(<VideoPlayer {...defaultProps} />);

      // Look for the PlayArrow icon's test id
      expect(screen.getByTestId('PlayArrowIcon')).toBeInTheDocument();
    });

    it('renders fullscreen button', () => {
      render(<VideoPlayer {...defaultProps} />);

      // Look for the Fullscreen icon's test id
      expect(screen.getByTestId('FullscreenIcon')).toBeInTheDocument();
    });

    it('renders title when provided', () => {
      render(<VideoPlayer {...defaultProps} title="Test Video" />);

      expect(screen.getByText('Test Video')).toBeInTheDocument();
    });
  });

  describe('without trickplay', () => {
    it('does not show preview when trickplay is not provided', () => {
      render(<VideoPlayer {...defaultProps} />);

      const sliderContainer = findSliderContainer();
      fireEvent.mouseMove(sliderContainer!, { clientX: 400 });

      // Should not show any time preview since trickplay is not available
      // Look for any element with bottom: 20px style (the preview container)
      const allElements = document.querySelectorAll('*');
      let foundPreview = false;
      for (const el of allElements) {
        const htmlEl = el as HTMLElement;
        if (htmlEl.style && htmlEl.style.bottom === '20px') {
          foundPreview = true;
          break;
        }
      }
      expect(foundPreview).toBe(false);
    });

    it('does not show preview when mediaId is not provided', () => {
      render(
        <VideoPlayer
          {...defaultProps}
          trickplay={trickplayData}
          // mediaId not provided
        />
      );

      const sliderContainer = findSliderContainer();
      fireEvent.mouseMove(sliderContainer!, { clientX: 400 });

      // Should not show preview without mediaId
      const allElements = document.querySelectorAll('*');
      let foundPreview = false;
      for (const el of allElements) {
        const htmlEl = el as HTMLElement;
        if (htmlEl.style && htmlEl.style.bottom === '20px') {
          foundPreview = true;
          break;
        }
      }
      expect(foundPreview).toBe(false);
    });
  });
});
