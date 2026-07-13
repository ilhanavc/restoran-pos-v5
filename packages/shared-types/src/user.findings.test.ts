import { describe, it, expect } from 'vitest';
import { UserCreateApiRequestSchema, UserUpdateSchema, UserPasswordChangeSchema } from './user.js';

/**
 * QA — Blok 2 / Hat C — KASITLI KIRMIZI testler.
 *
 * Bulgu: SD-T-C-03 [HIGH] [SEC] user.ts — `name`/`email` yazma-yolu
 * (write-path) alanlarında ÜST SINIR yok.
 *
 * Kanıt:
 *   - `packages/shared-types/src/user.ts:20` `UserCreateSchema.name: z.string().min(1)`
 *   - `packages/shared-types/src/user.ts:33` `UserCreateApiRequestSchema.name: z.string().min(1)`
 *   - `packages/shared-types/src/user.ts:47` `UserUpdateSchema.name: z.string().min(1).optional()`
 *   - `packages/shared-types/src/user.ts:17,30,45` `email: z.string().email()` — `.email()`
 *     format kontrolü yapar ama UZUNLUK sınırlamaz.
 *   - DB: `packages/db/migrations/000_init.sql` `users` tablosunda `name`/`email`
 *     kolonu `TEXT` (Postgres TEXT sınırsız) — yani DB katmanında da BACKSTOP yok.
 *
 * Senaryo: POST /users veya PATCH /users/:id ile `name`/`email` alanına
 * on binlerce karakterlik bir string gönderilirse: zod kabul eder, TEXT
 * kolonu kabul eder → satır DB'de kalıcı olarak şişer. Toplu/otomatik
 * istek (rate-limit varsa bile) depolama şişmesi + UI'da render/scroll
 * sorunu + index/like sorgu maliyeti yaratabilir. Hiçbir katmanda üst
 * sınır YOK — CLAUDE.md "Asla `any` bırakma" / strict tip disiplinine
 * rağmen bu iki alan fiilen sınırsız.
 *
 * Etki: Depolama şişmesi / DoS potansiyeli; diğer benzer alanlar
 * (customers.fullName max(120), menu.name max(64/128)) örnek pattern
 * izlemiyor.
 *
 * Öneri: `name` için `.max(120)` (customers.fullName paritesi),
 * `email` için `.max(254)` (RFC 5321 pratik üst sınır) ekle.
 * Etiket: MVP-fix (güvenlik/depolama; düşük efor).
 *
 * ---
 *
 * Bulgu: SD-T-C-04 [HIGH] [SEC] user.ts — `password`/`newPassword`/
 * `currentPassword` alanlarında ÜST SINIR yok.
 *
 * Kanıt: `user.ts:18` `password: z.string().min(10)`,
 * `user.ts:62-63` `currentPassword: z.string().min(1).optional()`,
 * `newPassword: z.string().min(10)`.
 *
 * Senaryo: Login/register/password-change endpoint'ine on binlerce
 * karakterlik bir "password" gönderilirse, backend'in bcrypt.hash()
 * çağrısı bu devasa string'i işlemeye çalışır. bcrypt algoritması girdi
 * boyutuna göre CPU maliyeti taşır (her ne kadar bcrypt 72 byte'ta kesse
 * de, kesme İŞLEMDEN SONRA olur — string önce belleğe alınır/işlenir).
 * Bu, düşük maliyetli bir CPU/bellek tüketim (DoS) vektörüdür; endüstri
 * standardı (OWASP) password alanlarına makul bir üst sınır (örn. 128)
 * koymayı önerir.
 *
 * Öneri: `.max(128)` ekle (bcrypt 72-byte pratik sınırının üstünde,
 * makul kullanıcı deneyimi payı bırakarak).
 * Etiket: MVP-fix (güvenlik; düşük efor, auth akışını etkilemez).
 *
 * Bu testler KASITLI KIRMIZI — doğru davranışı (üst sınır aşımı
 * reddedilmeli) assert eder; mevcut şema sınırsız olduğu için başarısız
 * olur.
 */
describe('SD-T-C-03 user.ts — name/email üst sınırı olmalı (KASITLI KIRMIZI)', () => {
  const base = { email: 'ahmet@dilanpide.com', password: 'Sifre12345', role: 'waiter' as const, name: 'Ahmet Yılmaz' };

  it('SD-T-C-03a UserCreateApiRequestSchema — 10.000 karakterlik name reddedilmeli', () => {
    const r = UserCreateApiRequestSchema.safeParse({ ...base, name: 'A'.repeat(10_000) });
    expect(r.success).toBe(false);
  });

  it('SD-T-C-03b UserCreateApiRequestSchema — 500+ karakterlik email reddedilmeli', () => {
    const longEmail = `${'a'.repeat(500)}@example.com`;
    const r = UserCreateApiRequestSchema.safeParse({ ...base, email: longEmail });
    expect(r.success).toBe(false);
  });

  it('SD-T-C-03c UserUpdateSchema — 10.000 karakterlik name reddedilmeli', () => {
    const r = UserUpdateSchema.safeParse({ name: 'A'.repeat(10_000) });
    expect(r.success).toBe(false);
  });
});

describe('SD-T-C-04 user.ts — password alanları üst sınıra sahip olmalı (KASITLI KIRMIZI)', () => {
  it('SD-T-C-04a UserCreateApiRequestSchema — 10.000 karakterlik password reddedilmeli', () => {
    const r = UserCreateApiRequestSchema.safeParse({
      email: 'ahmet@dilanpide.com',
      password: 'A'.repeat(10_000),
      role: 'waiter',
      name: 'Ahmet Yılmaz',
    });
    expect(r.success).toBe(false);
  });

  it('SD-T-C-04b UserPasswordChangeSchema — 10.000 karakterlik newPassword reddedilmeli', () => {
    const r = UserPasswordChangeSchema.safeParse({ newPassword: 'A'.repeat(10_000) });
    expect(r.success).toBe(false);
  });
});
