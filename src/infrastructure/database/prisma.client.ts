import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '@/infrastructure/logger/logger';
import { isProduction, isDevelopment } from '@/infrastructure/config';

const prismaClientSingleton = () => {
  return new PrismaClient({
    log: isProduction()
      ? ['error', 'warn']
      : [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'warn' },
        ],
  });
};

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: ReturnType<typeof prismaClientSingleton> | undefined;
}

export const prisma: ReturnType<typeof prismaClientSingleton> =
  globalThis.prismaGlobal ?? prismaClientSingleton();

if (!isProduction()) {
  globalThis.prismaGlobal = prisma;
}

if (isDevelopment()) {
  (prisma as unknown as { $on: (event: string, cb: (e: unknown) => void) => void }).$on(
    'query',
    (e: unknown) => {
      logger.debug({ query: e }, 'DB Query');
    }
  );
}

export type PrismaTransaction = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export { Prisma };

export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
  logger.info('Disconnected from database');
};

export const testDatabaseConnection = async (): Promise<void> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('✓ Database connection successful');
  } catch (error) {
    logger.error({ error }, '✗ Database connection failed');
    throw error;
  }
};
