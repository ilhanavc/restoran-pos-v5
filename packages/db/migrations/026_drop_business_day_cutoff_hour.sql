-- 026_drop_business_day_cutoff_hour.sql
-- ADR-015 Karar 10 — anasayfa raporları takvim günü kullanır;
-- `business_day_cutoff_hour` (Sprint 6 Görev 24) terk edildi.
--
-- Forward-only (ADR-003 §15). DROP COLUMN destructive — backup gerekli (deploy hook).
--
-- DİKKAT: `populate_order_store_date()` trigger fonksiyonu (000_init.sql L66-84)
-- kolonu okuyor. Önce fonksiyonu yeniden tanımla (cutoff=0 → takvim günü),
-- sonra kolonu drop et. Aksi takdirde orders INSERT trigger boom.
--
-- 1) Audit snapshot — mevcut tenant'ların cutoff değerini forensic için yaz.
--    `tenant_settings.updated` event 2-segment naming gerektirir; DROP semantik
--    için generic envelope kullanıyoruz. event_type CHECK regex `^[a-z_]+\.[a-z_]+$`
--    `tenant_settings.cutoff_deprecated` uyar.
INSERT INTO audit_logs (
  id, tenant_id, event_type, actor_user_id, entity_type, entity_id,
  raw_payload, created_at
)
SELECT
  gen_random_uuid(),
  ts.tenant_id,
  'tenant_settings.cutoff_deprecated',
  NULL,
  'tenant_settings',
  ts.tenant_id,
  jsonb_build_object(
    'tenant_id',                    ts.tenant_id,
    'business_day_cutoff_hour',     ts.business_day_cutoff_hour,
    'reason',                       'ADR-015: switched to calendar day reports'
  ),
  now()
FROM tenant_settings ts
WHERE EXISTS (
  SELECT 1 FROM information_schema.columns
   WHERE table_name = 'tenant_settings'
     AND column_name = 'business_day_cutoff_hour'
);

-- 2) Yeniden tanımla: orders.store_date artık her zaman tenant TZ'sindeki
--    takvim günü ile doldurulur. v_cutoff yerine sabit 0.
CREATE OR REPLACE FUNCTION populate_order_store_date() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_tz TEXT;
BEGIN
  SELECT timezone
    INTO v_tz
    FROM tenant_settings WHERE tenant_id = NEW.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant_settings missing for tenant_id=% (orders insert blocked)', NEW.tenant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- ADR-015: takvim günü (cutoff_hour=0); store_date(ts, 0, tz)
  NEW.store_date := store_date(ts => NEW.created_at, cutoff_hour => 0, tz => v_tz);
  RETURN NEW;
END;
$$;

-- 3) Kolonu drop et (CHECK constraint kolon ile birlikte düşer).
ALTER TABLE tenant_settings
  DROP COLUMN IF EXISTS business_day_cutoff_hour;
