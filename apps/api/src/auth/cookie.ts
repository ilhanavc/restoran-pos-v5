import type { Response } from 'express';

const COOKIE_NAME = 'refresh_token';
// Public path — Nginx `/api` prefix DAHİL. Tarayıcı isteği `/api/auth/...`'a atar;
// Nginx `/api` strip'i Set-Cookie `Path`'ini YENİDEN YAZMAZ → cookie path'i
// API-iç route (`/auth/...`) değil PUBLIC path olmalı, aksi halde tarayıcı cookie'yi
// göndermez → her reload'da /login (prod-only bug, Session 82 fix).
//
// ⚠️ S137 (ADR-002 Amd6): path eskiden `/api/auth/refresh` idi — yani TAM OLARAK
// refresh ucuna kilitliydi. Tarayıcı bir cookie'yi yalnız istek yolu `Path` ile
// eşleşirse gönderir, `/api/auth/logout` eşleşmiyordu → `/logout` cookie'yi HİÇ
// almıyor, `revokeRefreshToken` HİÇ çağrılmıyor, uç 200 dönüyordu. Prod kanıtı:
// 4483 satırda `revoked_reason='logout'` sayısı **0** ve `POST /logout` 3 ms
// (DB turu olan refresh 12 ms). Çıkış sonrası token 30 gün geçerli kalıyordu.
// `/api/auth` hâlâ PUBLIC prefix'li → S82 dersi korunur, yalnız bir seviye yukarı.
const REFRESH_PATH = '/api/auth';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Eski (daraltılmış) path. Yalnız GEÇİŞ için duruyor.
 *
 * 🔴 NEDEN SİLİNEMEZ — bu olmadan düzeltme bug'dan DAHA KÖTÜ olur (ADR-002 §12.4):
 *   1. Deploy öncesi tarayıcıda cookie A var: `Path=/api/auth/refresh`, değer T1.
 *   2. İlk refresh: A gider, rotate olur → T2; yeni kod `Path=/api/auth` ile B'yi
 *      yazar. A SİLİNMEZ (cookie silme `Path` TAM eşleşmesi ister) → aynı isimli
 *      iki cookie.
 *   3. Sonraki refresh: ikisi birlikte gider. RFC 6265 §5.4 daha UZUN path'i öne
 *      koyar → A (eski T1) önce.
 *   4. `cookie@0.7.2` parse'ı `// only assign once` ile ÇALIŞIR: ilk gelen kazanır,
 *      sonraki sessizce atılır → sunucu T1'i görür.
 *   5. T1 zaten `rotated` → reuse detection → `revokeFamilyAll('reuse_detected')`
 *      → kullanıcının CANLI OTURUMU DÜŞER + güvenlik alarmı çalar.
 * Her set/clear'da eski path `Max-Age=0` ile silindiği için (2) hiç oluşmaz:
 * geçiş ilk login/refresh/logout'ta kendi kendini onarır.
 *
 * ⏳ KALDIRMA: en erken **2026-11-15**. Refresh TTL 30 gün (`THIRTY_DAYS_MS`) →
 * 2026-10-08 deploy'undan 30 gün sonra hiçbir tarayıcıda eski path'li geçerli
 * cookie kalmaz. Daha ÖNCE kaldırılırsa eski cookie'si olan tarayıcılar yukarıdaki
 * 5 adımlı zincire girer.
 */
const LEGACY_REFRESH_PATH = '/api/auth/refresh';

/** Geçiş: eski path'teki cookie'yi aynı yanıtta sil. Yukarıdaki docblock'a bakın. */
function clearLegacyPathCookie(res: Response): void {
  res.cookie(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'strict',
    path: LEGACY_REFRESH_PATH,
    maxAge: 0,
  });
}

/**
 * Refresh token cookie. ADR-002:
 * - HttpOnly: JS okuyamaz (XSS koruması)
 * - Secure: prod'da HTTPS şart
 * - SameSite=Strict: cross-site CSRF koruması
 * - Path=/api/auth: cookie `/api/auth/*` uçlarına gider (refresh + logout).
 *   Yalnız refresh'e daraltmak logout'u sessizce kırıyordu (Amd6).
 */
export function setRefreshCookie(res: Response, plain: string): void {
  res.cookie(COOKIE_NAME, plain, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'strict',
    path: REFRESH_PATH,
    maxAge: THIRTY_DAYS_MS,
  });
  clearLegacyPathCookie(res);
}

export function clearRefreshCookie(res: Response): void {
  res.cookie(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'strict',
    path: REFRESH_PATH,
    maxAge: 0,
  });
  clearLegacyPathCookie(res);
}

export const REFRESH_COOKIE_NAME = COOKIE_NAME;
