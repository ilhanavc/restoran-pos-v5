import { z } from 'zod';
import { KITCHEN_STATION_KINDS } from './print-agent.js';

/**
 * ADR-032 Amendment 2 — Yazıcı yönetim ekranı (admin) DTO + zod şemaları.
 *
 * "Yazıcı" = agent (ADR-004 §5: 1 agent = 1 yazıcı; K1: ayrı `printers`
 * tablosu YOK). Bu modül kullanıcı-JWT + `printer.settings` (yalnız admin)
 * altındaki `/printers` ailesinin sözleşmesini taşır — `/print/v1` (agent-JWT)
 * ailesinden AYRI. UI'da "agent" kelimesi GEÇMEZ; kullanıcıya "yazıcı" denir.
 *
 * Dilim A (görünürlük) + Dilim B (istasyon atama paneli) kapsamı. Dilim C/D/E
 * (kitchen_print anahtarı · ekleme/revoke · test baskısı) bu modülde YOKTUR.
 */

/**
 * Hesaplanan canlılık durumu (K10 eşikleri). `last_seen_at` + `revoked_at`
 * kolonlarından türetilir; DB'de saklanmaz.
 *   - online   : last_seen_at < 60 sn (agent ≤25 sn long-poll yapar)
 *   - delayed  : 60 sn – 5 dk
 *   - offline  : > 5 dk veya hiç görülmemiş ama register olmuş
 *   - disabled : revoked_at IS NOT NULL
 *   - pending  : hiç görülmemiş (last_seen_at NULL, register bekliyor)
 */
export const PrinterStatusSchema = z.enum([
  'online',
  'delayed',
  'offline',
  'disabled',
  'pending',
]);
export type PrinterStatus = z.infer<typeof PrinterStatusSchema>;

/**
 * Yazıcının beyan ettiği bir iş türü (kind) için kuyruk derinliği. `queued`
 * = bekleyen + retry (basılmayı bekleyen); `failed` = başarısız (terminal
 * cancelled DEĞİL — retry tükenmiş `cancelled` ayrı; burada operatörün
 * göreceği "sorun var" sinyali failed satırlarıdır).
 */
export const PrinterQueueDepthSchema = z.object({
  kind: z.string(),
  queued: z.number().int().min(0),
  failed: z.number().int().min(0),
});
export type PrinterQueueDepth = z.infer<typeof PrinterQueueDepthSchema>;

/**
 * `GET /printers` tek satır DTO'su. Fiziksel ayarlar (IP/port/spooler kuyruk
 * adı/codepage) buluta KOPYALANMAZ (K1) → bu DTO'da YOKTUR; tek kaynak dükkan
 * PC'sindeki config dosyasıdır.
 */
export const PrinterDtoSchema = z.object({
  id: z.string().uuid(),
  /** İstasyon etiketi ("Fırın"/"Izgara"/"Kasa"). NULL → UI fingerprint gösterir. */
  displayName: z.string().nullable(),
  deviceFingerprint: z.string(),
  /** Gözlenen iş-türü kümesi (K2). NULL → filtresiz çekiyor (uyarı çipi). */
  declaredKinds: z.array(z.string()).nullable(),
  lastSeenAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  status: PrinterStatusSchema,
  /** declared_kinds NULL + en az bir kez görülmüş → "filtresiz çekiyor" uyarısı. */
  filterless: z.boolean(),
  /** Bu yazıcının istasyon kind'larına atanmış (kitchen_print=true) kategori sayısı. */
  assignedCategoryCount: z.number().int().min(0),
  /** Yazıcının beyan ettiği her mutfak kind'ı için kuyruk derinliği. */
  queueDepths: z.array(PrinterQueueDepthSchema),
});
export type PrinterDto = z.infer<typeof PrinterDtoSchema>;

/**
 * `GET /printers` yanıt zarfı. `orphanKinds` = işi (queued/failed) olan ama
 * hiçbir ÇEVRİMİÇİ yazıcının beyan etmediği kind'lar (K10 yetim kuyruk) — bu
 * ekranın en yüksek operasyonel değeri (`grill` işini `kitchen` agent'ı
 * reclaim bile edemez → sessiz arıza yalnız burada görünür).
 */
export const PrintersListResponseSchema = z.object({
  printers: z.array(PrinterDtoSchema),
  orphanKinds: z.array(z.string()),
});
export type PrintersListResponse = z.infer<typeof PrintersListResponseSchema>;

/** `PATCH /printers/:id` — yalnız istasyon etiketini düzenler (Dilim A). */
export const PrinterUpdateRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(60),
  })
  .strict();
export type PrinterUpdateRequest = z.infer<typeof PrinterUpdateRequestSchema>;

/**
 * `PUT /printers/:id/categories` — istasyon atama paneli (Dilim B, K3).
 *
 * `stationKind` KITCHEN_STATION_KINDS alt kümesine (kitchen | grill) sınırlıdır;
 * `bill` atama ALMAZ (kasa fişi kategoriye göre yönlenmez). `categoryIds` bu
 * istasyona basacak kategorilerin TAM listesidir (istasyon-kapsamlı diff:
 * eksikler taban istasyona/NULL'a döner). Eşleme YALNIZ UUID iledir (S101
 * Türkçe İ/I tuzağı → ad/ILIKE/lower YASAK).
 */
export const PrinterCategoriesAssignRequestSchema = z
  .object({
    stationKind: z.enum(KITCHEN_STATION_KINDS),
    categoryIds: z.array(z.string().uuid()),
  })
  .strict();
export type PrinterCategoriesAssignRequest = z.infer<
  typeof PrinterCategoriesAssignRequestSchema
>;

/** `PUT /printers/:id/categories` yanıtı — uygulanan diff özeti (UI onayı). */
export const PrinterCategoriesAssignResponseSchema = z.object({
  stationKind: z.enum(KITCHEN_STATION_KINDS),
  addedCount: z.number().int().min(0),
  removedCount: z.number().int().min(0),
});
export type PrinterCategoriesAssignResponse = z.infer<
  typeof PrinterCategoriesAssignResponseSchema
>;
