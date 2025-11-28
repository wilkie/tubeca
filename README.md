# Tubeca

A media streaming platform built with React, TypeScript, and Express.

## Project Structure

This is a Turborepo monorepo managed with pnpm:

```
tubeca/
├── frontend/
│   └── ui/                 # React frontend (Vite + TypeScript)
├── backend/                # Express API server
├── package.json            # Root workspace configuration
├── pnpm-workspace.yaml     # pnpm workspace config
└── turbo.json              # Turborepo configuration
```

## Tech Stack

### Frontend (`frontend/ui`)
- **React 19** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Material-UI (MUI)** - Component library
- **SCSS Modules** - Styling
- **Jest + Testing Library** - Testing
- **ESLint** - Linting

### Backend (`backend`)
- **Express** - Web framework
- **TypeScript** - Type safety
- **tsx** - TypeScript execution for development

## Getting Started

### Prerequisites
- Node.js >= 18.0.0
- pnpm >= 8.0.0 (managed via corepack)

### Installation

1. Enable corepack (if not already enabled):
```bash
corepack enable
```

2. Install dependencies:
```bash
pnpm install
```

### Development

Run both frontend and backend in parallel:
```bash
pnpm dev
```

This will start:
- Frontend UI at `http://localhost:5173`
- Backend API at `http://localhost:3000`

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

Build specific package:
```bash
pnpm --filter @tubeca/ui build
pnpm --filter @tubeca/backend build
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

## API Proxy

The Vite dev server is configured to proxy `/api/*` requests to the backend server at `http://localhost:3000`. This avoids CORS issues during development.

## Available Scripts

- `pnpm dev` - Start all dev servers
- `pnpm build` - Build all packages
- `pnpm lint` - Lint all packages
- `pnpm test` - Run tests in all packages
- `pnpm clean` - Clean build artifacts and node_modules

## Workspace Commands

To run commands in specific workspaces, use the `--filter` flag:

```bash
pnpm --filter @tubeca/ui <command>
pnpm --filter @tubeca/backend <command>
```

## API Endpoints

### Backend (`http://localhost:3000`)

- `GET /api/health` - Health check
- `GET /api/videos` - Get sample videos list

## License

MIT
