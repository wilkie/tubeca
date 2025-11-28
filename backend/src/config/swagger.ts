import swaggerJSDoc from 'swagger-jsdoc'

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
      {
        name: 'Health',
        description: 'Health check endpoints',
      },
      {
        name: 'Media',
        description: 'Media management endpoints',
      },
      {
        name: 'Settings',
        description: 'System settings endpoints',
      },
      {
        name: 'Jobs',
        description: 'Background job queue endpoints',
      },
    ],
    components: {
      schemas: {
        Media: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'Media ID',
            },
            path: {
              type: 'string',
              description: 'File path',
            },
            duration: {
              type: 'integer',
              description: 'Duration in seconds',
            },
            name: {
              type: 'string',
              description: 'Human-readable name',
            },
            description: {
              type: 'string',
              description: 'Description',
            },
            type: {
              type: 'string',
              enum: ['Video', 'Audio'],
              description: 'Media type',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        Settings: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'Settings ID',
            },
            instanceName: {
              type: 'string',
              description: 'Instance name',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message',
            },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.ts', './src/index.ts'],
}

export const swaggerSpec = swaggerJSDoc(options)
