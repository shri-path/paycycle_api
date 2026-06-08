import { z } from 'zod';

export const configSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().int().positive().default(3000),
  apiVersion: z.string().default('v1'),
  databaseUrl: z.string().url(),
  jwt: z.object({
    secret: z.string().min(32, 'JWT secret must be at least 32 characters'),
    accessExpiry: z.string().default('1h'),
    refreshExpiry: z.string().default('30d'),
  }),
  corsOrigin: z
    .string()
    .transform((val) => val.split(',').map((origin) => origin.trim()))
    .default('http://localhost:3000'),
  appBaseUrl: z.string().url().default('http://localhost:5173'),
  rateLimit: z.object({
    windowMs: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),
    maxRequests: z.coerce.number().int().positive().default(100),
  }),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  pagination: z.object({
    defaultPageSize: z.coerce.number().int().positive().default(20),
    maxPageSize: z.coerce.number().int().positive().default(100),
  }),
});

export type Config = z.infer<typeof configSchema>;
