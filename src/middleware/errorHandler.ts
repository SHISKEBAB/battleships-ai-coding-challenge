import { Request, Response, NextFunction } from 'express';
import { ErrorResponse } from '../types';
import {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  InternalServerError,
  JSONParsingError,
  isAppError,
  isOperationalError
} from '../utils/errors';

/**
 * Enhanced error handling middleware with comprehensive logging and standardized responses
 */
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const correlationId = req.headers['x-correlation-id'] as string || 'unknown';
  const startTime = Date.now();

  // Log the error with context
  logError(err, req, correlationId);

  // Handle the error and create standardized response
  const { statusCode, errorResponse } = handleError(err, correlationId);

  // Add response headers
  res.setHeader('X-Correlation-ID', correlationId);
  res.setHeader('X-Error-Handled', 'true');

  // Log response metrics
  logErrorResponse(req, statusCode, Date.now() - startTime, correlationId);

  // Send error response
  if (!res.headersSent) {
    res.status(statusCode).json(errorResponse);
  }
};

/**
 * Handle different types of errors and create standardized responses
 */
function handleError(err: Error, correlationId: string): {
  statusCode: number;
  errorResponse: ErrorResponse;
} {
  // Handle AppError instances (our custom errors)
  if (isAppError(err)) {
    return {
      statusCode: err.statusCode,
      errorResponse: {
        error: err.errorCode,
        message: err.message,
        timestamp: err.timestamp,
        ...(err.details && process.env.NODE_ENV === 'development' && { details: err.details }),
        ...(err.correlationId && { correlationId: err.correlationId })
      }
    };
  }

  // Handle specific built-in Node.js/Express errors
  if (err.name === 'SyntaxError' && err.message.includes('JSON')) {
    const jsonError = new JSONParsingError('Invalid JSON in request body', err.message, correlationId);
    return {
      statusCode: jsonError.statusCode,
      errorResponse: jsonError.toJSON()
    };
  }

  // Handle validation errors from other libraries (like express-validator)
  if (err.name === 'ValidationError') {
    const validationError = new ValidationError(err.message, undefined, undefined, correlationId);
    return {
      statusCode: validationError.statusCode,
      errorResponse: validationError.toJSON()
    };
  }

  // Handle MongoDB/Database errors
  if (err.name === 'MongoError' || err.name === 'MongooseError') {
    const dbError = new InternalServerError('Database operation failed', err, correlationId);
    return {
      statusCode: dbError.statusCode,
      errorResponse: dbError.toJSON()
    };
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    const authError = new UnauthorizedError(
      'Invalid or expired token',
      err.name === 'TokenExpiredError' ? 'expired_token' : 'invalid_token',
      correlationId
    );
    return {
      statusCode: authError.statusCode,
      errorResponse: authError.toJSON()
    };
  }

  // Handle Express built-in errors
  if (err.name === 'PayloadTooLargeError') {
    const payloadError = new ValidationError(
      'Request payload too large',
      'payload',
      ['max_size'],
      correlationId
    );
    return {
      statusCode: payloadError.statusCode,
      errorResponse: payloadError.toJSON()
    };
  }

  // Log unexpected errors for investigation
  if (!isOperationalError(err)) {
    console.error('UNEXPECTED ERROR:', {
      name: err.name,
      message: err.message,
      stack: err.stack,
      correlationId
    });
  }

  // Default to Internal Server Error for unknown errors
  const internalError = new InternalServerError(
    'An unexpected error occurred',
    err,
    correlationId
  );

  return {
    statusCode: internalError.statusCode,
    errorResponse: internalError.toJSON()
  };
}

/**
 * Log error details with structured format
 */
function logError(err: Error, req: Request, correlationId: string): void {
  const errorInfo = {
    correlationId,
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    userAgent: req.headers['user-agent'],
    ip: req.ip || req.connection.remoteAddress,
    error: {
      name: err.name,
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    },
    request: {
      params: req.params,
      query: req.query,
      body: sanitizeRequestBody(req.body),
      headers: sanitizeHeaders(req.headers)
    }
  };

  // Log at appropriate level based on error type
  if (isAppError(err)) {
    if (err.statusCode >= 500) {
      console.error('SERVER ERROR:', errorInfo);
    } else if (err.statusCode >= 400) {
      console.warn('CLIENT ERROR:', errorInfo);
    } else {
      console.info('ERROR INFO:', errorInfo);
    }
  } else {
    console.error('UNHANDLED ERROR:', errorInfo);
  }
}

/**
 * Log error response metrics
 */
function logErrorResponse(
  req: Request,
  statusCode: number,
  responseTime: number,
  correlationId: string
): void {
  const responseInfo = {
    correlationId,
    method: req.method,
    url: req.url,
    statusCode,
    responseTime: `${responseTime}ms`,
    timestamp: new Date().toISOString()
  };

  console.info('ERROR RESPONSE:', responseInfo);
}

/**
 * Sanitize request body for logging (remove sensitive information)
 */
function sanitizeRequestBody(body: any): any {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const sanitized = { ...body };
  const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth', 'authorization'];

  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  }

  return sanitized;
}

/**
 * Sanitize headers for logging (remove sensitive information)
 */
function sanitizeHeaders(headers: any): any {
  const sanitized = { ...headers };
  const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];

  for (const header of sensitiveHeaders) {
    if (sanitized[header]) {
      sanitized[header] = '[REDACTED]';
    }
  }

  return sanitized;
}

/**
 * Middleware to handle async route errors
 * Wraps async route handlers to catch Promise rejections
 */
export const asyncErrorHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Middleware to handle 404 errors for unmatched routes
 */
export const notFoundHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const correlationId = req.headers['x-correlation-id'] as string || 'unknown';
  const notFoundError = new NotFoundError(
    `Route ${req.method} ${req.path} not found`,
    'route',
    req.path,
    correlationId
  );

  next(notFoundError);
};

/**
 * Middleware to handle method not allowed errors
 */
export const methodNotAllowedHandler = (
  allowedMethods: string[]
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const correlationId = req.headers['x-correlation-id'] as string || 'unknown';

    res.setHeader('Allow', allowedMethods.join(', '));

    const methodError = new ValidationError(
      `Method ${req.method} not allowed for this route`,
      'method',
      allowedMethods,
      correlationId
    );

    next(methodError);
  };
};

/**
 * Global uncaught exception handler
 */
export const setupGlobalErrorHandlers = (): void => {
  process.on('uncaughtException', (err: Error) => {
    console.error('UNCAUGHT EXCEPTION:', {
      timestamp: new Date().toISOString(),
      error: {
        name: err.name,
        message: err.message,
        stack: err.stack
      }
    });

    // Give time for logs to be written before exiting
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    console.error('UNHANDLED PROMISE REJECTION:', {
      timestamp: new Date().toISOString(),
      reason: reason?.message || reason,
      stack: reason?.stack,
      promise: promise.toString()
    });

    // Give time for logs to be written before exiting
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });
};

/**
 * Error monitoring and alerting (placeholder for production monitoring)
 */
export const monitorError = (err: Error, context: any): void => {
  // In production, this would integrate with monitoring services like:
  // - Sentry
  // - DataDog
  // - New Relic
  // - CloudWatch

  if (process.env.NODE_ENV === 'production') {
    // Example: Send to monitoring service
    // sentry.captureException(err, { extra: context });
    console.log('Error monitoring placeholder - integrate with your monitoring service');
  }
};