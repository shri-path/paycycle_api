import pino from 'pino';
import { config, isDevelopment } from '@/infrastructure/config';

const loggerOptions: pino.LoggerOptions = {
  level: config.logLevel,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  base: {
    env: config.nodeEnv,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

if (isDevelopment()) {
  loggerOptions.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
      singleLine: false,
    },
  };
}

export const logger = pino(loggerOptions);

export type Logger = pino.Logger;

export const createChildLogger = (context: Record<string, unknown>): pino.Logger => {
  return logger.child(context);
};

export const logError = (error: Error, context?: Record<string, unknown>): void => {
  logger.error(
    {
      err: error,
      stack: error.stack,
      ...context,
    },
    error.message
  );
};
