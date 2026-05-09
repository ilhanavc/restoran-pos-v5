/**
 * Auth fixture setup (ADR-019 §4).
 *
 * `globalSetup` çağırır: admin + cashier için API'ye direct POST /auth/login
 * → access token + refresh cookie alınır → Playwright storageState formatında
 * `.auth/admin.json`, `.auth/cashier.json` üretilir.
 *
 * S1 hariç tüm senaryolar storageState ile başlar (login UI aşaması atlanır).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { request as playwrightRequest } from '@playwright/test';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  CASHIER_EMAIL,
  CASHIER_PASSWORD,
  KITCHEN_EMAIL,
  KITCHEN_PASSWORD,
  API_BASE_URL,
  WEB_BASE_URL,
  ADMIN_STORAGE_PATH,
  CASHIER_STORAGE_PATH,
  KITCHEN_STORAGE_PATH,
} from '../helpers/test-data';

interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: {
    id: string;
    tenantId: string;
    email: string;
    role: string;
    name: string;
    createdAt: string;
  };
}

interface StorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

/**
 * API'ye login → token + refresh cookie + Zustand persist payload.
 * Web origin için localStorage'a auth-storage anahtarı yazar; ön yükleme
 * sırasında useAuthStore re-hydrate eder.
 */
async function buildStorageStateFor(
  email: string,
  password: string,
  outPath: string,
): Promise<void> {
  const ctx = await playwrightRequest.newContext({ baseURL: API_BASE_URL });

  const res = await ctx.post('/auth/login', {
    data: { email, password },
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok()) {
    const body = await res.text();
    throw new Error(
      `[auth.setup] login failed for ${email}: ${res.status()} ${body}`,
    );
  }

  const json = (await res.json()) as LoginResponse;

  // API'nin set ettiği refresh cookie'sini al; web origin'ine map et
  // (preview ile aynı host olmadığı için cookie web origin'inde de yazılır;
  // refresh akışı E2E'de S1 sonrası UI'dan değil, storageState'ten gelir).
  const apiCookies = await ctx.storageState();

  const webOrigin = new URL(WEB_BASE_URL);

  const storage: StorageState = {
    cookies: apiCookies.cookies.map((c) => ({
      ...c,
      // Refresh cookie'yi web host'una da ata (path /auth, sameSite Strict)
      domain: webOrigin.hostname,
    })),
    origins: [
      {
        origin: WEB_BASE_URL.replace(/\/$/, ''),
        localStorage: [
          {
            name: 'auth-storage',
            value: JSON.stringify({
              state: { accessToken: json.accessToken, user: json.user },
              version: 0,
            }),
          },
        ],
      },
    ],
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(storage, null, 2), 'utf8');

  await ctx.dispose();
}

/**
 * Admin + cashier + kitchen storageState dosyalarını üretir.
 * `globalSetup` içinden çağrılır; idempotent (overwrite).
 */
export async function buildAuthStates(): Promise<void> {
  await buildStorageStateFor(ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_STORAGE_PATH);
  await buildStorageStateFor(
    CASHIER_EMAIL,
    CASHIER_PASSWORD,
    CASHIER_STORAGE_PATH,
  );
  await buildStorageStateFor(
    KITCHEN_EMAIL,
    KITCHEN_PASSWORD,
    KITCHEN_STORAGE_PATH,
  );
}
