import { jsonResponse } from './contracts.js';

export class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorResponse(error) {
  if (error instanceof ApiError) {
    return jsonResponse({ error: { code: error.code, message: error.message, details: error.details } }, error.status);
  }
  console.error(error);
  return jsonResponse({ error: { code: 'internal_error', message: 'Internal server error' } }, 500);
}
