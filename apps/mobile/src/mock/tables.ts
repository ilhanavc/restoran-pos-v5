import type { Area } from '@restoran-pos/shared-types';

import type { ApiTable } from '../api/tables';

/**
 * Mock tables + areas backend (ADR-026 K8).
 *
 * Lets the Masalar screen run on a physical phone with no live API. Two areas
 * (Salon, Bahçe) with a mix of empty and occupied tables — including one open
 * for 75 minutes so the >= 60 min "long open" (red) state is always visible.
 * Replaced by the real `GET /tables` / `GET /areas` transport in PR-5d
 * (USE_MOCK = false). Values are fabricated demo data — no PII, never a backend.
 *
 * Money is integer kuruş; `active_order_started_at` is computed relative to
 * `Date.now()` at call time so elapsed-time labels (and the long-open colour
 * rule) behave correctly whenever the app is opened.
 */

const TENANT_ID = '00000000-0000-4000-8000-0000000000ff';
const MOCK_DELAY_MS = 400;
const NOW_ISO = '2026-06-28T12:00:00.000Z';

const AREA_SALON_ID = '00000000-0000-4000-8000-00000000a001';
const AREA_BAHCE_ID = '00000000-0000-4000-8000-00000000a002';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** ISO-8601 UTC timestamp `minutes` ago, relative to the device clock. */
function minutesAgoIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function makeAreas(): Area[] {
  return [
    {
      id: AREA_SALON_ID,
      tenantId: TENANT_ID,
      name: 'Salon',
      sortOrder: 0,
      deletedAt: null,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    },
    {
      id: AREA_BAHCE_ID,
      tenantId: TENANT_ID,
      name: 'Bahçe',
      sortOrder: 1,
      deletedAt: null,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    },
  ];
}

/** Base scaffold for an empty table; occupied fields default to NULL. */
function emptyTable(
  idSuffix: string,
  code: string,
  areaId: string,
): ApiTable {
  return {
    id: `00000000-0000-4000-8000-0000000000${idSuffix}`,
    tenant_id: TENANT_ID,
    code,
    capacity: 4,
    area_id: areaId,
    status: 'available',
    deleted_at: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    active_order_id: null,
    active_order_total_cents: null,
    active_order_paid_total_cents: null,
    active_order_started_at: null,
    active_waiter_name: null,
  };
}

/** Mark an empty-table scaffold as occupied with an active order. */
function occupy(
  table: ApiTable,
  orderIdSuffix: string,
  totalCents: number,
  openedMinutesAgo: number,
  waiterName: string,
): ApiTable {
  return {
    ...table,
    status: 'occupied',
    active_order_id: `00000000-0000-4000-8000-0000000000${orderIdSuffix}`,
    active_order_total_cents: totalCents,
    active_order_paid_total_cents: null,
    active_order_started_at: minutesAgoIso(openedMinutesAgo),
    active_waiter_name: waiterName,
  };
}

function makeTables(): ApiTable[] {
  return [
    // Salon — 5 tables: 2 occupied (one long-open), 3 empty.
    occupy(emptyTable('b1', 'Masa 1', AREA_SALON_ID), 'c1', 23_400, 37, 'Ahmet Garson'),
    emptyTable('b2', 'Masa 2', AREA_SALON_ID),
    occupy(emptyTable('b3', 'Masa 3', AREA_SALON_ID), 'c3', 8_500, 75, 'Mehmet Garson'),
    emptyTable('b4', 'Masa 4', AREA_SALON_ID),
    emptyTable('b5', 'Masa 5', AREA_SALON_ID),
    // Bahçe — 4 tables: 1 occupied, 3 empty.
    emptyTable('b6', 'Masa 6', AREA_BAHCE_ID),
    occupy(emptyTable('b7', 'Masa 7', AREA_BAHCE_ID), 'c7', 14_750, 12, 'Ahmet Garson'),
    emptyTable('b8', 'Masa 8', AREA_BAHCE_ID),
    emptyTable('b9', 'Masa 9', AREA_BAHCE_ID),
  ];
}

/** Simulate `GET /areas` (sorted by `sortOrder` ASC, as the API returns). */
export async function mockGetAreas(): Promise<Area[]> {
  await delay(MOCK_DELAY_MS);
  return makeAreas();
}

/** Simulate `GET /tables` with the active-order projection joined in. */
export async function mockGetTables(): Promise<ApiTable[]> {
  await delay(MOCK_DELAY_MS);
  return makeTables();
}
