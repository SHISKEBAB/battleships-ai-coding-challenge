import { Request, Response, NextFunction } from 'express';
import { ErrorResponse } from '../types';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  console.error('Error occurred:', err.stack);

  const errorResponse: ErrorResponse = {
    error: err.name || 'InternalServerError',
    message: err.message || 'An unexpected error occurred',
    timestamp: new Date().toISOString(),
  };

  if (process.env.NODE_ENV === 'development') {
    errorResponse.details = err.stack;
  }

  const statusCode = getStatusCode(err);
  res.status(statusCode).json(errorResponse);
};

function getStatusCode(err: Error): number {
  if (err.name === 'ValidationError') return 400;
  if (err.name === 'UnauthorizedError') return 401;
  if (err.name === 'NotFoundError') return 404;
  if (err.name === 'ConflictError') return 409;
  return 500;
}