import { z } from 'zod';
import { UserPublicSchema } from './user.js';

/**
 * İşletme kodu girdisini normalize eder (ADR-042 K1.1 — iki taraflı normalize).
 *
 * **Burada durmasının sebebi:** kural üç yerde yaşıyor — mig 068 CHECK'i, aşağıdaki
 * zod regex'i ve istemcilerin girdi dönüşümü. Normalizasyon istemcilerde
 * kopyalansaydı web ve mobil sessizce çatallanırdı. Şemayla aynı dosyada duruyor
 * ki ikisi birlikte değişsin.
 *
 * 🔑 **Türkçe I ailesi ÖNCE eşlenir.** `"İ".toLowerCase()` JavaScript'te `i` +
 * BİRLEŞİK NOKTA (U+0307) üretir; `"I".toLowerCase()` `i` verir ama Türkçe doğru
 * karşılığı `ı`'dır. Kod salt ASCII olduğu için (mig 068) Türk klavyesinde `DİLAN`
 * yazan kullanıcı reddedilir ve **ekranda küçük harf yazdığını gördüğü için
 * sebebini bulamaz**. Ampirik: `DİLAN` → RED, `DILAN` → KABUL.
 *
 * ⚠️ Diğer Türkçe harfler (ş/ğ/ü/ö/ç) **bilerek eşlenmez** — eşlenseydi
 * kullanıcının yazdığı kod sessizce BAŞKA bir işletmeye gidebilirdi. Onlar
 * reddedilir ve kullanıcıya söylenir.
 */
export function normalizeTenantSlug(raw: string): string {
  return raw.trim().replace(/[İIı]/g, 'i').toLowerCase();
}

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  /**
   * İşletme kodu (ADR-042 K1) = `tenants.slug`. **Opsiyonel.**
   *
   * Yoksa sunucu varsayılan (legacy) tenant'a düşer → bugünkü davranışın birebir
   * aynısı, yani yayındaki web bundle'ı ve App Store'daki mobil sürüm bu alanı
   * hiç göndermeden çalışmaya devam eder.
   *
   * ⚠️ Bu alan şemaya eklenmeden istemci gönderse **sessizce düşerdi**: şema
   * `.strict()` değil, zod bilinmeyen anahtarı hata vermeden kırpar — sunucu
   * tarafında hiçbir iz kalmazdı.
   *
   * Biçim mig 068'deki `tenants_slug_format` CHECK'i ile AYNI olmalıdır; ikisi
   * ayrışırsa giriş sessizce bozulur. Salt ASCII olması bilinçli: `lower('İ')`
   * locale'e bağlıdır ve istemci/sunucu farklı sonuç üretebilir.
   */
  tenantSlug: z
    .string()
    .trim()
    .toLowerCase()
    .max(32)
    .regex(/^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/)
    .optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

// `expiresIn` (access TTL saniye) route'ta her zaman dönüyordu ama şemada
// eksikti (drift) — kapatıldı. `refreshToken` yalnız mobil akışta (X-Client:
// mobile) gelir; web HttpOnly cookie kullandığından body'de dönmez → optional.
export const LoginResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  user: UserPublicSchema,
  refreshToken: z.string().optional(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const TokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

// `.max(512)` savunma derinliği: gerçek refresh token base64url ~43 char;
// üst sınır, body-kaynaklı (mobil) refresh'te garbage/uzun girdiyi rotation
// lookup'ından önce eler (security-reviewer 2a).
export const RefreshRequestSchema = z.object({
  refreshToken: z.string().max(512).optional(),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

// `POST /auth/refresh` yanıtı. `refreshToken` yalnız body-kaynaklı (mobil)
// rotasyonda döner; cookie-kaynaklı (web) rotasyonda Set-Cookie ile döner,
// body'de yer almaz → optional. (ADR-002 §2 mobil body-refresh.)
export const RefreshResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  refreshToken: z.string().optional(),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

export const JwtPayloadSchema = z.object({
  sub: z.string().uuid(),
  role: z.enum(['admin', 'cashier', 'waiter', 'kitchen']),
  tenantId: z.string().uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type JwtPayload = z.infer<typeof JwtPayloadSchema>;
