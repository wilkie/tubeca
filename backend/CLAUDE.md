# Backend

Express.js API server with Prisma ORM, BullMQ job queues, and JWT authentication.

## Directory Structure

```
src/
├── config/           # Configuration (database, redis, swagger, app config)
├── middleware/       # Express middleware (auth)
├── plugins/          # Scraper plugin loader
├── queues/           # BullMQ queue definitions
├── routes/           # Express route handlers
├── services/         # Business logic
├── workers/          # BullMQ background workers
├── index.ts          # App entry point
└── swagger.ts        # OpenAPI doc generator
prisma/
└── schema.prisma     # Database schema
```

## Commands

```bash
pnpm dev              # Start with hot reload (tsx watch)
pnpm build            # Compile TypeScript
pnpm lint             # ESLint check
pnpm typecheck        # TypeScript check
pnpm test             # Run Jest tests

# Database
pnpm db:migrate       # Run Prisma migrations
pnpm db:studio        # Open Prisma Studio

# Documentation
pnpm docs:generate    # Generate openapi.json and docs/api.html
pnpm docs:serve       # Preview API docs locally
```

## Routes

All routes are in `src/routes/` and use Express Router with OpenAPI JSDoc annotations.

### Route Pattern

```typescript
/**
 * @openapi
 * /api/example:
 *   get:
 *     tags:
 *       - Example
 *     summary: Short description
 *     description: Longer description
 *     responses:
 *       200:
 *         description: Success response
 */
router.get('/', authenticate, async (req, res) => {
  // Handler implementation
});
```

### Authentication

```typescript
import { authenticate, requireRole } from '../middleware/auth';

// Require any authenticated user
router.get('/protected', authenticate, handler);

// Require specific role
router.post('/admin-only', authenticate, requireRole('Admin'), handler);
```

### Response Pattern

```typescript
// Success
res.json({ data: result });

// Error
res.status(400).json({ error: 'Error message' });

// Created
res.status(201).json({ data: created });

// Accepted (job queued)
res.status(202).json({ jobId: job.id, message: 'Job queued' });
```

## Services

Business logic lives in `src/services/`. Services handle database operations and complex logic.

Key services:
- `authService` - JWT token generation/verification
- `libraryService` - Library CRUD and scanning
- `collectionService` - Collection hierarchy management
- `mediaService` - Media files and streaming
- `imageService` - Image storage and retrieval
- `personService` - Person/cast management
- `fileWatcherService` - Filesystem monitoring

## Workers

Background jobs use BullMQ with Redis. Workers are in `src/workers/`.

### Queue Structure

```
src/queues/
├── videoQueue.ts         # Transcode, thumbnail, analyze jobs
├── libraryScanQueue.ts   # Library scanning jobs
├── metadataScrapeQueue.ts # Media metadata fetching
└── collectionScrapeQueue.ts # Collection metadata fetching
```

### Adding a Job

```typescript
import { metadataScrapeQueue } from '../queues/metadataScrapeQueue';

await metadataScrapeQueue.add('scrape-media', {
  mediaId: media.id,
  mediaType: 'Video',
});
```

## Database

### Prisma Commands

```bash
# Create migration after schema changes
npx prisma migrate dev --name description_of_change

# Apply migrations
pnpm db:migrate

# Reset database (deletes all data)
npx prisma migrate reset --force

# Open GUI
pnpm db:studio
```

### Common Queries

```typescript
import { prisma } from '../config/database';

// Include relations
const collection = await prisma.collection.findUnique({
  where: { id },
  include: {
    media: true,
    children: true,
    images: true,
  },
});

// Nested writes
await prisma.collection.update({
  where: { id },
  data: {
    filmDetails: {
      upsert: {
        create: { description, rating },
        update: { description, rating },
      },
    },
  },
});
```

## Scrapers

Metadata scrapers are plugins loaded from `scrapers/` directory.

### Scraper Interface

```typescript
interface ScraperPlugin {
  id: string;
  name: string;
  initialize(config: { apiKey: string }): Promise<void>;
  searchShow?(query: string): Promise<ShowSearchResult[]>;
  getShowDetails?(externalId: string): Promise<ShowDetails>;
  searchFilm?(query: string): Promise<FilmSearchResult[]>;
  getFilmDetails?(externalId: string): Promise<FilmDetails>;
  // ... more methods
}
```

### Configuration

Scraper API keys are in `tubeca.config.json`:

```json
{
  "scrapers": {
    "tmdb": { "apiKey": "your-key" },
    "tvdb": { "apiKey": "your-key" }
  }
}
```

## Testing

Jest tests are in `src/**/__tests__/`.

```bash
pnpm test                    # Run all tests
pnpm test -- --watch         # Watch mode
pnpm test -- ServiceName     # Run specific tests
```

### Test Pattern

```typescript
describe('ServiceName', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should do something', async () => {
    // Arrange
    const input = { ... };

    // Act
    const result = await service.method(input);

    // Assert
    expect(result).toEqual(expected);
  });
});
```

## Environment Variables

See `.env.example` for all available options:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `DATABASE_URL` | SQLite path | `file:./prisma/dev.db` |
| `REDIS_HOST` | Redis host | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `JWT_SECRET` | JWT signing key | (required) |
| `FILE_WATCHER_ENABLED` | Auto-import files | `false` |

## Streaming

Video streaming uses FFmpeg for on-the-fly HLS transcoding.

### Stream Routes

- `GET /api/stream/video/:id` - HLS video stream
- `GET /api/stream/audio/:id` - Audio stream
- `GET /api/stream/subtitles/:id` - WebVTT subtitles
- `GET /api/stream/trickplay/:id` - Trickplay sprite info
- `GET /api/stream/trickplay/:id/:width/:index` - Sprite sheet image

### Query Parameters

Video streams support:
- `start` - Start time in seconds
- `audioTrack` - Audio track index
- `token` - JWT auth token
