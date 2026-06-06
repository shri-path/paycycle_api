import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ValidationError } from '@/common/errors/app-error';

export const validate =
  (schema: ZodSchema, target: 'body' | 'query' | 'params' = 'body'): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    void schema
      .parseAsync(req[target])
      .then((validated: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        req[target] = validated as (typeof req)[typeof target];
        next();
      })
      .catch((error: unknown) => {
        if (error instanceof ZodError) {
          next(
            new ValidationError('Validation failed', {
              errors: error.errors.map((err) => ({
                field: err.path.join('.'),
                message: err.message,
                code: err.code,
              })),
            })
          );
        } else {
          next(error);
        }
      });
  };
