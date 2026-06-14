import { config as dotenvConfig } from 'dotenv';
import { configSchema } from './schema';

dotenvConfig();

function loadConfig() {
  const rawConfig = {
    nodeEnv: process.env['NODE_ENV'],
    port: process.env['PORT'],
    apiVersion: process.env['API_VERSION'],
    databaseUrl: process.env['DATABASE_URL'],
    jwt: {
      secret: process.env['JWT_SECRET'],
      accessExpiry: process.env['JWT_ACCESS_EXPIRY'],
      refreshExpiry: process.env['JWT_REFRESH_EXPIRY'],
    },
    corsOrigin: process.env['CORS_ORIGIN'],
    appBaseUrl: process.env['APP_BASE_URL'],
    rateLimit: {
      windowMs: process.env['RATE_LIMIT_WINDOW_MS'],
      maxRequests: process.env['RATE_LIMIT_MAX_REQUESTS'],
    },
    logLevel: process.env['LOG_LEVEL'],
    pagination: {
      defaultPageSize: process.env['DEFAULT_PAGE_SIZE'],
      maxPageSize: process.env['MAX_PAGE_SIZE'],
    },
    // US-013: STT provider (all optional with safe defaults)
    speechProvider: process.env['SPEECH_PROVIDER'] ?? 'stub',
    googleSpeechKey: process.env['GOOGLE_SPEECH_KEY'],
    bhashiniApiKey: process.env['BHASHINI_API_KEY'],
    bhashiniUserId: process.env['BHASHINI_USER_ID'],
  };

  try {
    return configSchema.parse(rawConfig);
  } catch (error) {
    console.error('❌ Invalid configuration:', error);
    process.exit(1);
  }
}

export const config = loadConfig();

export const isDevelopment = () => config.nodeEnv === 'development';
export const isProduction = () => config.nodeEnv === 'production';
export const isTest = () => config.nodeEnv === 'test';
