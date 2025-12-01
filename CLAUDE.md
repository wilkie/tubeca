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

# Backend specific (from /backend)
pnpm dev              # Start backend with hot reload
pnpm db:migrate       # Run Prisma migrations
pnpm db:studio        # Open Prisma Studio

# Frontend specific (from /frontend/ui)
pnpm dev              # Start Vite dev server
pnpm lint             # ESLint check
```

## Key Directories

### Backend (`/backend/src/`)
- `routes/` - Express route handlers (auth, users, groups, libraries, collections, media, etc.)
- `services/` - Business logic (authService, libraryService, collectionService, etc.)
- `workers/` - BullMQ workers (libraryScanWorker, metadataScrapeWorker, etc.)
- `queues/` - Job queue definitions
- `middleware/` - Express middleware (auth)
- `config/` - Database, Redis, app config
- `prisma/schema.prisma` - Database schema

### Frontend (`/frontend/ui/src/`)
- `pages/` - Page components (LibraryPage, CollectionPage, MediaPage, UsersPage, etc.)
- `components/` - Reusable components (Header, Sidebar, dialogs)
- `context/` - React contexts (AuthContext, ActiveLibraryContext)
- `api/client.ts` - API client with all backend endpoints
- `i18n/locales/en.json` - Translation strings

## Code Patterns

### Backend Routes
- All routes use Express Router with OpenAPI JSDoc annotations
- Auth via `authenticate` middleware, role checks via `requireRole('Admin')`
- Responses follow `{ data }` or `{ error }` pattern

### Frontend
- Pages fetch data in `useEffect` with cancellation pattern (avoid setState-in-effect lint errors)
- Forms use `useState` + ref pattern for tracking edit state changes
- All user-facing strings use `useTranslation()` from i18next
- API calls through `apiClient` singleton

### Shared Types
- Define types in `packages/shared-types/src/index.ts`
- Run `pnpm build` in shared-types after changes
- Import in frontend: `import type { ... } from '@tubeca/shared-types'`

## Database

Prisma with SQLite. Key models:
- `User` - Auth users with roles (Admin, Editor, Viewer)
- `Group` - User groups for library access control
- `Library` - Media libraries (Television, Film, Music)
- `Collection` - Hierarchical content (Shows, Seasons, Films, Artists, Albums)
- `Media` - Individual media files (Video, Audio)
- `Image` - Associated artwork (Poster, Backdrop, Logo, etc.)

## ESLint Notes

The frontend has strict React hooks linting:
- Don't call `loadData()` directly in useEffect - use inline async function with cancellation
- Use ref pattern for form state reset on prop changes (not useEffect with setState)
- Import `SelectChangeEvent` from `@mui/material/Select`, not main package

## Testing

Backend and frontend use Jest. Run `pnpm test` from respective directories.
