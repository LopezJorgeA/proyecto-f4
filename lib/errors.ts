export type ErrorCode =
  | 'INVALID_INPUT'
  | 'TENANT_NOT_FOUND'
  | 'NO_RELEVANT_DOCUMENTS'
  | 'CLAUDE_RATE_LIMIT'
  | 'CLAUDE_TIMEOUT'
  | 'CLAUDE_API_ERROR'
  | 'DATABASE_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly httpStatus: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export const Errors = {
  invalidInput: (details: unknown) =>
    new AppError('INVALID_INPUT', 400, 'Body inválido', details),

  tenantNotFound: (tenantId: string) =>
    new AppError('TENANT_NOT_FOUND', 404, `Tenant ${tenantId} no existe`),

  noRelevantDocuments: () =>
    new AppError(
      'NO_RELEVANT_DOCUMENTS',
      404,
      'No se encontraron documentos relevantes para esta pregunta',
    ),

  claudeRateLimit: () =>
    new AppError(
      'CLAUDE_RATE_LIMIT',
      429,
      'Rate limit alcanzado en Claude API, intenta más tarde',
    ),

  claudeTimeout: () =>
    new AppError('CLAUDE_TIMEOUT', 504, 'Timeout en Claude API'),

  claudeApiError: (message: string) =>
    new AppError('CLAUDE_API_ERROR', 502, `Error en Claude API: ${message}`),

  databaseError: (message: string) =>
    new AppError('DATABASE_ERROR', 500, `Error de base de datos: ${message}`),

  internal: (message: string) =>
    new AppError('INTERNAL_ERROR', 500, message),
};