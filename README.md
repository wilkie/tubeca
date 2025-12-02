# Tubeca

A self-hosted media streaming platform for managing and streaming personal media libraries (TV shows, films, music).

## Features

- **Multi-library support** - Organize media into separate libraries by type (Television, Film, Music)
- **Automatic metadata scraping** - Fetches metadata from TMDB and TVDB
- **Video streaming** - HLS streaming with on-the-fly transcoding via FFmpeg
- **Trickplay previews** - Video thumbnail previews on seek bar hover
- **Multi-user support** - User accounts with role-based access (Admin, Editor, Viewer)
- **Group-based permissions** - Control library access per user group
- **File watching** - Automatically detect and import new media files
- **Responsive UI** - Material Design interface that works on desktop and mobile

## Project Structure

This is a Turborepo monorepo managed with pnpm:

```
tubeca/
├── backend/                    # Express API server
├── frontend/
│   └── ui/                     # React frontend (Vite + TypeScript)
├── packages/
│   ├── shared-types/           # Shared TypeScript types
│   └── scraper-types/          # Scraper plugin interface types
├── scrapers/
│   ├── tmdb/                   # The Movie Database scraper
│   └── tvdb/                   # TheTVDB scraper
├── package.json                # Root workspace configuration
├── pnpm-workspace.yaml         # pnpm workspace config
└── turbo.json                  # Turborepo configuration
```

## Tech Stack

### Frontend (`frontend/ui`)
- **React 19** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Material-UI (MUI) 7** - Component library
- **React Router** - Client-side routing
- **i18next** - Internationalization
- **Jest + Testing Library** - Testing

### Backend (`backend`)
- **Express** - Web framework
- **TypeScript** - Type safety
- **Prisma** - Database ORM (SQLite)
- **BullMQ** - Job queue for background tasks
- **Redis** - Queue backend and caching
- **JWT** - Authentication
- **FFmpeg** - Video transcoding and streaming
- **swagger-jsdoc** - API documentation

### Scrapers
- **TMDB** - The Movie Database (films, TV shows, people)
- **TVDB** - TheTVDB (TV shows, episodes)

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0 (managed via corepack)
- Redis server
- FFmpeg (for video streaming/transcoding)

### Installation

1. Enable corepack (if not already enabled):
```bash
corepack enable
```

2. Install dependencies:
```bash
pnpm install
```

3. Set up environment variables:
```bash
cp backend/.env.example backend/.env
# Edit backend/.env with your configuration
```

4. Initialize the database:
```bash
cd backend
pnpm db:migrate
```

### Configuration

#### Environment Variables

Create a `backend/.env` file (see `backend/.env.example`):

```env
# Server
PORT=3000

# Database (SQLite)
DATABASE_URL="file:./prisma/dev.db"

# Redis (required for job queue)
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT Authentication
JWT_SECRET=your-secret-key-here

# File Watcher (optional)
FILE_WATCHER_ENABLED=false
```

#### Application Config

Create a `tubeca.config.json` in the repository root for scraper API keys and other settings:

```json
{
  "scrapers": {
    "tmdb": {
      "apiKey": "your-tmdb-api-key"
    },
    "tvdb": {
      "apiKey": "your-tvdb-api-key"
    }
  },
  "fileWatcher": {
    "enabled": false,
    "usePolling": false,
    "pollInterval": 1000
  }
}
```

### Development

Run both frontend and backend in parallel:
```bash
pnpm dev
```

This will start:
- Frontend UI at `http://localhost:5173`
- Backend API at `http://localhost:3000`
- API Documentation at `http://localhost:3000/api-docs`

Run only frontend:
```bash
pnpm --filter @tubeca/ui dev
```

Run only backend:
```bash
pnpm --filter @tubeca/backend dev
```

### Building

Build all packages:
```bash
pnpm build
```

### Testing

Run tests across all packages:
```bash
pnpm test
```

### Linting

Lint all packages:
```bash
pnpm lint
```

## API Documentation

- **Interactive docs**: Available at `http://localhost:3000/api-docs` when the server is running (Swagger UI)
- **Static reference**: See [API.md](./API.md) for endpoint documentation
- **Generate docs**: Run `pnpm --filter @tubeca/backend docs:generate` to regenerate OpenAPI spec

## Database

Tubeca uses SQLite with Prisma ORM. Key commands:

```bash
cd backend

# Run migrations
pnpm db:migrate

# Open Prisma Studio (database GUI)
pnpm db:studio

# Reset database (caution: deletes all data)
npx prisma migrate reset --force
```

## Library Types

Tubeca supports three types of media libraries:

- **Television** - TV shows organized by Show → Season → Episode
- **Film** - Movies with optional special features
- **Music** - Artists and albums (audio files)

## Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all dev servers |
| `pnpm build` | Build all packages |
| `pnpm lint` | Lint all packages |
| `pnpm test` | Run tests in all packages |
| `pnpm clean` | Clean build artifacts |

## Workspace Commands

To run commands in specific workspaces:

```bash
pnpm --filter @tubeca/ui <command>
pnpm --filter @tubeca/backend <command>
pnpm --filter @tubeca/shared-types <command>
```

## License

MIT
