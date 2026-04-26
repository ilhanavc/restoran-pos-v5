/**
 * Repository katmanı domain hataları. Raw pg hatası asla üst katmana sızmaz —
 * `mapPgError` ile bu sınıfa çevrilir. HTTP katmanı `cause` üzerinden status'a maps eder.
 *
 * ADR-006: Tek `RepositoryError` sınıfı + ayrımcı `cause` enum'u.
 * `ConflictError`/`NotFoundError` alt sınıfları kaldırıldı — istemci kodu sadece
 * `instanceof RepositoryError` + `.cause` üzerinden ayrım yapar.
 */
export type RepositoryErrorCause =
  | 'unique'
  | 'foreign_key'
  | 'check'
  | 'not_null'
  | 'not_found'
  | 'unknown';

export class RepositoryError extends Error {
  // ES2022 `Error.cause` ile çakışmasın diye override; semantik bizim discriminator.
  public override readonly cause: RepositoryErrorCause;
  public readonly messageKey?: string;
  public readonly detail?: string;

  constructor(
    cause: RepositoryErrorCause,
    messageKey?: string,
    detail?: string,
  ) {
    super(`RepositoryError[${cause}]${detail ? ': ' + detail : ''}`);
    this.name = 'RepositoryError';
    this.cause = cause;
    if (messageKey !== undefined) this.messageKey = messageKey;
    if (detail !== undefined) this.detail = detail;
  }
}

interface PgErrorShape {
  code: string;
  detail?: string;
  message: string;
  column?: string;
  constraint?: string;
}

/**
 * PostgreSQL hata kodu → RepositoryError. Bilinmeyen kod için `null` döner;
 * caller orijinal hatayı yeniden throw etmelidir (yutma yasak).
 *
 * - 23505: unique_violation
 * - 23503: foreign_key_violation
 * - 23514: check_violation
 * - 23502: not_null_violation
 * - P0001: raise_exception → DB tarafında `RAISE EXCEPTION USING MESSAGE = 'error.<domain>.<camelCase>'`
 *   formatı bekleniyor; mesaj doğrudan `messageKey` olarak taşınır.
 */
export function mapPgError(err: unknown): RepositoryError | null {
  if (
    typeof err !== 'object' ||
    err === null ||
    !('code' in err) ||
    typeof (err as { code: unknown }).code !== 'string'
  ) {
    return null;
  }

  const pgErr = err as PgErrorShape;

  switch (pgErr.code) {
    case '23505':
      return new RepositoryError('unique', undefined, pgErr.detail);
    case '23503':
      return new RepositoryError('foreign_key', undefined, pgErr.detail);
    case '23514':
      return new RepositoryError(
        'check',
        'error.db.checkConstraint',
        pgErr.constraint,
      );
    case 'P0001':
      // Alt A: DB RAISE EXCEPTION USING MESSAGE = 'error.<domain>.<camelCase>' taşır
      return new RepositoryError('check', pgErr.message, pgErr.detail);
    case '23502':
      return new RepositoryError('not_null', undefined, pgErr.column);
    default:
      return null;
  }
}
