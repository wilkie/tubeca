import swaggerJSDoc from 'swagger-jsdoc';

const options: swaggerJSDoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Tubeca API',
      version: '1.0.0',
      description: 'Media streaming platform backend API',
      contact: {
        name: 'Tubeca',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
    ],
    tags: [
      { name: 'Health', description: 'Health check endpoints' },
      { name: 'Auth', description: 'Authentication endpoints' },
      { name: 'Users', description: 'User management endpoints' },
      { name: 'Settings', description: 'System settings endpoints' },
      { name: 'Libraries', description: 'Library management endpoints' },
      { name: 'Collections', description: 'Collection management endpoints' },
      { name: 'Media', description: 'Media management endpoints' },
      { name: 'Persons', description: 'Person/cast management endpoints' },
      { name: 'Images', description: 'Image management endpoints' },
      { name: 'Streaming', description: 'Media streaming endpoints' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', description: 'Error message' },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            role: { type: 'string', enum: ['Admin', 'Editor', 'Viewer'] },
            groups: { type: 'array', items: { $ref: '#/components/schemas/UserGroup' } },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        UserGroup: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
          },
        },
        LoginResponse: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            user: { $ref: '#/components/schemas/User' },
          },
        },
        Settings: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            instanceName: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Library: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            path: { type: 'string' },
            libraryType: { type: 'string', enum: ['Television', 'Film', 'Music'] },
            watchForChanges: { type: 'boolean', description: 'Watch for filesystem changes and auto-import new media' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Collection: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            sortName: { type: 'string' },
            collectionType: { type: 'string', enum: ['Show', 'Season', 'Film', 'Artist', 'Album', 'Folder'] },
            libraryId: { type: 'string', format: 'uuid' },
            parentId: { type: 'string', format: 'uuid', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Media: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            path: { type: 'string' },
            name: { type: 'string' },
            sortName: { type: 'string' },
            type: { type: 'string', enum: ['Video', 'Audio'] },
            duration: { type: 'number', description: 'Duration in seconds' },
            size: { type: 'integer', description: 'File size in bytes' },
            collectionId: { type: 'string', format: 'uuid', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        MediaStream: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            streamIndex: { type: 'integer' },
            streamType: { type: 'string', enum: ['Video', 'Audio', 'Subtitle'] },
            codec: { type: 'string', nullable: true },
            language: { type: 'string', nullable: true },
            title: { type: 'string', nullable: true },
            channels: { type: 'integer', nullable: true },
            channelLayout: { type: 'string', nullable: true },
            isDefault: { type: 'boolean' },
            isForced: { type: 'boolean' },
          },
        },
        Person: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            biography: { type: 'string', nullable: true },
            birthDate: { type: 'string', format: 'date', nullable: true },
            deathDate: { type: 'string', format: 'date', nullable: true },
            birthPlace: { type: 'string', nullable: true },
            tmdbId: { type: 'integer', nullable: true },
            tvdbId: { type: 'integer', nullable: true },
          },
        },
        Image: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            path: { type: 'string' },
            imageType: { type: 'string', enum: ['Poster', 'Backdrop', 'Banner', 'Thumb', 'Logo', 'Photo'] },
            isPrimary: { type: 'boolean' },
            width: { type: 'integer', nullable: true },
            height: { type: 'integer', nullable: true },
          },
        },
        ScanStatus: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['idle', 'waiting', 'active', 'completed', 'failed'] },
            scanning: { type: 'boolean' },
            progress: { type: 'number' },
            result: { type: 'object', nullable: true },
            failedReason: { type: 'string', nullable: true },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.ts', './src/index.ts'],
};

export const swaggerSpec = swaggerJSDoc(options);
