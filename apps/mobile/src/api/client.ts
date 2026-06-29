import type {
  Area,
  Category,
  LoginRequest,
  LoginResponse,
  ProductWithVariants,
} from '@restoran-pos/shared-types';
import { USE_MOCK } from '../config';
import { mockLogin } from '../mock/auth';
import { mockGetMenuCategories, mockGetMenuProducts } from '../mock/menu';
import { mockGetActiveOrderForTable } from '../mock/orders';
import { mockGetAreas, mockGetTables } from '../mock/tables';
import type { ApiActiveOrder } from './orders';
import type { ApiTable } from './tables';

/**
 * API client (ADR-026 K8).
 *
 * Thin seam between the screens and the network. While `USE_MOCK` is `true` it
 * delegates to the in-process mock layer; flipping the flag (PR-5d) swaps in a
 * real `fetch` against `API_BASE_URL` without touching any screen. PR-5a needs
 * `login`; PR-5b adds the read-only table board (`getTables` / `getAreas`).
 */

/** Authenticate the waiter. Throws on invalid credentials or transport error. */
export async function login(request: LoginRequest): Promise<LoginResponse> {
  if (USE_MOCK) {
    return mockLogin(request);
  }
  // Real transport lands in PR-5d (fetch against API_BASE_URL + zod parse).
  throw new Error('Real API transport not implemented yet (PR-5d).');
}

/** Fetch the table board with the active-order projection (`GET /tables`). */
export async function getTables(): Promise<ApiTable[]> {
  if (USE_MOCK) {
    return mockGetTables();
  }
  // Real transport lands in PR-5d (fetch against API_BASE_URL + zod parse).
  throw new Error('Real API transport not implemented yet (PR-5d).');
}

/** Fetch the salon areas used for the region pills (`GET /areas`). */
export async function getAreas(): Promise<Area[]> {
  if (USE_MOCK) {
    return mockGetAreas();
  }
  // Real transport lands in PR-5d (fetch against API_BASE_URL + zod parse).
  throw new Error('Real API transport not implemented yet (PR-5d).');
}

/** Fetch the menu categories for the colour grid (`GET /menu/categories`). */
export async function getMenuCategories(): Promise<Category[]> {
  if (USE_MOCK) {
    return mockGetMenuCategories();
  }
  // Real transport lands in PR-5d (fetch against API_BASE_URL + zod parse).
  throw new Error('Real API transport not implemented yet (PR-5d).');
}

/** Fetch the product catalog with nested variants (`GET /menu/products`). */
export async function getMenuProducts(): Promise<ProductWithVariants[]> {
  if (USE_MOCK) {
    return mockGetMenuProducts();
  }
  // Real transport lands in PR-5d (fetch against API_BASE_URL + zod parse).
  throw new Error('Real API transport not implemented yet (PR-5d).');
}

/**
 * Fetch the active order (saved items) for a table, or `null` when empty
 * (`GET /orders?tableId=X`, client-side active filter — web parity).
 */
export async function getActiveOrderForTable(
  tableId: string,
): Promise<ApiActiveOrder | null> {
  if (USE_MOCK) {
    return mockGetActiveOrderForTable(tableId);
  }
  // Real transport lands in PR-5d (fetch against API_BASE_URL + zod parse).
  throw new Error('Real API transport not implemented yet (PR-5d).');
}
