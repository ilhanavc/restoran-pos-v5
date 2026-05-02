import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type {
  DB,
  OrderItemAttributeSnapshot,
  OrderItemSnapshot,
  ProductAttributeGroupsRepository,
} from '@restoran-pos/db';
import type {
  OrderItemCreateInput,
  SelectedAttributeInput,
} from '@restoran-pos/shared-types';
import { domainError } from '../../errors.js';

/**
 * PR-6 (ADR-013 §10 Karar 10.5) — sipariş kalemi başına özellik resolve.
 *
 * Sorumluluklar:
 *   1. `is_required=true` her grup için `selectedAttributes`'ta ≥1 option olmalı,
 *      yoksa 400 `MISSING_REQUIRED_ATTRIBUTE { groupId, groupName }`.
 *   2. `selection_type='single'` grupta >1 option seçimi → 400
 *      `INVALID_ATTRIBUTE_SELECTION` (group multi-but-single tutarsızlık).
 *   3. Seçilen `optionId`'lerin gerçekten o gruba ait olduğunu doğrula
 *      → yoksa 400 `INVALID_ATTRIBUTE_SELECTION`.
 *   4. Seçilen gruplar ürünün effective groups setine ait olmalı (ne ürünün ne
 *      kategorinin atadığı bir grup → 400 `INVALID_ATTRIBUTE_SELECTION`).
 *   5. `extra_price_cents` snapshot toplamı + group_name + option_name snapshot
 *      bilgilerini döndür.
 *
 * Caller (orders handler) toplam extra_price'ı `unit_price_cents`'e ekler;
 * snapshot satırları `OrderItemSnapshot.attributes` slot'una yerleşir; repo
 * `insertItemsAndRecalc` aynı transaction'da `order_item_attributes` insert eder.
 */
export interface ResolvedAttributesResult {
  /** Snapshot satırları (Migration 017 order_item_attributes payload). */
  snapshots: OrderItemAttributeSnapshot[];
  /** Tüm option `extra_price_cents`'in toplamı (signed). */
  extraPriceCents: number;
}

export async function resolveItemAttributes(
  db: Kysely<DB>,
  productAttrRepo: ProductAttributeGroupsRepository,
  tenantId: string,
  productId: string,
  selected: ReadonlyArray<SelectedAttributeInput>,
): Promise<ResolvedAttributesResult> {
  const effectiveGroups = await productAttrRepo.findEffectiveForProduct(
    tenantId,
    productId,
  );

  // Map<groupId, group> for O(1) lookup
  const groupMap = new Map(effectiveGroups.map((g) => [g.id, g]));

  // §10.5.1 — Required check (selected'ten bağımsız, group definition baz)
  for (const g of effectiveGroups) {
    if (g.is_required) {
      const has = selected.some((s) => s.groupId === g.id);
      if (!has) {
        throw domainError('MISSING_REQUIRED_ATTRIBUTE', 400, {
          groupId: g.id,
          groupName: g.name,
        });
      }
    }
  }

  if (selected.length === 0) {
    return { snapshots: [], extraPriceCents: 0 };
  }

  // §10.5.4 — selected groupId effective listede mi?
  for (const s of selected) {
    if (!groupMap.has(s.groupId)) {
      throw domainError('INVALID_ATTRIBUTE_SELECTION', 400, {
        reason: 'GROUP_NOT_ASSIGNED',
        groupId: s.groupId,
      });
    }
  }

  // §10.5.2 — single grupta >1 seçim
  const perGroupCounts = new Map<string, number>();
  for (const s of selected) {
    perGroupCounts.set(s.groupId, (perGroupCounts.get(s.groupId) ?? 0) + 1);
  }
  for (const [gid, count] of perGroupCounts.entries()) {
    const g = groupMap.get(gid)!;
    if (g.selection_type === 'single' && count > 1) {
      throw domainError('INVALID_ATTRIBUTE_SELECTION', 400, {
        reason: 'SINGLE_GROUP_MULTIPLE_OPTIONS',
        groupId: gid,
        groupName: g.name,
      });
    }
  }

  // §10.5.3 — option fetch (bulk). Soft-deleted opsiyonlar düşürülür;
  // group_id ↔ option_id bütünlüğü WHERE içinde IN ile sağlanır + post-check.
  const optionIds = selected.map((s) => s.optionId);
  const rows = await db
    .selectFrom('attribute_options')
    .select([
      'id',
      'group_id',
      'name',
      'extra_price_cents',
    ])
    .where('tenant_id', '=', tenantId)
    .where('deleted_at', 'is', null)
    .where('id', 'in', optionIds)
    .execute();
  const optionMap = new Map(rows.map((r) => [r.id, r]));

  const snapshots: OrderItemAttributeSnapshot[] = [];
  let total = 0;
  for (const s of selected) {
    const opt = optionMap.get(s.optionId);
    if (opt === undefined || opt.group_id !== s.groupId) {
      throw domainError('INVALID_ATTRIBUTE_SELECTION', 400, {
        reason: 'OPTION_NOT_IN_GROUP',
        groupId: s.groupId,
        optionId: s.optionId,
      });
    }
    const g = groupMap.get(s.groupId)!;
    snapshots.push({
      id: randomUUID(),
      attributeGroupId: s.groupId,
      attributeOptionId: s.optionId,
      groupNameSnapshot: g.name,
      optionNameSnapshot: opt.name,
      extraPriceCentsSnapshot: opt.extra_price_cents,
    });
    total += opt.extra_price_cents;
  }

  return { snapshots, extraPriceCents: total };
}

/**
 * Composite hash — UI'ın 4-tuple deduplication için kullandığı `attributesHash`
 * ile bire bir aynı algoritma. Sıralama deterministik (groupId, optionId).
 * Dış tüketici (frontend) için referans; backend doğrulama için kullanılmıyor.
 */
export function attributesHash(
  selected: ReadonlyArray<SelectedAttributeInput>,
): string {
  const sorted = [...selected]
    .map((s) => ({ groupId: s.groupId, optionId: s.optionId }))
    .sort((a, b) =>
      a.groupId === b.groupId
        ? a.optionId.localeCompare(b.optionId)
        : a.groupId.localeCompare(b.groupId),
    );
  return JSON.stringify(sorted);
}

/**
 * Caller convenience — OrderItemSnapshot'a attribute snapshot + extra price'ı
 * yapıştır. `unit_price_cents` zaten resolveItemSnapshots'ta product.price'tan
 * geldi; bu wrapper extra_price ekler ve total_cents'i yeniden hesaplar.
 *
 * Caller sözleşmesi: `snapshot` daha önce resolveItemSnapshots'tan döndü;
 * `attributes` resolveItemAttributes sonucu.
 */
export function applyAttributeSnapshot(
  snapshot: OrderItemSnapshot,
  resolved: ResolvedAttributesResult,
): OrderItemSnapshot {
  if (resolved.snapshots.length === 0 && resolved.extraPriceCents === 0) {
    return snapshot;
  }
  const newUnit = snapshot.unitPriceCents + resolved.extraPriceCents;
  return {
    ...snapshot,
    unitPriceCents: newUnit,
    totalCents: newUnit * snapshot.quantity,
    attributes: resolved.snapshots,
  };
}

/** Helper: unique product_id listesi (handler'da effective groups batch için). */
export function uniqueProductIds(
  inputs: ReadonlyArray<OrderItemCreateInput>,
): string[] {
  return [...new Set(inputs.map((i) => i.productId))];
}
