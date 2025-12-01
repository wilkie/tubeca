import { Redis } from 'ioredis';

// Create Redis connection for BullMQ
// BullMQ requires maxRetriesPerRequest to be null
export const redisConnection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Handle connection events
redisConnection.on('connect', () => {
  console.log('✅ Redis connected');
});

redisConnection.on('error', (error) => {
  console.error('❌ Redis connection error:', error);
});

redisConnection.on('ready', () => {
  console.log('✅ Redis ready');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await redisConnection.quit();
});

process.on('SIGINT', async () => {
  await redisConnection.quit();
  process.exit(0);
});
