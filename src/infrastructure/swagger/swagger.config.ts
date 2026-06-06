import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';
import { config } from '@/infrastructure/config';

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'PayCycle API',
    version: '1.0.0',
    description: 'Enterprise-grade REST API for PayCycle application',
    contact: {
      name: 'PayCycle Team',
      email: 'api@paycycle.com',
    },
  },
  servers: [
    {
      url: `http://localhost:${config.port}/api/${config.apiVersion}`,
      description: 'Development server',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT token in the format: Bearer {token}',
      },
    },
  },
  tags: [
    {
      name: 'Authentication',
      description: 'Auth endpoints — signup, login, refresh, password reset, logout',
    },
    {
      name: 'Users',
      description: 'User management endpoints',
    },
  ],
};

const options: swaggerJSDoc.Options = {
  swaggerDefinition,
  apis: ['./src/modules/**/*.routes.ts', './src/modules/**/*.controller.ts'],
};

export const swaggerSpec = swaggerJSDoc(options);

export const setupSwagger = (app: Express): void => {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/api-docs.json', (_req, res) => {
    res.json(swaggerSpec);
  });
};
