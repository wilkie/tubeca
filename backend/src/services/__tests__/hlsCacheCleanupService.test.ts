import { jest } from '@jest/globals';

const asyncMock = <T>() => jest.fn<(...args: unknown[]) => Promise<T>>();

const hlsService = {
  getCacheStats: asyncMock<{ totalSize: number; mediaCount: number; segmentCount: number }>(),
  cleanupOldSegments: asyncMock<number>(),
  enforceCacheSize: asyncMock<{ deleted: number }>(),
};
jest.unstable_mockModule('../hlsService', () => ({
  getHlsService: () => hlsService,
  HlsService: class {},
}));
jest.unstable_mockModule('../../config/appConfig', () => ({
  loadAppConfig: () => ({}),
  getHlsCacheConfig: () => ({ segmentTTLHours: 6, maxSizeGB: 20 }),
}));

const { hlsCacheCleanupService } = await import('../hlsCacheCleanupService');

const ONE_HOUR = 60 * 60 * 1000;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

beforeEach(() => {
  jest.clearAllMocks();
  hlsService.getCacheStats.mockResolvedValue({ totalSize: 0, mediaCount: 0, segmentCount: 0 });
  hlsService.cleanupOldSegments.mockResolvedValue(0);
  hlsService.enforceCacheSize.mockResolvedValue({ deleted: 0 });
  jest.useFakeTimers();
});

afterEach(() => {
  hlsCacheCleanupService.stop();
  jest.useRealTimers();
});

describe('HlsCacheCleanupService', () => {
  it('leaves the cache alone for the first half minute after boot', async () => {
    hlsCacheCleanupService.start();

    await jest.advanceTimersByTimeAsync(29000);

    expect(hlsService.cleanupOldSegments).not.toHaveBeenCalled();
  });

  it('sweeps once startup has settled, by age and then by size', async () => {
    hlsCacheCleanupService.start();

    await jest.advanceTimersByTimeAsync(30000);

    expect(hlsService.cleanupOldSegments).toHaveBeenCalledWith(6);
    expect(hlsService.enforceCacheSize).toHaveBeenCalledWith(20);
  });

  it('sweeps again every hour', async () => {
    hlsCacheCleanupService.start();

    await jest.advanceTimersByTimeAsync(30000 + ONE_HOUR * 3);

    expect(hlsService.cleanupOldSegments).toHaveBeenCalledTimes(4);
  });

  it('will not start a second time', async () => {
    hlsCacheCleanupService.start();
    hlsCacheCleanupService.start();

    await jest.advanceTimersByTimeAsync(30000 + ONE_HOUR);

    // One startup sweep and one hourly one, not two of each.
    expect(hlsService.cleanupOldSegments).toHaveBeenCalledTimes(2);
  });

  it('stops sweeping once stopped', async () => {
    hlsCacheCleanupService.start();
    await jest.advanceTimersByTimeAsync(30000);

    hlsCacheCleanupService.stop();
    await jest.advanceTimersByTimeAsync(ONE_HOUR * 5);

    expect(hlsService.cleanupOldSegments).toHaveBeenCalledTimes(1);
  });

  it('keeps sweeping after one sweep fails', async () => {
    hlsService.cleanupOldSegments.mockRejectedValueOnce(new Error('cache unreadable'));
    hlsCacheCleanupService.start();

    await jest.advanceTimersByTimeAsync(30000);
    await jest.advanceTimersByTimeAsync(ONE_HOUR);

    expect(hlsService.cleanupOldSegments).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      '❌ HLS cache cleanup failed:',
      expect.any(Error)
    );
  });

  it('reports the cache in megabytes alongside its expiry', async () => {
    hlsService.getCacheStats.mockResolvedValue({
      totalSize: 3 * 1024 * 1024,
      mediaCount: 2,
      segmentCount: 40,
    });

    expect(await hlsCacheCleanupService.getStats()).toEqual({
      totalSize: 3 * 1024 * 1024,
      totalSizeMB: '3.00',
      mediaCount: 2,
      segmentCount: 40,
      ttlHours: 6,
    });
  });
});
