# Tubeca

A self-hosted media streaming platform for managing and streaming personal media libraries (TV shows, films, music).

## Project Structure

```
tubeca/
├── backend/           # Express.js API server
├── frontend/ui/       # React frontend (Vite + MUI)
├── packages/
│   ├── shared-types/  # Shared TypeScript types between frontend/backend
│   └── scraper-types/ # Types for scraper plugins
└── scrapers/          # Metadata scraper plugins (tmdb, tvdb)
```

## Tech Stack

- **Monorepo**: pnpm workspaces + Turborepo
- **Backend**: Express.js, Prisma (SQLite), BullMQ (Redis), JWT auth
- **Frontend**: React 19, Vite, MUI 7, react-router-dom, i18next
- **Shared**: TypeScript throughout

## Common Commands

```bash
# Development (from root)
pnpm dev              # Start all services (turbo)
pnpm build            # Build all packages
pnpm lint             # Lint all packages
pnpm test             # Run tests in all packages

# Run commands in specific workspace
pnpm --filter @tubeca/backend <command>
pnpm --filter @tubeca/ui <command>
```

## Package-Specific Documentation

Each package has its own CLAUDE.md with detailed patterns and conventions:
- `backend/CLAUDE.md` - Backend-specific patterns, routes, services, workers
- `frontend/ui/CLAUDE.md` - Frontend-specific patterns, components, testing

## Shared Types

Types shared between frontend and backend are defined in `packages/shared-types/src/index.ts`:

```bash
# After modifying shared types
cd packages/shared-types && pnpm build
```

Import in frontend: `import type { ... } from '@tubeca/shared-types'`
Import in backend: `import type { ... } from '@tubeca/shared-types'`

## Database

Prisma with SQLite. Key models:
- `User` - Auth users with roles (Admin, Editor, Viewer)
- `Group` - User groups for library access control
- `Library` - Media libraries (Television, Film, Music)
- `Collection` - Hierarchical content (Shows, Seasons, Films, Artists, Albums)
- `Media` - Individual media files (Video, Audio)
- `Image` - Associated artwork (Poster, Backdrop, Logo, etc.)
- `Person` - Cast and crew with filmography

```bash
# Database commands (from /backend)
pnpm db:migrate       # Run migrations
pnpm db:studio        # Open Prisma Studio GUI
npx prisma migrate reset --force  # Reset database (destructive)
```

## Configuration

- **Environment**: `backend/.env` (see `backend/.env.example`)
- **App Config**: `tubeca.config.json` in repo root (scraper API keys, file watcher settings)

## API Documentation

- **Swagger UI**: `http://localhost:3000/api-docs` (when server running)
- **Generate OpenAPI spec**: `pnpm --filter @tubeca/backend docs:generate`

## Code Style

- All endpoints documented with OpenAPI JSDoc annotations
- All user-facing strings use i18next translations
- TypeScript strict mode enabled throughout
- ESLint + Prettier for consistent formatting
