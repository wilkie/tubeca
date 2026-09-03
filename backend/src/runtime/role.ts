/**
 * Which responsibilities this process takes on. One binary, selected by
 * `TUBECA_ROLE`, so a small install can run everything in one process while a
 * larger one separates the HTTP API from scanning, scraping and file watching.
 */
export type Role = 'api' | 'worker' | 'all';

export function parseRole(value: string | undefined): Role {
  const role = (value ?? '').trim().toLowerCase() || 'all';
  if (role === 'api' || role === 'worker' || role === 'all') return role;
  throw new Error(`TUBECA_ROLE must be "api", "worker" or "all" (got "${value}")`);
}

export function getRole(env: Record<string, string | undefined> = process.env): Role {
  return parseRole(env.TUBECA_ROLE);
}

export const runsApi = (role: Role): boolean => role !== 'worker';
export const runsWorkers = (role: Role): boolean => role !== 'api';
