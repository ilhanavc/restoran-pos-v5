/**
 * User domain policy.
 *
 * # Why this scope? (3 functions only)
 *
 * Phase 1.5 forensic verdict (audit Katman 1): charter Phase 1 listesi
 * "Menu/Payment/User entity ve policy'leri" maddesi yazılmadı (atlama).
 * Phase 1.5'te eksik 3 entity policy yazıldı (menu.ts, payment.ts, user.ts).
 *
 * User için pure domain kapsamı ADR-002 + ADR-003 §8 ile sınırlı.
 * Çok katmanlı enforcement var:
 *
 *   - DB constraint (savunma): UNIQUE (tenant_id, username/email),
 *     soft-delete partial index (ADR-002 §1, ADR-003 §6 + §8)
 *   - Domain layer (authoritative, BU MODÜL): pure helper'lar —
 *     password validation + role authorization + delete safety.
 *     Side-effect, DB write, bcrypt I/O YOK.
 *   - Service layer (Phase 2 apps/api): user CRUD endpoint'leri
 *     (POST/PATCH/DELETE /users) bu fonksiyonları çağırır.
 *   - Auth layer (apps/api/src/auth/password.ts): bcrypt hash/compare
 *     I/O — pure domain dışı, zaten Görev 12'de yazıldı.
 *
 * # Bu modülde YAZILMAYAN konular
 *
 *   - hashPassword / verifyPassword: bcrypt I/O, apps/api/src/auth/
 *     password.ts'de mevcut (Görev 12).
 *   - Lockout state (failed_login_count, locked_until): DB state +
 *     timestamp aritmetiği, service katmanı (ADR-002 §8 lockout policy).
 *   - must_change_password flag: DB kolonu, middleware doğrudan okur —
 *     trivial wrapper YAGNI.
 *   - Email-based password reset: v5.1 (ADR-002 §8 — MVP admin manual
 *     reset, must_change_password=true ile zorla).
 *   - Username/email format validation: zod schema (shared-types) zaten
 *     enforce eder.
 *   - Tenant scope check (users.tenant_id NOT NULL): DB constraint
 *     + repository helper joinWithTenant (ADR-003 §6.3.1).
 *
 * # Source of truth
 *
 *   - ADR-002 §1 (users tenant-scoped, UNIQUE (tenant_id, username))
 *   - ADR-002 §6 (role permissions matrix — "Personel yönetimi" admin-only)
 *   - ADR-002 §8 (password politikası — bcrypt 12, min 10 char, NIST 800-63B)
 *   - ADR-003 §8 (soft vs hard delete: referans varsa soft)
 *   - docs/v3-reference/domain-rules.md "Silme Politikası (Hibrit)" (Sinyal #7)
 *
 * # Caller integration (Phase 2)
 *
 * Repository / service layer caller'ları:
 *   - validatePassword: POST /auth/change-password ve POST /users
 *     endpoint'lerinde body parse sonrası pre-check. zod min(8) drift
 *     ile UI'ya net "too_short" reason döner (ADR-002 §8 min 10).
 *   - canManageUsers: user CRUD endpoint'lerinde authorize middleware
 *     sonrası ek role check — admin dışı default-deny.
 *   - canHardDeleteUser: DELETE /users/:id endpoint'inde repository
 *     hasReferencingRecords boolean'ını DB sorgusuyla hesaplar:
 *       SELECT EXISTS (
 *         SELECT 1 FROM orders WHERE created_by = $1 OR assigned_waiter_id = $1
 *         UNION ALL SELECT 1 FROM payments WHERE created_by = $1
 *         -- ek FK kaynakları ADR-003 §8 forensic kuralı: soft-deleted
 *         -- satırlar dahil
 *       )
 */

import type { UserRole } from '@restoran-pos/shared-types';

// ── validatePassword ────────────────────────────────────────────

export type ValidatePasswordReason = 'empty' | 'too_short';

export type ValidatePasswordResult =
  | { ok: true }
  | { ok: false; reason: ValidatePasswordReason };

/**
 * Validates a plaintext password against the project's policy.
 *
 * Rules (ADR-002 §8, NIST 800-63B):
 *   - Not empty (after trim — pure whitespace is rejected as empty).
 *   - Minimum 10 characters (raw length, NOT trimmed — leading/trailing
 *     whitespace counts toward strength per NIST guidance).
 *   - No complexity rules (no required uppercase/digit/symbol).
 *
 * Order of checks: empty before too_short. A pure-whitespace input has
 * length > 0 but trim().length === 0; reporting it as 'empty' is the
 * more actionable UX message.
 */
export function validatePassword(plain: string): ValidatePasswordResult {
  if (plain.trim().length === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (plain.length < 10) {
    return { ok: false, reason: 'too_short' };
  }
  return { ok: true };
}

// ── canManageUsers ──────────────────────────────────────────────

export type CanManageUsersReason = 'insufficient_role';

export type CanManageUsersResult =
  | { ok: true }
  | { ok: false; reason: CanManageUsersReason };

/**
 * Decides whether the requester may manage other user accounts.
 *
 * Rule (ADR-002 §6 role matrix, "Personel yönetimi (user CRUD)"):
 * only `admin` may create, update, soft/hard-delete, or force-reset
 * another user. Cashier, waiter, and kitchen are denied.
 *
 * Self-service password change is a separate flow — every role may
 * change its own password (see ADR-002 §6 "Şifre değiştir (kendi)")
 * and that endpoint does NOT call this guard.
 */
export function canManageUsers(requesterRole: UserRole): CanManageUsersResult {
  if (requesterRole !== 'admin') {
    return { ok: false, reason: 'insufficient_role' };
  }
  return { ok: true };
}

// ── canHardDeleteUser ───────────────────────────────────────────

export type CanHardDeleteUserReason = 'user_referenced_by_records';

export type CanHardDeleteUserResult =
  | { ok: true }
  | { ok: false; reason: CanHardDeleteUserReason };

/**
 * Decides whether a user row can be physically removed.
 *
 * Rule (ADR-003 §8, domain-rules.md Sinyal #7): a user that is
 * referenced by any business record (orders.created_by,
 * orders.assigned_waiter_id, payments.created_by, audit_logs.actor_user_id,
 * etc.) must be soft-deleted to preserve historical attribution and
 * the audit chain. Otherwise the row can be physically removed.
 *
 * The caller (repository) is responsible for computing
 * hasReferencingRecords across all FK source tables, including
 * soft-deleted rows (ADR-003 §8 forensic rule).
 */
export function canHardDeleteUser(input: {
  hasReferencingRecords: boolean;
}): CanHardDeleteUserResult {
  if (input.hasReferencingRecords) {
    return { ok: false, reason: 'user_referenced_by_records' };
  }
  return { ok: true };
}
