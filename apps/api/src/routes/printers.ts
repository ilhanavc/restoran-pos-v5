import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  DEFAULT_KITCHEN_STATION,
  isKitchenStation,
  PrinterCategoriesAssignRequestSchema,
  PrinterUpdateRequestSchema,
  type PrinterCategoriesAssignRequest,
  type PrinterDto,
  type PrinterQueueDepth,
  type PrinterStatus,
  type PrinterUpdateRequest,
} from '@restoran-pos/shared-types';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validateBody, validateParams, idParamSchema } from '../middleware/validate.js';
import { writeAudit } from '../audit/writeAudit.js';
import { domainError } from '../errors.js';

/**
 * ADR-032 Amendment 2 — Yazıcı yönetim ekranı (admin). Dilim A (görünürlük) +
 * Dilim B (istasyon atama paneli).
 *
 * "Yazıcı" = agent (ADR-004 §5; K1: ayrı `printers` tablosu YOK). Bu aile
 * KULLANICI-JWT'lidir ve `/print/v1` (agent-JWT) ailesinin DIŞINA mount edilir.
 * RBAC: `authenticate` + `authorize(['admin'])` → `printer.settings` yalnız
 * admin (test baskısı/anahtar üretimi yetkisi; K11). `requirePermission`
 * middleware'i projede YOK → mevcut `authorize(['admin'])` emsali kullanılır;
 * `rbac-parity.test.ts` bunu `printer.settings` matris aksiyonuna kilitler.
 *
 * Dilim C/D/E (kitchen_print anahtarı · ekleme/revoke/register-guard · test
 * baskısı) bu dosyada YOKTUR — cutover sonrasına ertelendi (ADR K13).
 *
 * Fiziksel ayarlar (IP/port/spooler kuyruk adı/codepage) buluta KOPYALANMAZ
 * (K1) → hiçbir uç bunları okumaz/yazmaz; tek kaynak dükkan PC'sindeki config.
 */

export interface PrintersRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
}

// K10 durum eşikleri (agent ≤25 sn long-poll yapar → 60 sn içinde en az bir
// canlılık sinyali beklenir).
const ONLINE_THRESHOLD_MS = 60_000;
const DELAYED_THRESHOLD_MS = 5 * 60_000;

/** `last_seen_at` + `revoked_at` → hesaplanan durum (K10). */
function computeStatus(
  lastSeenAt: Date | null,
  revokedAt: Date | null,
  nowMs: number,
): PrinterStatus {
  if (revokedAt !== null) return 'disabled';
  if (lastSeenAt === null) return 'pending';
  const ageMs = nowMs - lastSeenAt.getTime();
  if (ageMs < ONLINE_THRESHOLD_MS) return 'online';
  if (ageMs < DELAYED_THRESHOLD_MS) return 'delayed';
  return 'offline';
}

/** `categories.print_station` ham değeri → efektif mutfak istasyonu (NULL/geçersiz = taban). */
function effectiveStation(rawStation: string | null): string {
  return isKitchenStation(rawStation) ? rawStation : DEFAULT_KITCHEN_STATION;
}

interface AgentRow {
  id: string;
  display_name: string | null;
  device_fingerprint: string;
  declared_kinds: string[] | null;
  last_seen_at: Date | null;
  revoked_at: Date | null;
}

interface QueueDepthByKind {
  queued: number;
  failed: number;
}

export function printersRouter(deps: PrintersRouterDeps): ExpressRouter {
  const router = Router();

  /**
   * GET /printers — yazıcı listesi + durum + kuyruk derinliği + yetim kuyruk.
   *
   * Yanıt: `{ data: { printers: PrinterDto[], orphanKinds: string[] } }`.
   * orphanKinds (K10): işi (queued/failed) olan ama hiçbir ÇEVRİMİÇİ yazıcının
   * beyan etmediği kind'lar — bu ekranın en yüksek operasyonel değeri.
   */
  router.get(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const nowMs = Date.now();

        // 1) Yazıcılar (agents) — tenant-scoped, stabil sıra.
        const agents = (await deps.db
          .selectFrom('agents')
          .select([
            'id',
            'display_name',
            'device_fingerprint',
            'declared_kinds',
            'last_seen_at',
            'revoked_at',
          ])
          .where('tenant_id', '=', tenantId)
          .orderBy('created_at')
          .execute()) as AgentRow[];

        // 2) Kuyruk derinliği: kind × (queued|failed). queued = queued+retry
        //    (basılmayı bekleyen), failed = başarısız (operatör sinyali).
        const jobRows = await sql<{
          kind: string | null;
          bucket: 'queued' | 'failed';
          cnt: number;
        }>`
          SELECT payload->>'kind' AS kind,
                 CASE WHEN status = 'failed' THEN 'failed' ELSE 'queued' END AS bucket,
                 COUNT(*)::int AS cnt
          FROM print_jobs
          WHERE tenant_id = ${tenantId}
            AND status IN ('queued', 'retry', 'failed')
          GROUP BY 1, 2
        `.execute(deps.db);

        const queueByKind = new Map<string, QueueDepthByKind>();
        for (const r of jobRows.rows) {
          if (r.kind === null) continue; // kind'sız legacy iş orphan'a atfedilmez
          const entry = queueByKind.get(r.kind) ?? { queued: 0, failed: 0 };
          entry[r.bucket] = r.cnt;
          queueByKind.set(r.kind, entry);
        }

        // 3) Atanmış kategori sayısı: efektif istasyon başına (yalnız mutfağa
        //    giden kategoriler — kitchen_print=true).
        const catRows = await sql<{ station: string | null; cnt: number }>`
          SELECT print_station AS station, COUNT(*)::int AS cnt
          FROM categories
          WHERE tenant_id = ${tenantId}
            AND deleted_at IS NULL
            AND kitchen_print = true
          GROUP BY 1
        `.execute(deps.db);

        const stationCount = new Map<string, number>();
        for (const r of catRows.rows) {
          const st = effectiveStation(r.station);
          stationCount.set(st, (stationCount.get(st) ?? 0) + r.cnt);
        }

        // 4) Yetim kuyruk: çevrimiçi yazıcıların kapsadığı kind'lar.
        //    Filtresiz (declared_kinds NULL) çevrimiçi yazıcı TÜM kind'ları çeker.
        const onlineAgents = agents.filter(
          (a) =>
            a.revoked_at === null &&
            computeStatus(a.last_seen_at, a.revoked_at, nowMs) === 'online',
        );
        const hasFilterlessOnline = onlineAgents.some(
          (a) => a.declared_kinds === null,
        );
        const coveredKinds = new Set<string>();
        for (const a of onlineAgents) {
          for (const k of a.declared_kinds ?? []) coveredKinds.add(k);
        }
        const orphanKinds = hasFilterlessOnline
          ? []
          : [...queueByKind.keys()]
              .filter((k) => {
                const d = queueByKind.get(k)!;
                return (d.queued > 0 || d.failed > 0) && !coveredKinds.has(k);
              })
              .sort();

        const printers: PrinterDto[] = agents.map((a) => {
          const status = computeStatus(a.last_seen_at, a.revoked_at, nowMs);
          const declaredKinds = a.declared_kinds;
          // Bu yazıcının mutfak istasyon kind'larına atanmış kategori sayısı.
          const assignedCategoryCount = (declaredKinds ?? [])
            .filter(isKitchenStation)
            .reduce((sum, k) => sum + (stationCount.get(k) ?? 0), 0);
          // Kuyruk derinliği: yalnız yazıcının beyan ettiği kind'lar için.
          const queueDepths: PrinterQueueDepth[] = (declaredKinds ?? []).map(
            (k) => {
              const d = queueByKind.get(k) ?? { queued: 0, failed: 0 };
              return { kind: k, queued: d.queued, failed: d.failed };
            },
          );
          return {
            id: a.id,
            displayName: a.display_name,
            deviceFingerprint: a.device_fingerprint,
            declaredKinds,
            lastSeenAt: a.last_seen_at?.toISOString() ?? null,
            revokedAt: a.revoked_at?.toISOString() ?? null,
            status,
            // "filtresiz çekiyor" uyarısı: kind bildirmemiş ama en az bir kez
            // görülmüş yazıcı (henüz-register-olmamış pending YANLIŞ pozitif olmasın).
            filterless: declaredKinds === null && a.last_seen_at !== null,
            assignedCategoryCount,
            queueDepths,
          };
        });

        res.status(200).json({ data: { printers, orphanKinds } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * PATCH /printers/:id — istasyon etiketini (display_name) düzenle (Dilim A).
   * 404 PRINTER_NOT_FOUND yoksa/cross-tenant. Audit: printer.updated (K11).
   */
  router.patch(
    '/:id',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateParams(idParamSchema),
    validateBody(PrinterUpdateRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const printerId = req.params.id as string;
        const { displayName } = req.body as PrinterUpdateRequest;

        const updated = await deps.db.transaction().execute(async (trx) => {
          const existing = await trx
            .selectFrom('agents')
            .select(['id', 'display_name'])
            .where('id', '=', printerId)
            .where('tenant_id', '=', tenantId)
            .executeTakeFirst();
          if (existing === undefined) {
            throw domainError('PRINTER_NOT_FOUND', 404);
          }

          await trx
            .updateTable('agents')
            .set({ display_name: displayName })
            .where('id', '=', printerId)
            .where('tenant_id', '=', tenantId)
            .execute();

          // Audit — display_name = equipment label (PII değil; K11).
          await writeAudit(trx, {
            tenantId,
            eventType: 'printer.updated',
            actorUserId: req.user!.userId,
            entityType: 'printer',
            entityId: printerId,
            rawPayload: {
              printer_id: printerId,
              changed_fields: ['display_name'],
              display_name_before: existing.display_name,
              display_name_after: displayName,
            },
          });

          return { id: printerId, displayName };
        });

        res.status(200).json({ data: { printer: updated } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * PUT /printers/:id/categories — istasyon atama paneli (Dilim B, K3).
   *
   * `categoryIds` = `stationKind` istasyonuna basacak kategorilerin TAM
   * listesi. İstasyon-kapsamlı diff (tek transaction):
   *   - ADD    : listedeki + şu an bu istasyonda OLMAYAN → print_station=stationKind
   *   - REMOVE : şu an bu istasyonda olan + listede OLMAYAN → print_station=NULL
   *              (taban istasyona = FIRIN döner). Diğer istasyonların
   *              kategorilerine DOKUNULMAZ.
   * Eşleme YALNIZ UUID iledir (ad/ILIKE/lower YASAK — Türkçe İ/I tuzağı).
   * Yalnız `kitchen_print=true` kategoriler atanabilir; aksi 409. Audit:
   * printer.categories_assigned (K11) — yalnız gerçek değişiklik varsa.
   */
  router.put(
    '/:id/categories',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateParams(idParamSchema),
    validateBody(PrinterCategoriesAssignRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const printerId = req.params.id as string;
        const { stationKind, categoryIds } =
          req.body as PrinterCategoriesAssignRequest;
        const uniqueIds = [...new Set(categoryIds)];

        const result = await deps.db.transaction().execute(async (trx) => {
          // 1) Yazıcı var mı (tenant-scoped) — 404 + audit aktör bağlamı.
          const printer = await trx
            .selectFrom('agents')
            .select(['id', 'declared_kinds'])
            .where('id', '=', printerId)
            .where('tenant_id', '=', tenantId)
            .executeTakeFirst();
          if (printer === undefined) {
            throw domainError('PRINTER_NOT_FOUND', 404);
          }

          // İstasyon gerçekten BU yazıcıya mı ait? UI kısıtlıyor, uç
          // kısıtlamıyordu: kasa yazıcısının id'siyle stationKind:'grill'
          // kabul ediliyor, audit'e entity_id=<kasa yazıcısı> +
          // station_kind=grill yazılıyordu → yanıltıcı denetim izi.
          // declared_kinds NULL ise (bekleyen ya da filtresiz yazıcı) kapı
          // AÇIK kalır — K2 gereği bu alan gözlemdir, otorite değil.
          if (
            printer.declared_kinds !== null &&
            !printer.declared_kinds.includes(stationKind)
          ) {
            throw domainError('PRINTER_STATION_MISMATCH', 409);
          }

          // 2) İstenen kategoriler: var mı + mutfağa gidiyor mu (kitchen_print).
          if (uniqueIds.length > 0) {
            const requested = await trx
              .selectFrom('categories')
              .select(['id', 'kitchen_print'])
              .where('tenant_id', '=', tenantId)
              .where('deleted_at', 'is', null)
              .where('id', 'in', uniqueIds)
              .execute();
            if (requested.length !== uniqueIds.length) {
              // Eksik/cross-tenant kategori — enumeration sızdırmadan 404.
              throw domainError('MENU_CATEGORY_NOT_FOUND', 404);
            }
            if (requested.some((c) => !c.kitchen_print)) {
              throw domainError('PRINTER_CATEGORY_NOT_KITCHEN', 409);
            }
          }

          // 3a) REMOVE: bu istasyonda olan ama listede olmayan → NULL (taban).
          // `kitchen_print=true` filtresi ADD dalıyla simetriktir: mutfağa
          // gitmeyen bir kategori panelde zaten seçilemiyor, dolayısıyla
          // "listede yok" olması kullanıcı kararı değildir — filtresiz REMOVE
          // onun bayat `print_station` değerini sessizce sıfırlar ve bunu
          // audit'e gerçek bir değişiklikmiş gibi yazardı.
          let removeQuery = trx
            .updateTable('categories')
            .set({ print_station: null })
            .where('tenant_id', '=', tenantId)
            .where('deleted_at', 'is', null)
            .where('kitchen_print', '=', true)
            .where('print_station', '=', stationKind);
          if (uniqueIds.length > 0) {
            removeQuery = removeQuery.where('id', 'not in', uniqueIds);
          }
          const removed = await removeQuery.returning('id').execute();

          // 3b) ADD: listedeki + bu istasyonda OLMAYAN (NULL veya farklı) →
          //     stationKind. Yalnız kitchen_print=true (2. adımda garanti).
          let added: { id: string }[] = [];
          if (uniqueIds.length > 0) {
            added = await trx
              .updateTable('categories')
              .set({ print_station: stationKind })
              .where('tenant_id', '=', tenantId)
              .where('deleted_at', 'is', null)
              .where('kitchen_print', '=', true)
              .where('id', 'in', uniqueIds)
              .where((eb) =>
                eb.or([
                  eb('print_station', 'is', null),
                  eb('print_station', '!=', stationKind),
                ]),
              )
              .returning('id')
              .execute();
          }

          const addedIds = added.map((r) => r.id);
          const removedIds = removed.map((r) => r.id);

          // 4) Audit — yalnız gerçek değişiklik varsa (no-op kaydı yaratma).
          if (addedIds.length > 0 || removedIds.length > 0) {
            await writeAudit(trx, {
              tenantId,
              eventType: 'printer.categories_assigned',
              actorUserId: req.user!.userId,
              entityType: 'printer',
              entityId: printerId,
              rawPayload: {
                printer_id: printerId,
                station_kind: stationKind,
                added_category_ids: addedIds,
                removed_category_ids: removedIds,
                added_count: addedIds.length,
                removed_count: removedIds.length,
              },
            });
          }

          return { addedCount: addedIds.length, removedCount: removedIds.length };
        });

        res.status(200).json({
          data: {
            assignment: {
              stationKind,
              addedCount: result.addedCount,
              removedCount: result.removedCount,
            },
          },
        });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
