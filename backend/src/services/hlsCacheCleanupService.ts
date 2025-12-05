import { HlsService } from './hlsService';
import { getHlsCacheConfig, loadAppConfig } from '../config/appConfig';

/**
 * Service that periodically cleans up old HLS segments from the cache
 */
class HlsCacheCleanupService {
  private hlsService: HlsService;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private ttlHours: number;
  private intervalMs: number;

  constructor() {
    this.hlsService = new HlsService();
    const appConfig = loadAppConfig();
    const hlsConfig = getHlsCacheConfig(appConfig);
    this.ttlHours = hlsConfig.segmentTTLHours;
    // Run cleanup every hour by default
    this.intervalMs = 60 * 60 * 1000;
  }

  /**
   * Start the periodic cleanup job
   */
  start(): void {
    if (this.cleanupInterval) {
      console.log('⚠️ HLS cache cleanup service is already running');
      return;
    }

    console.log(`🧹 Starting HLS cache cleanup service (TTL: ${this.ttlHours} hours)`);

    // Run initial cleanup after a short delay
    setTimeout(() => {
      this.runCleanup();
    }, 30000); // 30 seconds after startup

    // Schedule periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.runCleanup();
    }, this.intervalMs);
  }

  /**
   * Stop the cleanup job
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('🛑 HLS cache cleanup service stopped');
    }
  }

  /**
   * Run a single cleanup cycle
   */
  private async runCleanup(): Promise<void> {
    try {
      // Get stats before cleanup
      const statsBefore = await this.hlsService.getCacheStats();

      // Run cleanup
      const deletedCount = await this.hlsService.cleanupOldSegments(this.ttlHours);

      if (deletedCount > 0) {
        // Get stats after cleanup
        const statsAfter = await this.hlsService.getCacheStats();
        const freedBytes = statsBefore.totalSize - statsAfter.totalSize;
        const freedMB = (freedBytes / (1024 * 1024)).toFixed(2);

        console.log(
          `🧹 HLS cache cleanup: deleted ${deletedCount} old segments, freed ${freedMB} MB`
        );
      }
    } catch (error) {
      console.error('❌ HLS cache cleanup failed:', error);
    }
  }

  /**
   * Get current cache statistics
   */
  async getStats(): Promise<{
    totalSize: number;
    totalSizeMB: string;
    mediaCount: number;
    segmentCount: number;
    ttlHours: number;
  }> {
    const stats = await this.hlsService.getCacheStats();
    return {
      ...stats,
      totalSizeMB: (stats.totalSize / (1024 * 1024)).toFixed(2),
      ttlHours: this.ttlHours,
    };
  }
}

export const hlsCacheCleanupService = new HlsCacheCleanupService();
