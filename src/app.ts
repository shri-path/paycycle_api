import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './infrastructure/config';
import { addRequestId, requestLogger } from './infrastructure/middlewares/request-logger';
import { errorHandler, notFoundHandler } from './infrastructure/middlewares/error-handler';
import { setupSwagger } from './infrastructure/swagger/swagger.config';
import authRoutes from './modules/auth/auth.routes';
import userRoutes from './modules/user/user.routes';
import staffRoutes from './modules/staff/staff.routes';
import supplyListRoutes from './modules/supply-list/supply-list.routes';
import deliveryRoutes from './modules/delivery/delivery.routes';
import customerRoutes from './modules/customer/customer.routes';
import auditRoutes from './modules/audit/audit.routes';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    message: {
      success: false,
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many requests from this IP, please try again later',
      },
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api', limiter);

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());
  app.use(compression());
  app.use(addRequestId);
  app.use(requestLogger);

  app.get('/health', (_req, res) => {
    res.status(200).json({
      success: true,
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: config.nodeEnv,
      },
    });
  });

  const apiPrefix = `/api/${config.apiVersion}`;
  app.use(`${apiPrefix}/auth`, authRoutes);
  app.use(`${apiPrefix}/users`, userRoutes);
  app.use(`${apiPrefix}/vendors`, staffRoutes);
  app.use(`${apiPrefix}/vendors`, supplyListRoutes);
  app.use(`${apiPrefix}/vendors`, deliveryRoutes);
  app.use(`${apiPrefix}/vendors`, customerRoutes);
  app.use(`${apiPrefix}/vendors`, auditRoutes);

  setupSwagger(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
