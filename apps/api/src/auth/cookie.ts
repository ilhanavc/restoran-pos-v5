import type { Response } from 'express';

const COOKIE_NAME = 'refresh_token';
// Public path — Nginx `/api` prefix DAHİL. Tarayıcı refresh'i `/api/auth/refresh`'e
// atar; Nginx `/api` strip'i Set-Cookie `Path`'ini YENİDEN YAZMAZ → cookie path'i
// API-iç route (`/auth/refresh`) değil PUBLIC path olmalı, aksi halde tarayıcı cookie'yi
// göndermez → her reload'da /login (prod-only bug, Session 82 fix).
const REFRESH_PATH = '/api/auth/refresh';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Refresh token cookie. ADR-002:
 * - HttpOnly: JS okuyamaz (XSS koruması)
 * - Secure: prod'da HTTPS şart
 * - SameSite=Strict: cross-site CSRF koruması
 * - Path=/api/auth/refresh: cookie yalnız (public) refresh endpoint'ine gider
 */
export function setRefreshCookie(res: Response, plain: string): void {
  res.cookie(COOKIE_NAME, plain, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'strict',
    path: REFRESH_PATH,
    maxAge: THIRTY_DAYS_MS,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.cookie(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'strict',
    path: REFRESH_PATH,
    maxAge: 0,
  });
}

export const REFRESH_COOKIE_NAME = COOKIE_NAME;
