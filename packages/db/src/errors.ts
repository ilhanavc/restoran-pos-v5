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
 * PG constraint-ihlali detail'inden yalnız KOLON ADLARINI çıkarır; satır
 * DEĞERLERİNİ asla taşımaz. `Key (email)=(a@b.com) already exists.` →
 * `email`. Ham detail e-posta/telefon gibi PII içerir ve hem Error.message
 * üzerinden log'a hem HTTP error-body'ye sızıyordu (denetim DB-SEC-01 /
 * API-CORE-01). Format eşleşmezse undefined — bilinmeyen ifadeyi taşıma.
 */
function sanitizePgDetail(detail: string | undefined): string | undefined {
  if (detail === undefined) return undefined;
  const m = /^Key \(([^)]+)\)=/.exec(detail);
  return m === null ? undefined : m[1];
}

/**
 * Ham pg hatasından TEŞHİS için güvenli alanlar. `detail` sanitize edilmiştir
 * (yalnız kolon adı; satır değerleri asla).
 */
export interface PgErrorLogFields {
  code: string;
  constraint?: string;
  table?: string;
  detail?: string;
}

/** SQLSTATE 5 karakterdir (`23514`, `P0001`, `57P01`). */
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

/**
 * `detail` YALNIZ bu kodlarda okunur. PG bu üçünde `Key (kolon)=(değer) …`
 * üretir ve `sanitizePgDetail` oradan yalnız KOLON ADINI alır.
 *
 * ⚠️ `23514` (check) ve `23502` (not_null) formatı farklıdır:
 * `Failing row contains (3, 05551234567, Ahmet Yılmaz, …)` — İHLAL EDEN SATIRIN
 * TAMAMI, yani telefon/isim/adres. Bu kodlarda `detail` hiç okunmaz; güvence
 * regex'in eşleşmemesine (negatif) değil, koda (pozitif allowlist) dayanır.
 */
const KEY_DETAIL_CODES = new Set(['23505', '23503', '23P01']);

/**
 * Ham pg hatasını log'a basılabilir alanlara indirger; pg hatası değilse `null`.
 *
 * `23514` (check_violation) için `constraint` olayı TEK BAŞINA tanımlayan
 * alandır: prod'daki dört 23514 500'ünün hangi kısıttan geldiğini anlamak 20
 * gün sürdü çünkü log satırında yoktu (docs/audit/23514-teshis-2026-09-27.md
 * §3 F1). `mapPgError` bu alanı `RepositoryError.detail`'e koyar ama ham pg
 * hatası errorHandler'a map'lenmeden ulaştığında (= beklenmeyen 500) o yol
 * hiç çalışmaz — log'un kendi başına teşhis edilebilir olması gerekir.
 */
export function describePgError(err: unknown): PgErrorLogFields | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as Record<string, unknown>;
  const code = e['code'];
  if (typeof code !== 'string' || !SQLSTATE_PATTERN.test(code)) return null;
  // `EPIPE` / `EPERM` gibi Node hata kodları da 5 büyük harftir; pg ayrımı için
  // sürücünün ErrorResponse'tan daima doldurduğu alanlara bakılır (protokol
  // alanları 'S' = severity, 'R' = routine). Aksi hâlde bir socket hatası
  // `pg: { code: 'EPIPE' }` olarak teşhis gürültüsü üretirdi.
  if (typeof e['severity'] !== 'string' && typeof e['routine'] !== 'string') {
    return null;
  }

  const constraint = e['constraint'];
  const table = e['table'];
  const detail = KEY_DETAIL_CODES.has(code)
    ? sanitizePgDetail(
        typeof e['detail'] === 'string' ? e['detail'] : undefined,
      )
    : undefined;

  return {
    code,
    ...(typeof constraint === 'string' && { constraint }),
    ...(typeof table === 'string' && { table }),
    ...(detail !== undefined && { detail }),
  };
}

/**
 * PostgreSQL hata kodu → RepositoryError. Bilinmeyen kod için `null` döner;
 * caller orijinal hatayı yeniden throw etmelidir (yutma yasak).
 *
 * - 23505: unique_violation — detail SANITIZE edilir (kolon adı; değer asla)
 * - 23503: foreign_key_violation — detail SANITIZE edilir
 * - 23514: check_violation
 * - 23502: not_null_violation
 * - P0001: raise_exception → DB tarafında `RAISE EXCEPTION USING MESSAGE = 'error.<domain>.<camelCase>'`
 *   formatı bekleniyor; mesaj doğrudan `messageKey` olarak taşınır (detail
 *   kendi RAISE kodumuzun kontrolünde — PII koymama sorumluluğu DB-fonksiyonunda).
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
      // detail: kolon adları (değersiz) yoksa constraint adı — PII taşınmaz.
      return new RepositoryError(
        'unique',
        undefined,
        sanitizePgDetail(pgErr.detail) ?? pgErr.constraint,
      );
    case '23503':
      return new RepositoryError(
        'foreign_key',
        undefined,
        sanitizePgDetail(pgErr.detail) ?? pgErr.constraint,
      );
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
