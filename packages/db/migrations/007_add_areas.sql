-- 007_add_areas.sql
-- ADR-009 — Salon Bölgeleri (Areas) Domain prerequisite
-- Phase 2 Sprint 5 Görev 22 — Görev 23 (/areas REST CRUD) öncesi schema-only
-- ADR-003 §14.1.B.3 (Phase-conditional enforcement) compliant
-- Phase 0-3 dev ortamı: CREATE INDEX CONCURRENTLY'siz kullanılır (§14.1.B.3 geçici izin).
--
-- Composite FK ON DELETE SET NULL: ADR-009 §1 verbatim. Pratikte tetiklenmez —
-- areas soft-delete only (ADR-003 §8); cascade NULL'lama service transaction'ında
-- manuel UPDATE ile yapılır (ADR-009 Domain service). FK defansif: yanlışlıkla hard
-- DELETE çalışırsa tables.tenant_id NOT NULL ihlali transaction'ı abort eder.

CREATE TABLE IF NOT EXISTS areas (
  id           UUID         PRIMARY KEY,
  tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name         TEXT         NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  sort_order   SMALLINT     NOT NULL DEFAULT 0,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);

-- v3 paritesi: case-insensitive name uniqueness (aktif satırlar)
CREATE UNIQUE INDEX IF NOT EXISTS areas_tenant_name_active_uq
  ON areas (tenant_id, lower(trim(name)))
  WHERE deleted_at IS NULL;

-- tables.area_id kolonu + composite FK (ADR-009 §1)
ALTER TABLE tables
  ADD COLUMN IF NOT EXISTS area_id UUID NULL;

ALTER TABLE tables
  DROP CONSTRAINT IF EXISTS fk_tables_area;

ALTER TABLE tables
  ADD CONSTRAINT fk_tables_area
  FOREIGN KEY (area_id, tenant_id)
  REFERENCES areas (id, tenant_id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tables_area_id_idx
  ON tables (tenant_id, area_id)
  WHERE area_id IS NOT NULL AND deleted_at IS NULL;
