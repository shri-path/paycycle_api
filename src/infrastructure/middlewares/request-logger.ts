import pinoHttp from 'pino-http';
import { Request, Response, NextFunction } from 'express';
import { logger } from '@/infrastructure/logger/logger';
import { randomUUID } from 'crypto';

export const requestLogger = pinoHttp({
  logger,
  customLogLevel: (_req, res, error) => {
    if (error || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} - ${res.statusCode}`;
  },
  customErrorMessage: (_req, _res, error) => {
    return `Request failed: ${error.message}`;
  },
  customAttributeKeys: {
    req: 'request',
    res: 'response',
    err: 'error',
    responseTime: 'duration',
  },
  serializers: {
    req: (req: { id: string; method: string; url: string }) => ({
      id: req.id,
      method: req.method,
      url: req.url,
    }),
    res: (res: { statusCode: number }) => ({
      statusCode: res.statusCode,
    }),
  },
});

export const addRequestId = (req: Request, _res: Response, next: NextFunction): void => {
  req.id = randomUUID();
  next();
};
