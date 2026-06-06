import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '@/common/errors/app-error';
import { logError } from '@/infrastructure/logger/logger';
import { isProduction } from '@/infrastructure/config';

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  logError(error, {
    path: req.path,
    method: req.method,
    userId: req.user?.userId?.toString(),
  });

  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      success: false,
      error: error.toJSON(),
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      },
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const prismaError = handlePrismaError(error);
    res.status(prismaError.statusCode).json({
      success: false,
      error: {
        code: prismaError.code,
        message: prismaError.message,
      },
    });
    return;
  }

  const message = isProduction() ? 'Internal server error' : error.message;
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message,
    },
  });
};

function handlePrismaError(error: Prisma.PrismaClientKnownRequestError): {
  statusCode: number;
  code: string;
  message: string;
} {
  switch (error.code) {
    case 'P2002':
      return {
        statusCode: 409,
        code: 'CONFLICT',
        message: `Duplicate value for field: ${Array.isArray(error.meta?.['target']) ? (error.meta?.['target'] as string[]).join(', ') : 'unknown'}`,
      };
    case 'P2025':
      return { statusCode: 404, code: 'NOT_FOUND', message: 'Record not found' };
    case 'P2003':
      return {
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Invalid reference to related record',
      };
    default:
      return {
        statusCode: 500,
        code: 'DATABASE_ERROR',
        message: 'Database operation failed',
      };
  }
}

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
};
