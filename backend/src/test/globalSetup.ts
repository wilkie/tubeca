import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Jest global setup: build one migrated SQLite template database that each
 * worker copies (see setupEnv.ts). Runs once per `pnpm test` invocation from
 * the backend directory.
 */
export default async function globalSetup(): Promise<void> {
  const prismaDir = path.resolve(process.cwd(), 'prisma');

  for (const file of fs.readdirSync(prismaDir)) {
    if (/^test-.*\.db(-journal|-wal|-shm)?$/.test(file)) {
      fs.rmSync(path.join(prismaDir, file), { force: true });
    }
  }

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: 'file:./prisma/test-template.db' },
    stdio: 'pipe',
  });
}
