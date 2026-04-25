/**
 * Menu domain policy.
 *
 * # Why is this module minimal? (1 function only)
 *
 * Phase 1.5 forensic verdict (audit Katman 1): charter Phase 1 listesi
 * "Menu/Payment/User entity ve policy'leri" maddesi yazılmadı
 * (atlama). Phase 1.5'te eksik 3 entity policy yazıldı.
 *
 * Menu için domain-rules.md'de TEK explicit business rule var
 * (Sinyal #7, sat 112-114): "Referans varsa soft-delete, yoksa
 * hard-delete." Diğer Menu konuları başka katmanlarda çözülmüş:
 *
 *   - Para birimi (cents): MoneyCentsSchema (shared-types/money.ts)
 *   - Snapshot invariant: order_items DB kolonları (ADR-003 §7)
 *   - Soft delete pattern: deleted_at + partial index (ADR-003 §8)
 *   - FK kategori-ürün: 000_init.sql constraint
 *   - Print routing: ADR-004 (Print Agent)
 *
 * Geriye Menu-spesifik tek kural kaldı: canHardDeleteProduct.
 *
 * Phase 2 Menu management endpoint'leri (POST/PATCH/DELETE
 * /menu/products + /menu/categories) yazılırken ek business rule'lar
 * ortaya çıkarsa bu modül genişletilir. Şu an YAGNI.
 *
 * # Source of truth
 * docs/v3-reference/domain-rules.md "Menü / Ürün" (sat 112-114)
 *
 * # Caller integration (Phase 2)
 * Repository layer 'hasReferencingOrderItems' boolean'ını DB
 * sorgusuyla hesaplar:
 *   SELECT EXISTS (SELECT 1 FROM order_items WHERE product_id = $1)
 * Soft-deleted order_items DAHİL — geçmiş sipariş hâlâ "referans"
 * (ADR-003 §8 forensic kuralı).
 */

export type CanHardDeleteProductReason = 'product_referenced_by_order_items';

export type CanHardDeleteProductResult =
  | { ok: true }
  | { ok: false; reason: CanHardDeleteProductReason };

/**
 * Decides whether a product can be hard-deleted.
 *
 * Rule (domain-rules.md Sinyal #7): a product that is referenced by
 * any order_item (including soft-deleted ones) must be soft-deleted
 * to preserve historical order integrity. Otherwise it can be
 * physically removed.
 */
export function canHardDeleteProduct(input: {
  hasReferencingOrderItems: boolean;
}): CanHardDeleteProductResult {
  if (input.hasReferencingOrderItems) {
    return { ok: false, reason: 'product_referenced_by_order_items' };
  }
  return { ok: true };
}
