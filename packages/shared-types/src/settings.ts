import { z } from 'zod';

/**
 * Tenant ayarları şeması — Sprint 6 Görev 24 + ADR-015.
 *
 * MVP kapsam (kapsam kilidi):
 *   - `timezone` (IANA, örn. 'Europe/Istanbul')
 *   - `tenantName` read-only — tenants JOIN ile döner, PATCH'te yazılmaz
 *
 * ADR-015: `businessDayCutoffHour` Migration 026 ile DROP edildi
 * (anasayfa raporları takvim günü kullanır; cutoff terkedildi).
 *
 * Fiş üst/alt bilgisi (telefon, adres dahil) ADR-045 ile aşağıdaki
 * `ReceiptSettings*` şemalarında. Vergi no / KDV oranları hâlâ açık
 * (ADR-045 K10; KDV `shared-domain/tax.ts` sabit).
 *
 * DB şema referansı: `packages/db/migrations/000_init.sql:128-143`.
 * `tenant_settings` PK = `tenant_id` (1-to-1 with tenants).
 */

/**
 * IANA timezone format — tek-parça (örn. 'UTC') VEYA `Continent/City`
 * (örn. 'Europe/Istanbul'). Loose regex; son hat DB trigger `validate_timezone`
 * (000_init.sql:54-63) pg_timezone_names lookup ile reject eder. "Mars/Olympus"
 * formatı geçer ama trigger 23514 atar → repo
 * `RepositoryError('check', 'SETTINGS_INVALID_TIMEZONE')`.
 */
const IANA_TZ_REGEX = /^[A-Za-z_]+(?:\/[A-Za-z_]+)*$/;

/**
 * GET /settings response item — admin + cashier (ADR-002 §6 amendment, Sprint 6).
 * `tenantName` tenants tablosundan JOIN ile gelir (read-only).
 */
export const TenantSettingsSchema = z.object({
  tenantId: z.string().uuid(),
  tenantName: z.string(),
  timezone: z.string(),
  /** ADR-016 §11 Karar 11.3: Caller ID popup'ı tek istasyona düşer; null = atanmamış. */
  callerIdStationUserId: z.string().uuid().nullable(),
  /**
   * ADR-016 §11: Kurumsal hat / call-center prefix'leri (regex). Eşleşen ham
   * numaralar bridge'den gelse de log'a yazılmaz, popup tetiklenmez.
   */
  callerIdBypassPatterns: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TenantSettings = z.infer<typeof TenantSettingsSchema>;

/**
 * PATCH /settings request body — admin only.
 *
 * Partial update: en az bir alan dolu olmalı (`refine`). Boş body 400
 * VALIDATION_ERROR. Zod regex erken yakalar invalid IANA format'ı; DB
 * trigger son hat ("Mars/Olympus" gibi syntactic-pass ama TZ db'de yok).
 *
 * ADR-015: `businessDayCutoffHour` MVP kapsamından çıkarıldı (Migration 026).
 */
export const TenantSettingsUpdateSchema = z
  .object({
    timezone: z
      .string()
      .regex(IANA_TZ_REGEX, 'invalid IANA timezone')
      .optional(),
    /** ADR-016 §11 Karar 11.3 — null = istasyon ataması temizle. */
    callerIdStationUserId: z.string().uuid().nullable().optional(),
    /** ADR-016 §11 — bypass regex listesi tam değiştirme (PATCH semantik). */
    callerIdBypassPatterns: z.array(z.string().min(1).max(200)).max(50).optional(),
  })
  .refine(
    (data) =>
      data.timezone !== undefined ||
      data.callerIdStationUserId !== undefined ||
      data.callerIdBypassPatterns !== undefined,
    { message: 'patch:empty_body' },
  );
export type TenantSettingsUpdate = z.infer<typeof TenantSettingsUpdateSchema>;

/**
 * ADR-045 K6 — işletmenin kendi fiş metni (üst/alt bilgi satırları) için
 * TEK KAYNAK sınırlar. API doğrulayıcısı (PR-2), web sayacı (PR-2) ve render
 * anındaki doğrulama (`resolveReceiptText`, shared-domain) AYNI sabiti okur;
 * DB'de ikinci bir sayı YOK (mig 072 başlığı).
 *
 * 📏 Sınır ÖLÇÜLEREK seçildi (2026-11-17, DejaVu Sans, fişin `SIZES.meta` =
 * 26px puntosu, kullanılabilir genişlik 576 − 2×20 = 536px):
 *   - gerçekçi bir adres/telefon satırı (~35 karakter) ≈ 490px → TEK satır;
 *   - en geniş izinli karakter (`@` 26px, `W` 25.7px) satıra en fazla 20 sığar
 *     → 40 karakterlik en kötü satır kâğıtta EN FAZLA 2 satıra kayar.
 * Taşan satır kaydırılır (`wrapToWidth`), hiçbir karakter düşmez; sınırın işi
 * kaybı değil fişin boyunu bağlamaktır. Bu iki iddia
 * `apps/api/src/print/templates/receipt-text.test.ts` ("kalibrasyon") gerçek
 * çiziciyle ölçülür — font ya da punto değişirse o test kırmızıya döner.
 */
export const RECEIPT_TEXT_LIMITS = {
  /** Üst bilgi (işletme adının altı) en fazla kaç satır. */
  maxHeaderLines: 4,
  /** Alt bilgi (gömülü kapanışın yerine) en fazla kaç satır. */
  maxFooterLines: 4,
  /** Bir satırdaki en fazla karakter (Unicode kod noktası). */
  maxCharsPerLine: 40,
} as const;

/**
 * ADR-045 K6.4/K6.5 — izinli karakter kümesi (POZİTİF izin listesi).
 *
 * "Şu desen eşleşmiyorsa güvenli" bir negatif güvence olurdu; burada tersine
 * YALNIZ listedekiler geçer: Latin + Türkçe harfler (şapkalı â/î/û dahil),
 * rakam, boşluk ve yaygın noktalama + ₺. Hepsi fişin fontunda (DejaVu Sans)
 * kesin vardır → "görünmez karakter / boş kutu" sınıfı doğmaz. Kontrol
 * karakterleri, sekme, satır sonu ve ESC/GS baytları listede OLMADIĞI için
 * kendiliğinden reddedilir; satır sonu yalnız dizi elemanı olarak ifade edilir.
 */
const RECEIPT_LINE_ALLOWED = /^[A-Za-z0-9ÇĞİÖŞÜçğıöşüÂÎÛâîû .,:;\-/()'"&+#@!?%₺*_=]+$/u;

/** Tek bir fiş metni satırı. */
export const ReceiptLineSchema = z
  .string()
  .min(1, 'receipt_line:empty')
  .refine((s) => [...s].length <= RECEIPT_TEXT_LIMITS.maxCharsPerLine, {
    message: 'receipt_line:too_long',
  })
  .refine((s) => RECEIPT_LINE_ALLOWED.test(s), {
    message: 'receipt_line:invalid_char',
  })
  .refine((s) => s.trim().length > 0, { message: 'receipt_line:blank' });

/** Üst bilgi satırları — boş dizi = "ek satır yok". */
export const ReceiptHeaderLinesSchema = z
  .array(ReceiptLineSchema)
  .max(RECEIPT_TEXT_LIMITS.maxHeaderLines, 'receipt_header:too_many_lines');

/**
 * Alt bilgi satırları — ⚠️ boş dizi = "HİÇ alt bilgi basma" (işletmenin
 * bilinçli tercihi); bu, `null`'dan (= şablonun gömülü alt bilgisi) AYRI bir
 * niyettir (ADR-045 K3.2).
 */
export const ReceiptFooterLinesSchema = z
  .array(ReceiptLineSchema)
  .max(RECEIPT_TEXT_LIMITS.maxFooterLines, 'receipt_footer:too_many_lines');

/**
 * ADR-045 PR-2 (as-built) — girişte NFC normalize. İzin listesi Türkçe
 * harfleri ÖNCEDEN BİRLEŞİK biçimde bekler; bazı klavyeler (macOS/iPadOS)
 * "ğ"yi "g + birleşen breve" olarak gönderir ve aksi hâlde `invalid_char`
 * ile reddedilirdi. Yalnız YAZMA yolunda uygulanır; render doğrulaması
 * (`ReceiptLineSchema`) değişmez — DB'ye zaten NFC hâli yazılır.
 */
const toNfc = (v: unknown): unknown => (typeof v === 'string' ? v.normalize('NFC') : v);
const ReceiptLineInputSchema = z.preprocess(toNfc, ReceiptLineSchema);

/**
 * GET /settings/receipt yanıtı — admin only (ADR-045 K2/K7). Bu alanlar
 * `GET /settings`'e (kasiyere açık) BİLEREK eklenmez.
 *   - `null`  → şablonun gömülü metni (varsayılan)
 *   - `[]`    → alt bilgi için "hiç basma"; üst bilgi için "ek satır yok"
 */
export const ReceiptSettingsSchema = z.object({
  receiptHeaderLines: z.array(z.string()).nullable(),
  receiptFooterLines: z.array(z.string()).nullable(),
  packingAutoPrintEnabled: z.boolean(),
});
export type ReceiptSettings = z.infer<typeof ReceiptSettingsSchema>;

/**
 * PUT /settings/receipt gövdesi — TAM değiştirme (üç alan da zorunlu).
 * "Varsayılana dön" = iki metin alanı `null` (K9: satır ASLA silinmez).
 * Taşma/izinsiz karakter → 400 VALIDATION_ERROR; sessiz kırpma YOK (K6.3).
 */
export const ReceiptSettingsUpdateSchema = z
  .object({
    receiptHeaderLines: z
      .array(ReceiptLineInputSchema)
      .max(RECEIPT_TEXT_LIMITS.maxHeaderLines, 'receipt_header:too_many_lines')
      .nullable(),
    receiptFooterLines: z
      .array(ReceiptLineInputSchema)
      .max(RECEIPT_TEXT_LIMITS.maxFooterLines, 'receipt_footer:too_many_lines')
      .nullable(),
    packingAutoPrintEnabled: z.boolean(),
  })
  .strict();
export type ReceiptSettingsUpdate = z.infer<typeof ReceiptSettingsUpdateSchema>;

/**
 * POST /settings/receipt/test-print gövdesi (ADR-045 K7). `targetPrinterId`
 * verilmezse iş hedefsiz kuyruğa girer (`print-bill` ile aynı sözleşme).
 */
export const ReceiptTestPrintSchema = z
  .object({
    targetPrinterId: z.string().uuid().optional(),
  })
  .strict();
export type ReceiptTestPrint = z.infer<typeof ReceiptTestPrintSchema>;
