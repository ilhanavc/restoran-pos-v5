import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

/**
 * App display settings (ADR-026 Amendment 2026-06-29 C/D).
 *
 * Currently a single preference: how many columns the Order screen's product
 * grid uses (2 = roomy/reference-like, 3 = denser). It is a pure display
 * preference — no authority surface — so it does not violate the K6 gating of
 * operational/admin settings. Persisted via `expo-secure-store` (the same store
 * the auth tokens use; not sensitive, but avoids adding an AsyncStorage native
 * dependency) and hydrated on boot, mirroring the auth store pattern.
 */

const PRODUCT_COLUMNS_KEY = 'settings.productColumns';

export type ProductColumns = 2 | 3;

/** Default product grid columns (ADR-026 K2 "3 sütun" spirit). */
const DEFAULT_PRODUCT_COLUMNS: ProductColumns = 3;

interface SettingsState {
  productColumns: ProductColumns;
  /** Persist + apply the product grid column count. */
  setProductColumns: (columns: ProductColumns) => Promise<void>;
  /** Read the persisted preference on app start (best-effort). */
  hydrate: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  productColumns: DEFAULT_PRODUCT_COLUMNS,

  setProductColumns: async (columns) => {
    set({ productColumns: columns });
    await SecureStore.setItemAsync(PRODUCT_COLUMNS_KEY, String(columns));
  },

  hydrate: async () => {
    const stored = await SecureStore.getItemAsync(PRODUCT_COLUMNS_KEY);
    if (stored === '2' || stored === '3') {
      set({ productColumns: Number(stored) as ProductColumns });
    }
  },
}));
