import * as fs from 'fs';
import * as path from 'path';

/**
 * Runs before each test file's modules load. Points Prisma at a per-worker
 * copy of the migrated template database so test files in different workers
 * never share state. Tests that write to the database call `resetDatabase()`
 * from ./db.ts to start from empty tables.
 */
const workerId = process.env.JEST_WORKER_ID ?? '1';
const prismaDir = path.resolve(process.cwd(), 'prisma');
const template = path.join(prismaDir, 'test-template.db');
const workerDb = path.join(prismaDir, `test-worker-${workerId}.db`);

if (fs.existsSync(template) && !fs.existsSync(workerDb)) {
  fs.copyFileSync(template, workerDb);
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = `file:./prisma/test-worker-${workerId}.db`;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
