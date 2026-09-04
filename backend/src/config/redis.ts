import { Redis } from 'ioredis';

/**
 * Which Redis database the queues live in.
 *
 * Queues are keyed by name, so a second instance pointed at the same Redis
 * shares them: a development or test server started beside a running one will
 * take jobs meant for it and write the results into whatever database it was
 * pointed at. `REDIS_DB` keeps those apart.
 */
export const redisDb = Number(process.env.REDIS_DB) || 0;

// Create Redis connection for BullMQ
// BullMQ requires maxRetriesPerRequest to be null
export const redisConnection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: redisDb,
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
  console.log(`✅ Redis ready${redisDb ? ` (database ${redisDb})` : ''}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await redisConnection.quit();
});

process.on('SIGINT', async () => {
  await redisConnection.quit();
  process.exit(0);
});
