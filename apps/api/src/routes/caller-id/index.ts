import { randomUUID } from 'node:crypto';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import type { Kysely } from 'kysely';
import type { Server as IoServer } from 'socket.io';
import {
  createCallLogsRepository,
  createCustomersRepository,
  createTenantSettingsRepository,
  type DB,
} from '@restoran-pos/db';
import {
  BridgeIncomingCallSchema,
  CallLogQuerySchema,
  type IncomingCallEvent,
} from '@restoran-pos/shared-types';
import { z } from 'zod';
import { normalizePhoneTr } from '@restoran-pos/shared-domain';
import {
  emitCallStatusChanged,
  emitIncomingCall,
} from '../../realtime/emit.js';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validateBody, validateQuery } from '../../middleware/validate.js';
import {
  requireBridgeToken,
  requireTenantHeader,
} from '../../middleware/bridge-token.js';
import { isMaskedNumber } from '../../utils/caller-id.js';
import { domainError } from '../../errors.js';
import { logger } from '../../logger.js';

export interface CallerIdRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
  bridgeToken: string | undefined;
  /**
   * ADR-016 §11 — Socket.IO server. Optional çünkü test'lerde stub geçilebilir;
   * undefined ise emit atlanır (call_log yine yazılır, sadece broadcast olmaz).
   */
  io?: IoServer;
}

const idParamSchema = z.object({ id: z.string().uuid() });

const StatusUpdateSchema = z.object({
  status: z.enum(['ringing', 'dismissed', 'opened_order', 'completed']),
  openedOrderId: z.string().uuid().optional(),
});

interface CallLogDtoRow {
  id: string;
  tenant_id: string;
  raw_phone: string | null;
  normalized_phone: string | null;
  customer_id: string | null;
  status: string;
  opened_order_id: string | null;
  station_user_id: string | null;
  received_at: Date;
  customer_name?: string | null;
  customer_is_blacklisted?: boolean | null;
}

function toCallLogDto(row: CallLogDtoRow): Record<string, unknown> {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    rawPhone: row.raw_phone,
    normalizedPhone: row.normalized_phone,
    customerId: row.customer_id,
    customerName: row.customer_name ?? null,
    isBlacklisted: row.customer_is_blacklisted ?? null,
    status: row.status,
    openedOrderId: row.opened_order_id,
    stationUserId: row.station_user_id,
    receivedAt: row.received_at.toISOString(),
  };
}

/**
 * /caller-id — operatör (admin/cashier) endpoint'leri:
 *   - GET /logs    — recent feed (pollable)
 *   - PATCH /logs/:id/status — popup aksiyonu (dismiss / opened_order)
 *
 * ADR-016 §11. Bridge endpoint ayrı router'da (`bridgeCallerIdRouter`).
 */
export function callerIdRouter(deps: CallerIdRouterDeps): ExpressRouter {
  const router = Router();

  router.get(
    '/logs',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    validateQuery(CallLogQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const repo = createCallLogsRepository(deps.db);
        const query = req.query as unknown as { limit: number; since?: string };
        const since =
          query.since !== undefined ? new Date(query.since) : undefined;
        const rows = await repo.listCallLogs(tenantId, query.limit, since);
        res
          .status(200)
          .json({ data: { calls: rows.map((r) => toCallLogDto(r)) } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  router.patch(
    '/logs/:id/status',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    validateBody(StatusUpdateSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const params = idParamSchema.safeParse(req.params);
        if (!params.success) return next(params.error);

        const repo = createCallLogsRepository(deps.db);
        const row = await repo.updateCallLogStatus(
          req.user!.tenantId,
          params.data.id,
          req.body.status,
          req.body.openedOrderId,
        );
        if (row === null) return next(domainError('CALL_LOG_NOT_FOUND', 404));

        // ADR-016 §11 — atanmış istasyona status_changed broadcast.
        if (deps.io !== undefined && row.station_user_id !== null) {
          try {
            emitCallStatusChanged(
              deps.io,
              row.tenant_id,
              row.station_user_id,
              row.id,
              req.body.status,
            );
          } catch (emitErr) {
            logger.error(
              { err: emitErr, callLogId: row.id },
              'caller_id.status_changed.emit_failed',
            );
          }
        }

        res.status(200).json({ data: { call: toCallLogDto(row) } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}

/**
 * /bridge/caller-id — .NET bridge servisinin POST'ladığı endpoint.
 * Auth: `X-Bridge-Token` shared secret + `X-Tenant-Id` UUID header.
 *
 * Pipeline (ADR-016 §11):
 *   1. normalizePhoneTr → boş ise `accepted=false, reason='invalid'`
 *   2. tenant_settings.caller_id_bypass_patterns lookup
 *   3. isMaskedNumber → `reason='masked_bypass'` (call_log YAZILMAZ)
 *   4. findRecentDuplicate(5s) → `reason='duplicate'` + mevcut callLogId
 *   5. findCustomerByPhone (opsiyonel)
 *   6. createCallLog(status='ringing', stationUserId=settings)
 *   7. Socket.IO emit — PR-8b-3 (placeholder TODO)
 *   8. 200 `accepted=true, callLogId, reason='ok'`
 *
 * Hata fırlatmaz — bridge'i blok etmemek için her durumda 200 döner.
 */
export function bridgeCallerIdRouter(deps: CallerIdRouterDeps): ExpressRouter {
  const router = Router();

  router.post(
    '/incoming',
    requireBridgeToken(deps.bridgeToken),
    requireTenantHeader(),
    validateBody(BridgeIncomingCallSchema),
    async (req: Request, res: Response, _next: NextFunction) => {
      const tenantId = req.tenantId!;
      try {
        const normalized = normalizePhoneTr(req.body.rawPhone);
        if (normalized === '') {
          res
            .status(200)
            .json({ accepted: false, reason: 'invalid', callLogId: null });
          return;
        }

        // tenant_settings → bypass patterns + station user
        const settingsRepo = createTenantSettingsRepository(deps.db);
        const settings = await settingsRepo.findByTenantId(tenantId);
        const patterns = settings?.caller_id_bypass_patterns ?? [];
        const stationUserId = settings?.caller_id_station_user_id ?? null;

        if (isMaskedNumber(normalized, patterns).matched) {
          res
            .status(200)
            .json({ accepted: false, reason: 'masked_bypass', callLogId: null });
          return;
        }

        const callLogsRepo = createCallLogsRepository(deps.db);
        const duplicate = await callLogsRepo.findRecentDuplicate(
          tenantId,
          normalized,
          5,
        );
        if (duplicate !== null) {
          res.status(200).json({
            accepted: false,
            reason: 'duplicate',
            callLogId: duplicate.id,
          });
          return;
        }

        const customersRepo = createCustomersRepository(deps.db);
        const customer = await customersRepo.findCustomerByPhone(
          tenantId,
          normalized,
        );

        const created = await callLogsRepo.createCallLog(tenantId, {
          id: randomUUID(),
          rawPhone: req.body.rawPhone,
          normalizedPhone: normalized,
          customerId: customer?.id ?? null,
          status: 'ringing',
          stationUserId,
        });

        // ADR-016 §11 — atanmış istasyon varsa Socket.IO `caller.incoming`
        // emit. stationUserId null ise emit atlanır (call_log yine yazıldı,
        // geçmiş raporları için).
        if (deps.io !== undefined && stationUserId !== null) {
          const eventPayload: IncomingCallEvent = {
            callLogId: created.id,
            rawPhone: req.body.rawPhone,
            normalizedPhone: normalized,
            customer:
              customer !== null
                ? {
                    id: customer.id,
                    fullName: customer.full_name,
                    isBlacklisted: customer.is_blacklisted,
                    totalOrders: customer.total_orders,
                    addresses: customer.addresses.map((a) => ({
                      id: a.id,
                      title: a.title,
                      addressLine: a.address_line,
                      district: a.district,
                      neighborhood: a.neighborhood,
                      addressNote: a.address_note,
                      isDefault: a.is_default,
                    })),
                  }
                : null,
            // .NET bridge offset formatını (+00:00) Z'ye normalize et —
            // IncomingCallEventSchema.datetime() offset kabul etmez (emit.ts:82
            // parse → ZodError → emit_failed). S86 canlı test bulgusu.
            receivedAt: new Date(req.body.receivedAt).toISOString(),
          };
          try {
            emitIncomingCall(deps.io, tenantId, stationUserId, eventPayload);
            // Başarı logu ŞART (S86 dersi): yalnız hata loglanınca "sessizlik"
            // emit-başarılı mı hiç-denenmedi mi ayırt edilemiyordu.
            logger.info(
              { tenantId, callLogId: created.id, stationUserId },
              'caller_id.incoming.emitted',
            );
          } catch (emitErr) {
            logger.error(
              { err: emitErr, callLogId: created.id },
              'caller_id.incoming.emit_failed',
            );
          }
        } else {
          logger.info(
            { tenantId, callLogId: created.id, hasStation: stationUserId !== null },
            'caller_id.incoming (no station configured, skipping emit)',
          );
        }

        res
          .status(200)
          .json({ accepted: true, reason: 'ok', callLogId: created.id });
        return;
      } catch (err) {
        // Bridge'i blok etmemek için her hata 200 + accepted=false.
        logger.error({ err, tenantId }, 'caller_id.bridge.error');
        res
          .status(200)
          .json({ accepted: false, reason: 'invalid', callLogId: null });
        return;
      }
    },
  );

  return router;
}
