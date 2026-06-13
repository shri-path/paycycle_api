import { createApp } from './app';
import { config } from './infrastructure/config';
import { logger } from './infrastructure/logger/logger';
import {
  testDatabaseConnection,
  disconnectDatabase,
} from './infrastructure/database/prisma.client';
import './types/express.d';
import { registerSubscriptionCron } from './modules/subscription/subscription.cron';
import { ExpireOrRenewDueCommand } from './modules/subscription/commands/expire-or-renew-due/expire-or-renew-due.command';
import { SubscriptionRepository } from './modules/subscription/database/subscription.repository';
import { PlanRepository } from './modules/subscription/database/plan.repository';
import { registerVendorSettingsCron } from './modules/vendor-settings/vendor-settings.cron';

async function startServer() {
  try {
    await testDatabaseConnection();

    // Register subscription cron jobs (gated behind ENABLE_CRON=true)
    const subPlanRepo = new PlanRepository();
    const subRepo = new SubscriptionRepository();
    const expireOrRenewDue = new ExpireOrRenewDueCommand(subRepo, subPlanRepo, logger);
    registerSubscriptionCron(expireOrRenewDue, subRepo, logger);

    // Register vendor-settings cron jobs (gated behind ENABLE_CRON=true)
    registerVendorSettingsCron();

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
