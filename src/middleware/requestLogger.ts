import { Request, Response, NextFunction } from 'express';

/**
 * Request logging middleware with comprehensive tracking and metrics
 */

interface RequestMetrics {
  correlationId: string;
  method: string;
  url: string;
  userAgent?: string;
  ip: string;
  startTime: number;
  endTime?: number;
  responseTime?: number;
  statusCode?: number;
  requestSize?: number;
  responseSize?: number;
  error?: boolean;
  errorType?: string;
}

interface ErrorMetrics {
  correlationId: string;
  errorType: string;
  errorCode: string;
  statusCode: number;
  count: number;
  timestamp: string;
}

// In-memory storage for metrics (in production, use Redis or database)
const requestMetrics = new Map<string, RequestMetrics>();
const errorCounts = new Map<string, number>();
const recentErrors: ErrorMetrics[] = [];

/**
 * Enhanced request logging middleware with correlation tracking
 */
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const startTime = Date.now();
  const correlationId = req.headers['x-correlation-id'] as string || generateCorrelationId();

  // Ensure correlation ID is set
  req.headers['x-correlation-id'] = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  // Calculate request size
  const requestSize = calculateRequestSize(req);

  // Create request metrics entry
  const metrics: RequestMetrics = {
    correlationId,
    method: req.method,
    url: req.url,
    userAgent: req.headers['user-agent'],
    ip: getClientIP(req),
    startTime,
    requestSize
  };

  requestMetrics.set(correlationId, metrics);

  // Log incoming request
  logIncomingRequest(req, correlationId, startTime);

  // Override res.end to capture response metrics
  const originalEnd = res.end.bind(res);
  res.end = function(chunk?: any, encoding?: any, cb?: any): any {
    const endTime = Date.now();
    const responseTime = endTime - startTime;

    // Update metrics
    metrics.endTime = endTime;
    metrics.responseTime = responseTime;
    metrics.statusCode = res.statusCode;
    metrics.responseSize = calculateResponseSize(res, chunk);
    metrics.error = res.statusCode >= 400;

    if (metrics.error) {
      metrics.errorType = getErrorType(res.statusCode);
      trackError(metrics);
    }

    // Log completed request
    logCompletedRequest(metrics);

    // Clean up old metrics (keep last 1000 requests)
    cleanupMetrics();

    // Call original end method and return its result
    return originalEnd(chunk, encoding, cb);
  };

  next();
};

/**
 * Generate unique correlation ID
 */
function generateCorrelationId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get client IP address from request
 */
function getClientIP(req: Request): string {
  return (
    req.headers['x-forwarded-for'] as string ||
    req.headers['x-real-ip'] as string ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    'unknown'
  ).split(',')[0].trim();
}

/**
 * Calculate request size in bytes
 */
function calculateRequestSize(req: Request): number {
  const contentLength = req.headers['content-length'];
  if (contentLength) {
    return parseInt(contentLength, 10);
  }

  // Estimate size if content-length not available
  let size = 0;

  // Headers size estimation
  size += JSON.stringify(req.headers).length;

  // URL size
  size += req.url.length;

  // Body size estimation
  if (req.body) {
    size += JSON.stringify(req.body).length;
  }

  return size;
}

/**
 * Calculate response size in bytes
 */
function calculateResponseSize(res: Response, chunk?: any): number {
  const contentLength = res.getHeader('content-length');
  if (contentLength) {
    return parseInt(contentLength.toString(), 10);
  }

  if (chunk) {
    if (Buffer.isBuffer(chunk)) {
      return chunk.length;
    }
    if (typeof chunk === 'string') {
      return Buffer.byteLength(chunk, 'utf8');
    }
    if (typeof chunk === 'object') {
      return Buffer.byteLength(JSON.stringify(chunk), 'utf8');
    }
  }

  return 0;
}

/**
 * Get error type based on status code
 */
function getErrorType(statusCode: number): string {
  if (statusCode >= 500) return 'server_error';
  if (statusCode >= 400) return 'client_error';
  return 'unknown';
}

/**
 * Track error occurrence for monitoring
 */
function trackError(metrics: RequestMetrics): void {
  const errorKey = `${metrics.method}_${metrics.statusCode}`;
  const currentCount = errorCounts.get(errorKey) || 0;
  errorCounts.set(errorKey, currentCount + 1);

  const errorMetric: ErrorMetrics = {
    correlationId: metrics.correlationId,
    errorType: metrics.errorType!,
    errorCode: errorKey,
    statusCode: metrics.statusCode!,
    count: currentCount + 1,
    timestamp: new Date().toISOString()
  };

  recentErrors.push(errorMetric);

  // Keep only last 100 errors
  if (recentErrors.length > 100) {
    recentErrors.shift();
  }

  // Check for error thresholds
  checkErrorThresholds(errorKey, currentCount + 1);
}

/**
 * Check error thresholds and alert if necessary
 */
function checkErrorThresholds(errorKey: string, count: number): void {
  const thresholds = {
    warning: 10,
    critical: 50
  };

  if (count === thresholds.warning) {
    console.warn(`WARNING: Error threshold reached for ${errorKey}: ${count} occurrences`);
  } else if (count === thresholds.critical) {
    console.error(`CRITICAL: High error rate for ${errorKey}: ${count} occurrences`);
  }
}

/**
 * Log incoming request
 */
function logIncomingRequest(req: Request, correlationId: string, startTime: number): void {
  const logData = {
    type: 'request_start',
    correlationId,
    timestamp: new Date(startTime).toISOString(),
    method: req.method,
    url: req.url,
    userAgent: req.headers['user-agent'],
    ip: getClientIP(req),
    contentType: req.headers['content-type'],
    contentLength: req.headers['content-length'],
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    params: Object.keys(req.params).length > 0 ? req.params : undefined
  };

  console.info('REQUEST START:', logData);
}

/**
 * Log completed request with metrics
 */
function logCompletedRequest(metrics: RequestMetrics): void {
  const logLevel = metrics.error ? 'warn' : 'info';
  const logType = metrics.error ? 'REQUEST ERROR' : 'REQUEST COMPLETE';

  const logData = {
    type: 'request_complete',
    correlationId: metrics.correlationId,
    timestamp: new Date(metrics.endTime!).toISOString(),
    method: metrics.method,
    url: metrics.url,
    statusCode: metrics.statusCode,
    responseTime: `${metrics.responseTime}ms`,
    requestSize: `${metrics.requestSize}B`,
    responseSize: `${metrics.responseSize}B`,
    userAgent: metrics.userAgent,
    ip: metrics.ip,
    error: metrics.error,
    errorType: metrics.errorType
  };

  console[logLevel](`${logType}:`, logData);

  // Performance warnings
  if (metrics.responseTime! > 5000) {
    console.warn('SLOW REQUEST:', {
      correlationId: metrics.correlationId,
      responseTime: `${metrics.responseTime}ms`,
      url: metrics.url
    });
  }
}

/**
 * Clean up old metrics to prevent memory leaks
 */
function cleanupMetrics(): void {
  const maxEntries = 1000;
  if (requestMetrics.size > maxEntries) {
    const entriesToDelete = requestMetrics.size - maxEntries;
    const keys = Array.from(requestMetrics.keys()).slice(0, entriesToDelete);
    keys.forEach(key => requestMetrics.delete(key));
  }
}

/**
 * Security logging middleware for suspicious activities
 */
export const securityLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const correlationId = req.headers['x-correlation-id'] as string;
  const suspicious = detectSuspiciousActivity(req);

  if (suspicious.length > 0) {
    console.warn('SECURITY ALERT:', {
      correlationId,
      timestamp: new Date().toISOString(),
      ip: getClientIP(req),
      userAgent: req.headers['user-agent'],
      method: req.method,
      url: req.url,
      suspiciousActivities: suspicious,
      headers: sanitizeHeaders(req.headers),
      body: req.body ? sanitizeBody(req.body) : undefined
    });
  }

  next();
};

/**
 * Detect suspicious request patterns
 */
function detectSuspiciousActivity(req: Request): string[] {
  const suspicious: string[] = [];

  // Check for SQL injection patterns
  const sqlPatterns = [
    /union\s+select/i,
    /drop\s+table/i,
    /insert\s+into/i,
    /delete\s+from/i,
    /script\s*>/i
  ];

  const checkText = `${req.url} ${JSON.stringify(req.query)} ${JSON.stringify(req.body)}`;

  sqlPatterns.forEach(pattern => {
    if (pattern.test(checkText)) {
      suspicious.push('potential_sql_injection');
    }
  });

  // Check for XSS patterns
  const xssPatterns = [
    /<script/i,
    /javascript:/i,
    /onload=/i,
    /onerror=/i
  ];

  xssPatterns.forEach(pattern => {
    if (pattern.test(checkText)) {
      suspicious.push('potential_xss');
    }
  });

  // Check for path traversal
  if (/\.\.[\/\\]/.test(req.url)) {
    suspicious.push('path_traversal');
  }

  // Check for excessive request size
  const contentLength = req.headers['content-length'];
  if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) {
    suspicious.push('large_payload');
  }

  // Check for missing User-Agent (common in automated attacks)
  if (!req.headers['user-agent']) {
    suspicious.push('missing_user_agent');
  }

  // Check for suspicious User-Agent patterns
  const userAgent = req.headers['user-agent'];
  if (userAgent && /bot|crawler|scanner|curl|wget/i.test(userAgent)) {
    suspicious.push('suspicious_user_agent');
  }

  return suspicious;
}

/**
 * Sanitize headers for security logging
 */
function sanitizeHeaders(headers: any): any {
  const sanitized = { ...headers };
  const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];

  sensitiveHeaders.forEach(header => {
    if (sanitized[header]) {
      sanitized[header] = '[REDACTED]';
    }
  });

  return sanitized;
}

/**
 * Sanitize request body for security logging
 */
function sanitizeBody(body: any): any {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const sanitized = { ...body };
  const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth'];

  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  });

  return sanitized;
}

/**
 * Rate limiting logging middleware
 */
export const rateLimitLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const correlationId = req.headers['x-correlation-id'] as string;
  const ip = getClientIP(req);

  // Simple in-memory rate limiting tracker
  const key = `${ip}_${req.method}_${req.route?.path || req.path}`;
  const now = Date.now();
  const windowMs = 60000; // 1 minute window

  // This is a simple example - in production use Redis
  const requests = getRequestCount(key, now, windowMs);

  if (requests > 100) { // 100 requests per minute threshold
    console.warn('RATE LIMIT WARNING:', {
      correlationId,
      timestamp: new Date().toISOString(),
      ip,
      method: req.method,
      url: req.url,
      requestCount: requests,
      windowMs
    });
  }

  next();
};

// Simple in-memory request counter (use Redis in production)
const requestCounts = new Map<string, number[]>();

function getRequestCount(key: string, now: number, windowMs: number): number {
  const requests = requestCounts.get(key) || [];

  // Remove old requests outside the window
  const validRequests = requests.filter(timestamp => now - timestamp < windowMs);

  // Add current request
  validRequests.push(now);

  // Update the map
  requestCounts.set(key, validRequests);

  return validRequests.length;
}

/**
 * Get request metrics for monitoring dashboard
 */
export const getRequestMetrics = () => {
  const metrics = Array.from(requestMetrics.values());
  const totalRequests = metrics.length;
  const errorRequests = metrics.filter(m => m.error).length;
  const averageResponseTime = metrics.reduce((sum, m) => sum + (m.responseTime || 0), 0) / totalRequests;

  return {
    totalRequests,
    errorRequests,
    errorRate: totalRequests > 0 ? (errorRequests / totalRequests) * 100 : 0,
    averageResponseTime: Math.round(averageResponseTime * 100) / 100,
    recentErrors: recentErrors.slice(-10), // Last 10 errors
    errorCounts: Object.fromEntries(errorCounts)
  };
};

/**
 * Reset metrics (useful for testing)
 */
export const resetMetrics = () => {
  requestMetrics.clear();
  errorCounts.clear();
  recentErrors.length = 0;
  requestCounts.clear();
};