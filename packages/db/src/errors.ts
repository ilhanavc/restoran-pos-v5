/**
 * Repository katmanı domain hataları. Raw pg hatası asla üst katmana sızmaz —
 * `mapPgError` ile bu sınıflara çevrilir. HTTP katmanı bunları status'a maps eder.
 */
export class RepositoryError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'RepositoryError';
  }
}

export class NotFoundError extends RepositoryError {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends RepositoryError {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

interface PgErrorShape {
  code: string;
  detail?: string;
  message: string;
}

function isPgError(err: unknown): err is PgErrorShape {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
  );
}

/**
 * PostgreSQL hata kodu → domain error.
 * - 23505: unique_violation → ConflictError
 * - 23503: foreign_key_violation → RepositoryError (FK)
 * Diğerleri generic RepositoryError olarak sarılır; orijinal hata `cause`'da kalır.
 */
export function mapPgError(err: unknown): RepositoryError {
  if (isPgError(err)) {
    if (err.code === '23505') {
      return new ConflictError(err.detail ?? err.message);
    }
    if (err.code === '23503') {
      return new RepositoryError(
        `Foreign key violation: ${err.detail ?? err.message}`,
        err,
      );
    }
  }
  return new RepositoryError('Unexpected database error', err);
}
