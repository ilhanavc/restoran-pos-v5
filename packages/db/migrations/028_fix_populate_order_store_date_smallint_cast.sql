-- 028_fix_populate_order_store_date_smallint_cast.sql
--
-- BUG FIX: 026_drop_business_day_cutoff_hour.sql §2 satır 56
--   NEW.store_date := store_date(ts => NEW.created_at, cutoff_hour => 0, tz => v_tz);
-- ifadesinde `0` integer literal'i, `store_date` fonksiyonunun signature'ına
-- uymuyor: 000_init.sql L44-50 fonksiyonu `cutoff_hour SMALLINT` bekliyor.
-- PostgreSQL named-parameter call'da integer→smallint implicit cast YAPMAZ
-- (downcast). Sonuç: fresh DB'de POST /orders trigger'ı
--   `function store_date(timestamptz, integer, text) does not exist (42883)`
-- hatası ile patlar; sipariş oluşturma 500 döner.
--
-- KÖK SEBEP: Sprint 6 (commit `bcd738d`, PR #98 PR-8-pre) 026'da v_cutoff SMALLINT
-- variable yerine literal 0'a geçilirken explicit cast atlandı. Bug PR #105
-- vitest pool=forks→threads değişikliği ile (DATABASE_URL worker'a propagate
-- edilince) görünür hale geldi (önceden 27 test sessizce skip oluyordu).
--
-- ÇÖZÜM: 0::SMALLINT explicit cast. Davranış DEĞİŞMEZ — niyet zaten ADR-015
-- takvim günü (cutoff=0); yalnız tip uyumu sağlanır. Idempotent (CREATE OR
-- REPLACE).
--
-- Cross-ref:
--   - ADR-003 §15 (forward-only migrations)
--   - ADR-015 §10 (takvim günü, cutoff_hour=0)
--   - 000_init.sql L44-50 (store_date signature)
--   - 026_drop_business_day_cutoff_hour.sql §2 (önceki trigger)

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

  -- ADR-015: takvim günü (cutoff_hour=0). store_date signature
  -- (000_init.sql L44) `cutoff_hour SMALLINT` — explicit cast zorunlu.
  NEW.store_date := store_date(
    ts          => NEW.created_at,
    cutoff_hour => 0::SMALLINT,
    tz          => v_tz
  );
  RETURN NEW;
END;
$$;
