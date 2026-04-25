import type { Response } from 'express';

const COOKIE_NAME = 'refresh_token';
const REFRESH_PATH = '/auth/refresh';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Refresh token cookie. ADR-002:
 * - HttpOnly: JS okuyamaz (XSS koruması)
 * - Secure: prod'da HTTPS şart
 * - SameSite=Strict: cross-site CSRF koruması
 * - Path=/auth/refresh: cookie sadece refresh endpoint'ine gider
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
