import { renderHook, act, waitFor } from '@testing-library/react';
import { configure } from '@testing-library/react';
import { PlayerProvider, usePlayer } from '../PlayerContext';
import type { ReactNode } from 'react';
import { apiClient } from '../../api/client';

// PlayerContext uses useLayoutEffect to move video elements between containers
// via direct DOM manipulation. This causes issues during test cleanup because
// React tries to remove nodes from their original parent, but they've been moved.
// We disable auto-cleanup and handle cleanup manually to catch these errors.
configure({ reactStrictMode: false });

// Override the cleanup behavior for this test file
beforeAll(() => {
  // Store original removeChild
  const originalRemoveChild = Element.prototype.removeChild;

  // Override to handle the specific error case
  Element.prototype.removeChild = function<T extends Node>(child: T): T {
    try {
      return originalRemoveChild.call(this, child) as T;
    } catch (e) {
      if (e instanceof Error && e.message.includes('The node to be removed is not a child of this node')) {
        // Return the child without throwing
        return child;
      }
      throw e;
    }
  };
});

// Mock HLS.js
jest.mock('hls.js', () => {
  function MockHls(config?: Record<string, unknown>) {
    const handlers = new Map<string, (event: string, data: unknown) => void>();
    const instance = {
      loadSource: jest.fn(),
      attachMedia: jest.fn(),
      destroy: jest.fn(),
      // Record handlers so tests can drive MANIFEST_PARSED, ERROR and friends.
      on: jest.fn((event: string, handler: (event: string, data: unknown) => void) => {
        handlers.set(event, handler);
      }),
      emit: (event: string, data: unknown) => handlers.get(event)?.(event, data),
      startLoad: jest.fn(),
      recoverMediaError: jest.fn(),
      levels: [] as Array<{ height?: number; name?: string; bitrate: number }>,
      startLevel: -1,
      currentLevel: -1,
      bandwidthEstimate: 5000000,
    };
    const store = MockHls as unknown as {
      lastConfig?: Record<string, unknown>;
      lastInstance?: typeof instance;
    };
    store.lastConfig = config;
    store.lastInstance = instance;
    return instance;
  }
  MockHls.isSupported = () => true;
  MockHls.Events = {
    MANIFEST_PARSED: 'hlsManifestParsed',
    LEVEL_SWITCHING: 'hlsLevelSwitching',
    LEVEL_SWITCHED: 'hlsLevelSwitched',
    FRAG_BUFFERED: 'hlsFragBuffered',
    FRAG_LOADING: 'hlsFragLoading',
    BUFFER_FLUSHING: 'hlsBufferFlushing',
    ERROR: 'hlsError',
  };
  MockHls.ErrorTypes = {
    NETWORK_ERROR: 'networkError',
    MEDIA_ERROR: 'mediaError',
  };
  MockHls.ErrorDetails = {
    BUFFER_STALLED_ERROR: 'bufferStalledError',
    BUFFER_NUDGE_ON_STALL: 'bufferNudgeOnStall',
  };
  return { __esModule: true, default: MockHls };
});

// Mock the API client
jest.mock('../../api/client', () => ({
  apiClient: {
    getMedia: jest.fn(),
    getTrickplayInfo: jest.fn(),
    getHlsMasterPlaylistUrl: jest.fn(),
    getVideoStreamUrl: jest.fn(),
    getSubtitleUrl: jest.fn(),
    getImageUrl: jest.fn(),
    getWatchProgress: jest.fn(() => Promise.resolve({ data: { progress: null } })),
    getWatchProgressBatch: jest.fn(() => Promise.resolve({ data: { progress: {} } })),
    getPlaybackQueue: jest.fn(),
    getCollection: jest.fn(),
    getAudioStreamUrl: jest.fn(() => 'http://localhost/audio'),
    updateWatchProgress: jest.fn(() => Promise.resolve({ data: { progress: null } })),
    markWatched: jest.fn(() => Promise.resolve({ data: { progress: null } })),
  },
}));

// Mock MiniPlayer to avoid DOM manipulation issues
jest.mock('../../components/MiniPlayer', () => ({
  MiniPlayer: () => null,
}));

// Wrapper for renderHook
const wrapper = ({ children }: { children: ReactNode }) => (
  <PlayerProvider>{children}</PlayerProvider>
);

describe('PlayerContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  describe('initial state', () => {
    it('provides default state values', () => {
      const { result } = renderHook(() => usePlayer(), { wrapper });

      expect(result.current.currentMedia).toBeNull();
      expect(result.current.isPlaying).toBe(false);
      expect(result.current.currentTime).toBe(0);
      expect(result.current.duration).toBe(0);
      expect(result.current.volume).toBe(1);
      expect(result.current.isMuted).toBe(false);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.mode).toBe('hidden');
      expect(result.current.currentQuality).toBe('auto');
      expect(result.current.availableQualities).toEqual([]);
      expect(result.current.currentAudioTrack).toBeUndefined();
      expect(result.current.currentSubtitleTrack).toBeNull();
    });

    it('loads position from localStorage', () => {
      localStorage.setItem('tubeca_miniplayer_position', 'top-left');

      const { result } = renderHook(() => usePlayer(), { wrapper });

      expect(result.current.miniPlayerPosition).toBe('top-left');
    });

    it('defaults to bottom-right when localStorage is empty', () => {
      const { result } = renderHook(() => usePlayer(), { wrapper });

      expect(result.current.miniPlayerPosition).toBe('bottom-right');
    });

    it('defaults to bottom-right when localStorage has invalid value', () => {
      localStorage.setItem('tubeca_miniplayer_position', 'invalid-position');

      const { result } = renderHook(() => usePlayer(), { wrapper });

      expect(result.current.miniPlayerPosition).toBe('bottom-right');
    });

    it('handles all valid position values', () => {
      const positions = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

      for (const pos of positions) {
        localStorage.setItem('tubeca_miniplayer_position', pos);
        const { result } = renderHook(() => usePlayer(), { wrapper });
        expect(result.current.miniPlayerPosition).toBe(pos);
      }
    });
  });

  describe('usePlayer hook', () => {
    it('throws error when used outside of PlayerProvider', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => usePlayer());
      }).toThrow('usePlayer must be used within a PlayerProvider');

      consoleError.mockRestore();
    });
  });

  describe('seek', () => {
    it('updates currentTime', () => {
      const { result } = renderHook(() => usePlayer(), { wrapper });

      act(() => {
        result.current.seek(100);
      });

      expect(result.current.currentTime).toBe(100);
    });

    it('updates to different values', () => {
      const { result } = renderHook(() => usePlayer(), { wrapper });

      act(() => {
        result.current.seek(50);
      });

      expect(result.current.currentTime).toBe(50);

      act(() => {
        result.current.seek(200);
      });

      expect(result.current.currentTime).toBe(200);
    });
  });

  describe('volume controls', () => {
    it('setVolume updates volume state', () => {
      const { result } = renderHook(() => usePlayer(), { wrapper });

      act(() => {
        result.current.setVolume(0.5);
      });

      expect(result.current.volume).toBe(0.5);
    });

    it('setVolume to 0 sets isMuted', () => {
      const { result } = renderHook(() => usePlayer(), { wrapper });

      act(() => {
        result.current.setVolume(0);
      });

      expect(result.current.isMuted).toBe(true);
    });

    it('setVolume to non-zero does not set isMuted', () => {
      const { result } = renderHook(() => usePlayer(), { wrapper });

      act(() => {
        result.current.setVolume(0.75);
      });

      expect(result.current.isMuted).toBe(false);
      expect(result.current.volume).toBe(0.75);
    });

    it('setVolume handles edge values', () => {
      const { result } = renderHook(() => usePlayer(), { wrapper });

      act(() => {
        result.current.setVolume(1);
      });

      expect(result.current.volume).toBe(1);
      expect(result.current.isMuted).toBe(false);
    });
  });

  describe('position management', () => {
    it('setMiniPlayerPosition updates position', () => {
      const { result } = renderHook(() => usePlayer(), { wrapper });

      act(() => {
        result.current.setMiniPlayerPosition('top-left');
      });

      expect(result.current.miniPlayerPosition).toBe('top-left');
    });

    it('setMiniPlayerPosition saves to localStorage', () => {
      const { result } = renderHook(() => usePlayer(), { wrapper });

      act(() => {
        result.current.setMiniPlayerPosition('top-right');
      });

      expect(localStorage.getItem('tubeca_miniplayer_position')).toBe('top-right');
    });

    it('handles all positions', () => {
      const { result } = renderHook(() => usePlayer(), { wrapper });

      const positions = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

      for (const pos of positions) {
        act(() => {
          result.current.setMiniPlayerPosition(pos);
        });

        expect(result.current.miniPlayerPosition).toBe(pos);
        expect(localStorage.getItem('tubeca_miniplayer_position')).toBe(pos);
      }
    });
  });

  describe('mode management', () => {
    it('setMode updates mode', () => {
      const { result } = renderHook(() => usePlayer(), { wrapper });

      act(() => {
        result.current.setMode('mini');
      });

      expect(result.current.mode).toBe('mini');
    });

    it('handles all mode values', () => {
      const { result } = renderHook(() => usePlayer(), { wrapper });

      const modes = ['fullscreen', 'mini', 'hidden'] as const;

      for (const mode of modes) {
        act(() => {
          result.current.setMode(mode);
        });

        expect(result.current.mode).toBe(mode);
      }
    });
  });

  describe('subtitle track selection', () => {
    it('setSubtitleTrack updates current subtitle track', () => {
      const { result } = renderHook(() => usePlayer(), { wrapper });

      act(() => {
        result.current.setSubtitleTrack(2);
      });

      expect(result.current.currentSubtitleTrack).toBe(2);
    });

    it('setSubtitleTrack with null disables subtitles', () => {
      const { result } = renderHook(() => usePlayer(), { wrapper });

      act(() => {
        result.current.setSubtitleTrack(2);
      });

      act(() => {
        result.current.setSubtitleTrack(null);
      });

      expect(result.current.currentSubtitleTrack).toBeNull();
    });

    it('handles multiple track changes', () => {
      const { result } = renderHook(() => usePlayer(), { wrapper });

      act(() => {
        result.current.setSubtitleTrack(0);
      });
      expect(result.current.currentSubtitleTrack).toBe(0);

      act(() => {
        result.current.setSubtitleTrack(1);
      });
      expect(result.current.currentSubtitleTrack).toBe(1);

      act(() => {
        result.current.setSubtitleTrack(null);
      });
      expect(result.current.currentSubtitleTrack).toBeNull();
    });
  });

  describe('context functions exist', () => {
    it('provides all required state values', () => {
      const { result } = renderHook(() => usePlayer(), { wrapper });

      expect(result.current).toHaveProperty('currentMedia');
      expect(result.current).toHaveProperty('isPlaying');
      expect(result.current).toHaveProperty('currentTime');
      expect(result.current).toHaveProperty('duration');
      expect(result.current).toHaveProperty('volume');
      expect(result.current).toHaveProperty('isMuted');
      expect(result.current).toHaveProperty('isLoading');
      expect(result.current).toHaveProperty('currentAudioTrack');
      expect(result.current).toHaveProperty('currentSubtitleTrack');
      expect(result.current).toHaveProperty('currentQuality');
      expect(result.current).toHaveProperty('availableQualities');
      expect(result.current).toHaveProperty('mode');
      expect(result.current).toHaveProperty('miniPlayerPosition');
    });

    it('provides all required functions', () => {
      const { result } = renderHook(() => usePlayer(), { wrapper });

      expect(typeof result.current.playMedia).toBe('function');
      expect(typeof result.current.play).toBe('function');
      expect(typeof result.current.pause).toBe('function');
      expect(typeof result.current.togglePlay).toBe('function');
      expect(typeof result.current.seek).toBe('function');
      expect(typeof result.current.seekCommit).toBe('function');
      expect(typeof result.current.setVolume).toBe('function');
      expect(typeof result.current.toggleMute).toBe('function');
      expect(typeof result.current.setAudioTrack).toBe('function');
      expect(typeof result.current.setSubtitleTrack).toBe('function');
      expect(typeof result.current.setQuality).toBe('function');
      expect(typeof result.current.setMode).toBe('function');
      expect(typeof result.current.registerFullscreenContainer).toBe('function');
      expect(typeof result.current.registerMouseMoveHandler).toBe('function');
      expect(typeof result.current.registerPointerDownHandler).toBe('function');
      expect(typeof result.current.registerClickHandler).toBe('function');
      expect(typeof result.current.close).toBe('function');
      expect(typeof result.current.setMiniPlayerPosition).toBe('function');
    });
  });

  describe('handler registration', () => {
    it('registerMouseMoveHandler accepts handler', () => {
      const { result } = renderHook(() => usePlayer(), { wrapper });
      const handler = jest.fn();

      // Should not throw
      act(() => {
        result.current.registerMouseMoveHandler(handler);
      });

      act(() => {
        result.current.registerMouseMoveHandler(null);
      });

      expect(result.current.registerMouseMoveHandler).toBeDefined();
    });

    it('registerPointerDownHandler accepts handler', () => {
      const { result } = renderHook(() => usePlayer(), { wrapper });
      const handler = jest.fn();

      // Should not throw
      act(() => {
        result.current.registerPointerDownHandler(handler);
      });

      act(() => {
        result.current.registerPointerDownHandler(null);
      });

      expect(result.current.registerPointerDownHandler).toBeDefined();
    });

    it('registerClickHandler accepts handler', () => {
      const { result } = renderHook(() => usePlayer(), { wrapper });
      const handler = jest.fn();

      // Should not throw
      act(() => {
        result.current.registerClickHandler(handler);
      });

      act(() => {
        result.current.registerClickHandler(null);
      });

      expect(result.current.registerClickHandler).toBeDefined();
    });
  });

  describe('watch progress', () => {
    const mockApi = apiClient as jest.Mocked<typeof apiClient>;
    const media = {
      id: 'm1',
      name: 'Pilot',
      path: '/p.mkv',
      duration: 1200,
      type: 'Video',
      thumbnails: null,
      collectionId: null,
      videoDetails: null,
      audioDetails: null,
      streams: [],
      images: [],
      createdAt: '',
      updatedAt: '',
    };
    const lastHlsConfig = () =>
      (jest.requireMock('hls.js') as { default: { lastConfig?: Record<string, unknown> } }).default.lastConfig;

    beforeEach(() => {
      mockApi.getMedia.mockResolvedValue({ data: { media } } as never);
      mockApi.getTrickplayInfo.mockResolvedValue({ data: undefined } as never);
      mockApi.getHlsMasterPlaylistUrl.mockReturnValue('/hls/m1/master.m3u8');
    });

    describe('a report the server refuses', () => {
      /** Play, then move the clock so one report is sent. */
      async function playingAt(seconds: number) {
        mockApi.getWatchProgress.mockResolvedValue({ data: { progress: null } } as never);
        jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        const { result } = renderHook(() => usePlayer(), { wrapper });
        await act(async () => {
          await result.current.playMedia('m1');
        });
        const video = document.querySelector('video') as HTMLVideoElement;
        Object.defineProperty(video, 'currentTime', { value: seconds, configurable: true, writable: true });
        await act(async () => {
          video.dispatchEvent(new Event('timeupdate'));
        });
        return { result, video };
      }

      it('tries again, rather than losing the position', async () => {
        jest.useFakeTimers();
        try {
          mockApi.updateWatchProgress.mockResolvedValue({ error: 'Network error' } as never);
          await playingAt(300);
          expect(mockApi.updateWatchProgress).toHaveBeenCalledTimes(1);

          mockApi.updateWatchProgress.mockResolvedValue({ data: { progress: null } } as never);
          await act(async () => {
            await jest.advanceTimersByTimeAsync(5000);
          });

          expect(mockApi.updateWatchProgress).toHaveBeenCalledTimes(2);
          expect(mockApi.updateWatchProgress).toHaveBeenLastCalledWith(
            'm1',
            { position: 300, duration: 1200 }
          );
        } finally {
          jest.useRealTimers();
        }
      });

      it('backs off while the server keeps refusing', async () => {
        jest.useFakeTimers();
        try {
          mockApi.updateWatchProgress.mockResolvedValue({ error: 'Network error' } as never);
          await playingAt(300);

          await act(async () => {
            await jest.advanceTimersByTimeAsync(5000);
          });
          expect(mockApi.updateWatchProgress).toHaveBeenCalledTimes(2);

          // The next attempt is not for another five seconds, but ten.
          await act(async () => {
            await jest.advanceTimersByTimeAsync(5000);
          });
          expect(mockApi.updateWatchProgress).toHaveBeenCalledTimes(2);

          await act(async () => {
            await jest.advanceTimersByTimeAsync(5000);
          });
          expect(mockApi.updateWatchProgress).toHaveBeenCalledTimes(3);
        } finally {
          jest.useRealTimers();
        }
      });

      it('stops trying once one lands', async () => {
        jest.useFakeTimers();
        try {
          mockApi.updateWatchProgress.mockResolvedValue({ error: 'Network error' } as never);
          await playingAt(300);
          mockApi.updateWatchProgress.mockResolvedValue({ data: { progress: null } } as never);

          await act(async () => {
            await jest.advanceTimersByTimeAsync(5000);
          });
          const afterSuccess = mockApi.updateWatchProgress.mock.calls.length;

          await act(async () => {
            await jest.advanceTimersByTimeAsync(120000);
          });

          expect(mockApi.updateWatchProgress).toHaveBeenCalledTimes(afterSuccess);
        } finally {
          jest.useRealTimers();
        }
      });

      it('does not retry a report sent as the page goes away', async () => {
        jest.useFakeTimers();
        try {
          // A clean start: nothing pending, so anything that fires afterwards
          // came from the keepalive report itself.
          mockApi.updateWatchProgress.mockResolvedValue({ data: { progress: null } } as never);
          await playingAt(300);
          mockApi.updateWatchProgress.mockResolvedValue({ error: 'Network error' } as never);
          mockApi.updateWatchProgress.mockClear();

          await act(async () => {
            window.dispatchEvent(new Event('pagehide'));
          });
          expect(mockApi.updateWatchProgress).toHaveBeenCalledTimes(1);

          // The page is going: there is nothing left to retry with.
          await act(async () => {
            await jest.advanceTimersByTimeAsync(120000);
          });

          expect(mockApi.updateWatchProgress).toHaveBeenCalledTimes(1);
        } finally {
          jest.useRealTimers();
        }
      });
    });

    it('starts from the saved position when one is worth resuming', async () => {
      mockApi.getWatchProgress.mockResolvedValue({
        data: { progress: { id: 'p', userId: 'u', mediaId: 'm1', position: 600, duration: 1200, completed: false, createdAt: '', updatedAt: '' } },
      } as never);
      const { result } = renderHook(() => usePlayer(), { wrapper });

      await act(async () => {
        await result.current.playMedia('m1');
      });

      expect(mockApi.getWatchProgress).toHaveBeenCalledWith('m1');
      expect(lastHlsConfig()?.startPosition).toBe(600);
      expect(result.current.currentTime).toBe(600);
    });

    it.each([
      ['completed', { position: 600, completed: true }],
      ['barely started', { position: 10, completed: false }],
      ['at the tail', { position: 1195, completed: false }],
    ])('starts over when the saved position is %s', async (_label, partial) => {
      mockApi.getWatchProgress.mockResolvedValue({
        data: { progress: { id: 'p', userId: 'u', mediaId: 'm1', duration: 1200, createdAt: '', updatedAt: '', ...partial } },
      } as never);
      const { result } = renderHook(() => usePlayer(), { wrapper });

      await act(async () => {
        await result.current.playMedia('m1');
      });

      expect(lastHlsConfig()?.startPosition).toBe(0);
    });

    it('reports the position on pause and marks watched on ended', async () => {
      mockApi.getWatchProgress.mockResolvedValue({ data: { progress: null } } as never);
      const { result } = renderHook(() => usePlayer(), { wrapper });
      await act(async () => {
        await result.current.playMedia('m1');
      });

      const video = document.querySelector('video') as HTMLVideoElement;
      Object.defineProperty(video, 'currentTime', { value: 123.7, configurable: true, writable: true });

      act(() => {
        video.dispatchEvent(new Event('pause'));
      });
      expect(mockApi.updateWatchProgress).toHaveBeenCalledWith('m1', { position: 123, duration: 1200 }, { keepalive: false });

      act(() => {
        video.dispatchEvent(new Event('ended'));
      });
      expect(mockApi.markWatched).toHaveBeenCalledWith('m1');
    });
  });

  describe('quality preference and error recovery', () => {
    const mockApi = apiClient as jest.Mocked<typeof apiClient>;
    const media = {
      id: 'm1', name: 'Pilot', path: '/p.mkv', duration: 1200, type: 'Video',
      thumbnails: null, collectionId: null, videoDetails: null, audioDetails: null,
      streams: [], images: [], createdAt: '', updatedAt: '',
    };
    const hlsModule = () =>
      (jest.requireMock('hls.js') as {
        default: {
          lastConfig?: Record<string, unknown>;
          lastInstance?: {
            emit: (event: string, data: unknown) => void;
            startLoad: jest.Mock;
            destroy: jest.Mock;
            recoverMediaError: jest.Mock;
            startLevel: number;
            levels: Array<{ height?: number; bitrate: number }>;
            currentLevel: number;
          };
          Events: Record<string, string>;
          ErrorTypes: Record<string, string>;
        };
      }).default;

    const ladder = [
      { height: 360, bitrate: 1_000_000 },
      { height: 720, bitrate: 4_000_000 },
      { height: 1080, bitrate: 8_000_000 },
    ];

    async function start() {
      const { result } = renderHook(() => usePlayer(), { wrapper });
      await act(async () => {
        await result.current.playMedia('m1');
      });
      return result;
    }

    beforeEach(() => {
      // jsdom has no media playback; the manifest handler calls play().
      jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
      mockApi.getMedia.mockResolvedValue({ data: { media } } as never);
      mockApi.getTrickplayInfo.mockResolvedValue({ data: undefined } as never);
      mockApi.getWatchProgress.mockResolvedValue({ data: { progress: null } } as never);
      mockApi.getHlsMasterPlaylistUrl.mockReturnValue('/hls/m1/master.m3u8');
    });

    it('waits for the manifest before loading, then starts at the remembered height', async () => {
      localStorage.setItem('tubeca_last_quality_height', '720');
      await start();
      const hls = hlsModule().lastInstance!;

      expect(hlsModule().lastConfig?.autoStartLoad).toBe(false);
      expect(hls.startLoad).not.toHaveBeenCalled();

      hls.levels = ladder;
      act(() => {
        hls.emit(hlsModule().Events.MANIFEST_PARSED, { levels: ladder });
      });

      expect(hls.startLevel).toBe(1); // the 720p rung
      expect(hls.startLoad).toHaveBeenCalled();
    });

    it('drops to the best rung below the remembered height when it is missing', async () => {
      localStorage.setItem('tubeca_last_quality_height', '900');
      await start();
      const hls = hlsModule().lastInstance!;
      act(() => {
        hls.emit(hlsModule().Events.MANIFEST_PARSED, { levels: ladder });
      });
      expect(hls.startLevel).toBe(1); // 720p, not 1080p
    });

    it('recovers a few times, then reports the failure instead of retrying for ever', async () => {
      // This path logs deliberately; the shared setup turns console.error into a failure.
      const originalError = console.error;
      console.error = () => {};
      try {
      const result = await start();
      const hls = hlsModule().lastInstance!;
      const fatal = { fatal: true, type: hlsModule().ErrorTypes.NETWORK_ERROR, details: 'x' };

      for (let i = 0; i < 3; i++) {
        act(() => {
          hls.emit(hlsModule().Events.ERROR, fatal);
        });
      }
      expect(hls.startLoad).toHaveBeenCalledTimes(3);
      expect(result.current.error).toBeNull();

      act(() => {
        hls.emit(hlsModule().Events.ERROR, fatal);
      });
      expect(hls.startLoad).toHaveBeenCalledTimes(3);
      expect(hls.destroy).toHaveBeenCalled();
      expect(result.current.error).toBe('playback.errorNetwork');
      expect(result.current.isLoading).toBe(false);
      } finally {
        console.error = originalError;
      }
    });

    it('flushes the position with keepalive when the page is hidden', async () => {
      await start();
      const video = document.querySelector('video') as HTMLVideoElement;
      Object.defineProperty(video, 'currentTime', { value: 42, configurable: true, writable: true });
      act(() => {
        video.dispatchEvent(new Event('timeupdate'));
      });
      mockApi.updateWatchProgress.mockClear();

      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });

      expect(mockApi.updateWatchProgress).toHaveBeenCalledWith(
        'm1',
        { position: 42, duration: 1200 },
        { keepalive: true }
      );
    });
  });

  describe('a browser without hls.js', () => {
    const mockApi = apiClient as jest.Mocked<typeof apiClient>;
    /** The mocked hls.js module, whose isSupported these tests turn off. */
    const hls = (jest.requireMock('hls.js') as { default: { isSupported: () => boolean } }).default;

    beforeEach(() => {
      jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
      mockApi.getMedia.mockResolvedValue({
        data: { media: { id: 'm1', name: 'Heat', duration: 1200, type: 'Video', streams: [] } },
      } as never);
      mockApi.getTrickplayInfo.mockResolvedValue({ data: undefined } as never);
      mockApi.getWatchProgress.mockResolvedValue({ data: { progress: null } } as never);
      mockApi.getHlsMasterPlaylistUrl.mockReturnValue('/hls/m1/master.m3u8?token=t');
      hls.isSupported = () => false;
    });

    afterEach(() => {
      hls.isSupported = () => true;
    });

    it('hands the playlist to a browser that plays HLS itself', async () => {
      jest
        .spyOn(HTMLMediaElement.prototype, 'canPlayType')
        .mockImplementation((type: string) =>
          type === 'application/vnd.apple.mpegurl' ? 'maybe' : ''
        );
      const { result } = renderHook(() => usePlayer(), { wrapper });

      await act(async () => {
        await result.current.playMedia('m1');
      });

      expect(document.querySelector('video')!.src).toContain('master.m3u8?token=t');
      expect(result.current.error).toBeNull();
    });

    it('says so when the playlist will not load, rather than staying black', async () => {
      jest
        .spyOn(HTMLMediaElement.prototype, 'canPlayType')
        .mockImplementation((type: string) =>
          type === 'application/vnd.apple.mpegurl' ? 'maybe' : ''
        );
      const { result } = renderHook(() => usePlayer(), { wrapper });
      await act(async () => {
        await result.current.playMedia('m1');
      });

      await act(async () => {
        document.querySelector('video')!.dispatchEvent(new Event('error'));
      });

      expect(result.current.error).toBe('playback.errorLoad');
    });

    it('says so when the browser cannot play HLS at all', async () => {
      jest.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
      const { result } = renderHook(() => usePlayer(), { wrapper });

      await act(async () => {
        await result.current.playMedia('m1');
      });

      expect(result.current.error).toBe('playback.errorUnsupported');
    });
  });

  describe('the queue', () => {
    const mockApi = apiClient as jest.Mocked<typeof apiClient>;

    const episode = (id: string, episodeNumber: number, collectionId = 'season-1') => ({
      id,
      name: `Episode ${episodeNumber}`,
      duration: 1200,
      type: 'Video' as const,
      streams: [],
      collectionId,
      videoDetails: { season: 1, episode: episodeNumber },
    });

    const queueItem = (id: string, mediaId: string, episodeNumber: number) => ({
      id,
      position: episodeNumber,
      media: { ...episode(mediaId, episodeNumber) },
    });

    const library: Record<string, ReturnType<typeof episode>> = {
      'm1': episode('m1', 1),
      'm2': episode('m2', 2),
      'm3': episode('m3', 3),
    };

    beforeEach(() => {
      jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
      mockApi.getMedia.mockImplementation(
        async (id: string) => ({ data: { media: library[id] } }) as never
      );
      mockApi.getTrickplayInfo.mockResolvedValue({ data: undefined } as never);
      mockApi.getWatchProgress.mockResolvedValue({ data: { progress: null } } as never);
      mockApi.getWatchProgressBatch.mockResolvedValue({ data: { progress: {} } } as never);
      mockApi.getHlsMasterPlaylistUrl.mockReturnValue('/hls/master.m3u8');
      mockApi.getPlaybackQueue.mockResolvedValue({
        data: {
          userCollection: {
            items: [queueItem('q1', 'm1', 1), queueItem('q2', 'm2', 2), queueItem('q3', 'm3', 3)],
          },
        },
      } as never);
      mockApi.getCollection.mockResolvedValue({ data: { collection: null } } as never);
    });

    /** A player with the queue loaded and one of its items playing. */
    async function playing(mediaId: string) {
      const { result } = renderHook(() => usePlayer(), { wrapper });
      await act(async () => {
        await result.current.refreshQueue();
      });
      await act(async () => {
        await result.current.playMedia(mediaId);
      });
      return result;
    }

    it('loads the queue', async () => {
      const result = await playing('m2');

      expect(result.current.queue.map((item) => item.id)).toEqual(['q1', 'q2', 'q3']);
    });

    it('keeps an empty queue when the request fails', async () => {
      mockApi.getPlaybackQueue.mockResolvedValue({ error: 'Nope' } as never);
      const { result } = renderHook(() => usePlayer(), { wrapper });

      await act(async () => {
        await result.current.refreshQueue();
      });

      expect(result.current.queue).toEqual([]);
    });

    it('knows where in the queue it is', async () => {
      const result = await playing('m2');

      await waitFor(() => expect(result.current.queueIndex).toBe(1));
    });

    it('offers the item on either side', async () => {
      const result = await playing('m2');

      await waitFor(() => expect(result.current.nextItem).toMatchObject({ id: 'm3', type: 'queue' }));
      expect(result.current.previousItem).toMatchObject({ id: 'm1', type: 'queue' });
      expect(result.current.hasNextItem()).toBe(true);
      expect(result.current.hasPreviousItem()).toBe(true);
    });

    it('offers nothing before the first item', async () => {
      const result = await playing('m1');

      await waitFor(() => expect(result.current.nextItem).toMatchObject({ id: 'm2' }));
      expect(result.current.previousItem).toBeNull();
      expect(result.current.hasPreviousItem()).toBe(false);
    });

    it('plays the next item', async () => {
      const result = await playing('m2');
      await waitFor(() => expect(result.current.nextItem).not.toBeNull());

      await act(async () => {
        await result.current.playNext();
      });

      expect(result.current.currentMedia?.id).toBe('m3');
    });

    it('plays the previous item', async () => {
      const result = await playing('m2');
      await waitFor(() => expect(result.current.previousItem).not.toBeNull());

      await act(async () => {
        await result.current.playPrevious();
      });

      expect(result.current.currentMedia?.id).toBe('m1');
    });

    it('stays where it is when there is nowhere to go', async () => {
      mockApi.getPlaybackQueue.mockResolvedValue({
        data: { userCollection: { items: [queueItem('q1', 'm1', 1)] } },
      } as never);
      const result = await playing('m1');
      await waitFor(() => expect(result.current.queueIndex).toBe(0));

      await act(async () => {
        await result.current.playNext();
        await result.current.playPrevious();
      });

      expect(result.current.currentMedia?.id).toBe('m1');
    });

    it('plays the next item by itself when one ends', async () => {
      const result = await playing('m2');
      await waitFor(() => expect(result.current.nextItem).toMatchObject({ id: 'm3' }));

      await act(async () => {
        document.querySelector('video')!.dispatchEvent(new Event('ended'));
      });

      await waitFor(() => expect(result.current.currentMedia?.id).toBe('m3'));
    });

    describe('past the end of the queue', () => {
      beforeEach(() => {
        mockApi.getPlaybackQueue.mockResolvedValue({
          data: { userCollection: { items: [] } },
        } as never);
      });

      it('offers the next unwatched episode of the season', async () => {
        mockApi.getCollection.mockResolvedValue({
          data: {
            collection: {
              id: 'season-1',
              parentId: 'show-1',
              media: [episode('m3', 3), episode('m1', 1), episode('m2', 2)],
            },
          },
        } as never);
        mockApi.getWatchProgressBatch.mockResolvedValue({
          data: { progress: { m2: { completed: true } } },
        } as never);

        const result = await playing('m1');

        await waitFor(() =>
          expect(result.current.nextItem).toMatchObject({ id: 'm3', type: 'episode' })
        );
      });

      it('falls back to the very next episode when the rest is watched', async () => {
        mockApi.getCollection.mockResolvedValue({
          data: {
            collection: { id: 'season-1', parentId: 'show-1', media: [episode('m1', 1), episode('m2', 2)] },
          },
        } as never);
        mockApi.getWatchProgressBatch.mockResolvedValue({
          data: { progress: { m2: { completed: true } } },
        } as never);

        const result = await playing('m1');

        await waitFor(() => expect(result.current.nextItem).toMatchObject({ id: 'm2' }));
      });

      it('crosses into the next season after the last episode', async () => {
        mockApi.getCollection.mockImplementation(async (id: string) => {
          if (id === 'season-1') {
            return {
              data: { collection: { id: 'season-1', parentId: 'show-1', media: [episode('m1', 1)] } },
            } as never;
          }
          if (id === 'show-1') {
            return {
              data: {
                collection: {
                  id: 'show-1',
                  children: [
                    { id: 'season-2', name: 'Season 2' },
                    { id: 'season-1', name: 'Season 1' },
                  ],
                },
              },
            } as never;
          }
          return {
            data: {
              collection: {
                id: 'season-2',
                seasonDetails: { seasonNumber: 2 },
                media: [
                  { ...episode('m9', 2, 'season-2'), name: 'Second' },
                  { ...episode('m8', 1, 'season-2'), name: 'First' },
                ],
              },
            },
          } as never;
        });

        const result = await playing('m1');

        await waitFor(() =>
          expect(result.current.nextItem).toMatchObject({
            id: 'm8',
            type: 'episode',
            seasonNumber: 2,
            episodeNumber: 1,
          })
        );
      });

      it('offers nothing after the last episode of the last season', async () => {
        mockApi.getCollection.mockImplementation(async (id: string) =>
          (id === 'season-1'
            ? { data: { collection: { id: 'season-1', parentId: 'show-1', media: [episode('m1', 1)] } } }
            : { data: { collection: { id: 'show-1', children: [{ id: 'season-1', name: 'Season 1' }] } } }) as never
        );

        const result = await playing('m1');

        await waitFor(() => expect(result.current.hasNextItem()).toBe(false));
      });

      it('offers nothing for a film', async () => {
        library.film = {
          id: 'film',
          name: 'Heat',
          duration: 10200,
          type: 'Video',
          streams: [],
          collectionId: 'col-heat',
          videoDetails: undefined as never,
        };

        const result = await playing('film');

        await waitFor(() => expect(result.current.currentMedia?.id).toBe('film'));
        expect(result.current.nextItem).toBeNull();
        expect(mockApi.getCollection).not.toHaveBeenCalled();
      });
    });
  });
});
