import * as fs from 'fs';
import * as path from 'path';
import express, { type Express } from 'express';
import { getRepoRoot } from '../config/appConfig';

/**
 * Where the built SPA lives. `FRONTEND_DIST` overrides; the default is the
 * workspace build output so `pnpm build && pnpm start` serves everything on one port.
 */
export function resolveFrontendDist(env: Record<string, string | undefined> = process.env): string {
  return env.FRONTEND_DIST ?? path.join(getRepoRoot(), 'frontend', 'ui', 'dist');
}

/**
 * Serve the SPA from the API process: hashed assets with long cache lifetimes,
 * `index.html` uncached, and a history-API fallback for every GET that is not
 * an API call and does not look like a file. Returns false (and mounts
 * nothing) when the build output is missing, so a backend-only deployment
 * behind nginx keeps working unchanged.
 */
export function mountFrontend(app: Express, distDir: string): boolean {
  const indexHtml = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexHtml)) return false;

  app.use(
    express.static(distDir, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api')) return next();
    if (path.extname(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });

  return true;
}
