import { createApp } from './app';
import { config } from './infrastructure/config';
import { logger } from './infrastructure/logger/logger';
import {
  testDatabaseConnection,
  disconnectDatabase,
} from './infrastructure/database/prisma.client';
import './types/express.d';

async function startServer() {
  try {
    await testDatabaseConnection();

    const app = createApp();

    const server = app.listen(config.port, () => {
      logger.info(
        {
          port: config.port,
          env: config.nodeEnv,
          apiVersion: config.apiVersion,
        },
        `Server running on http://localhost:${config.port}/api/${config.apiVersion}`
      );
      logger.info(`Health check: http://localhost:${config.port}/health`);
      logger.info(`Swagger docs: http://localhost:${config.port}/api-docs`);
    });

    const shutdown = (signal: string): void => {
      logger.info(`${signal} received. Starting graceful shutdown...`);
      server.close(() => {
        logger.info('HTTP server closed');
        void disconnectDatabase().then(() => {
          logger.info('Graceful shutdown complete');
          process.exit(0);
        });
      });

      setTimeout(() => {
        logger.error('Forceful shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => {
      shutdown('SIGTERM');
    });
    process.on('SIGINT', () => {
      shutdown('SIGINT');
    });
    process.on('uncaughtException', (error) => {
      logger.fatal({ error }, 'Uncaught Exception');
      process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
      logger.fatal({ reason }, 'Unhandled Rejection');
      process.exit(1);
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

void startServer();
