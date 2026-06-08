import { Response } from 'express';

interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const sendSuccess = (
  res: Response,
  data: unknown,
  statusCode = 200,
  meta?: PaginationMeta
): void => {
  const response: Record<string, unknown> = {
    success: true,
    data,
  };
  if (meta !== undefined) {
    response['meta'] = meta;
  }
  res.status(statusCode).json(response);
};

export const sendListResponse = (res: Response, data: unknown, meta: PaginationMeta): void => {
  sendSuccess(res, data, 200, meta);
};

export const sendCreated = (res: Response, data: unknown): void => {
  sendSuccess(res, data, 201);
};

export const sendNoContent = (res: Response): void => {
  res.status(204).send();
};

export const calculatePaginationMeta = (
  page: number,
  limit: number,
  total: number
): PaginationMeta => {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
};
