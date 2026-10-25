/**
 * One error type, mapped to HTTP in exactly one place (the error handler).
 *
 * Services throw AppError and know nothing about status codes; routes know nothing
 * about domain failure modes. Anything that is NOT an AppError escaping to the
 * handler is by definition a bug, and is logged as such and returned as a bare 500
 * — we never leak an internal message, a stack, or a Mongo error to a client.
 */
export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation_failed'
  | 'rate_limited'
  | 'ai_disabled'
  | 'ai_unavailable'
  | 'ingestion_failed'
  | 'pdf_password_required'
  | 'mail_unavailable'
  | 'internal';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  ai_disabled: 403,
  ai_unavailable: 503,
  ingestion_failed: 422,
  pdf_password_required: 422,
  mail_unavailable: 503,
  internal: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError('bad_request', message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new AppError('unauthorized', message);
  }
  static forbidden(message = 'Not permitted') {
    return new AppError('forbidden', message);
  }
  static notFound(what = 'Resource') {
    return new AppError('not_found', `${what} not found`);
  }
  static conflict(message: string, details?: unknown) {
    return new AppError('conflict', message, details);
  }
  static aiDisabled(message = 'Synítheia AI is not enabled for this account') {
    return new AppError('ai_disabled', message);
  }
  static aiUnavailable(message = 'Synítheia AI is not available right now') {
    return new AppError('ai_unavailable', message);
  }
  static ingestionFailed(message: string, details?: unknown) {
    return new AppError('ingestion_failed', message, details);
  }

  /**
   * The statement is locked and we need the password to open it.
   *
   * This is its own code, not an `ingestion_failed` with a hopeful message, because the
   * app has to DO something specific about it — show a password field and retry — and
   * deciding that by matching on English prose would break the first time the copy is
   * reworded or translated.
   */
  static pdfPasswordRequired(message: string) {
    return new AppError('pdf_password_required', message);
  }

  /** Email is not set up on this server, or the provider refused the message. */
  static mailUnavailable(message: string) {
    return new AppError('mail_unavailable', message);
  }
}

export interface ErrorResponseBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId: string;
  };
}
