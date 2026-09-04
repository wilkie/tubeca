import { jest } from '@jest/globals';

/** What ioredis was constructed with. */
let options: Record<string, unknown> = {};

jest.unstable_mockModule('ioredis', () => ({
  Redis: class {
    constructor(opts: Record<string, unknown>) {
      options = opts;
    }
    on() {
      return this;
    }
    quit() {
      return Promise.resolve();
    }
  },
}));

async function connectWith(env: Record<string, string | undefined>) {
  const before = { ...process.env };
  Object.assign(process.env, env);
  jest.resetModules();
  try {
    return await import('../redis');
  } finally {
    process.env = before;
  }
}

describe('the Redis connection', () => {
  it('uses database 0 by default', async () => {
    const { redisDb } = await connectWith({ REDIS_DB: undefined });

    expect(redisDb).toBe(0);
    expect(options.db).toBe(0);
  });

  it('keeps a second instance off the first one’s queues when told which database to use', async () => {
    const { redisDb } = await connectWith({ REDIS_DB: '3' });

    expect(redisDb).toBe(3);
    expect(options.db).toBe(3);
  });

  it('falls back to 0 rather than NaN for a value that is not a number', async () => {
    const { redisDb } = await connectWith({ REDIS_DB: 'main' });

    expect(redisDb).toBe(0);
  });

  it('takes the host and port from the environment', async () => {
    await connectWith({ REDIS_HOST: 'redis.internal', REDIS_PORT: '6380' });

    expect(options).toMatchObject({ host: 'redis.internal', port: 6380 });
  });
});
