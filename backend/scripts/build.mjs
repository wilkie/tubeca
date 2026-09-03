// Bundle the backend into a single ESM file that plain `node` can run.
// tsc alone emits extensionless relative imports, which Node's ESM loader
// rejects; bundling side-steps that while keeping node_modules external so
// Prisma's generated client and native modules (sharp, libsql) load normally.
import { build } from 'esbuild';
import { rmSync } from 'fs';

rmSync('dist', { recursive: true, force: true });

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  outfile: 'dist/index.js',
  logLevel: 'info',
  // Bundled CJS-style dependencies sometimes expect `require`; give them one.
  banner: {
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
});
