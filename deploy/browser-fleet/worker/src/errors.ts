/**
 * An error that maps directly to an HTTP response. `code` is a stable machine-readable string;
 * `extra` is merged into the JSON body (e.g. the slot object on a wait timeout).
 */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(statusCode: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.extra = extra;
  }
}

export const notFound = (what: string): HttpError => new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const badRequest = (message: string, extra: Record<string, unknown> = {}): HttpError => new HttpError(400, 'BAD_REQUEST', message, extra);
