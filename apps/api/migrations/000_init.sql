-- 000_init.sql
-- §14.1.B + §15.5 istisna: boş DB üzerinde CONCURRENTLY gerekmez.
-- Bu dosya tüm initial schema + index'leri NORMAL DDL ile yaratır.
-- Sonraki tüm migration'larda CONCURRENTLY zorunlu (db-migration-guard enforced).

-- === SECTION: 1 — ROLES ===
-- Roles created NOLOGIN; login + password set via vault injection (DBA runbook).
CREATE ROLE migrator NOLOGIN;
CREATE ROLE app_tenant NOLOGIN;
CREATE ROLE cron_purger BYPASSRLS NOLOGIN;
CREATE ROLE app_admin NOLOGIN;

-- === SECTION: 2 — HELPER FUNCTIONS ===

-- §4.1.1: bumps updated_at on row UPDATE
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- §5.1: business-day boundary calculator (IMMUTABLE PARALLEL SAFE)
CREATE OR REPLACE FUNCTION store_date(
  ts          TIMESTAMPTZ,
  cutoff_hour SMALLINT,
  tz          TEXT
) RETURNS DATE
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ((ts AT TIME ZONE tz) - make_interval(hours => cutoff_hour))::DATE;
$$;

-- §4.4: validates IANA timezone names against pg_timezone_names
CREATE OR REPLACE FUNCTION validate_timezone() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Invalid IANA timezone: %', NEW.timezone
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- §5.2: populates orders.store_date from tenant_settings on INSERT
CREATE OR REPLACE FUNCTION populate_order_store_date() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_cutoff SMALLINT;
  v_tz     TEXT;
BEGIN
  SELECT business_day_cutoff_hour, timezone
    INTO v_cutoff, v_tz
    FROM tenant_settings WHERE tenant_id = NEW.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant_settings missing for tenant_id=% (orders insert blocked)', NEW.tenant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  NEW.store_date := store_date(ts => NEW.created_at, cutoff_hour => v_cutoff, tz => v_tz);
  RETURN NEW;
END;
$$;

-- §5.2: append-only guard for orders.created_at and orders.store_date
CREATE OR REPLACE FUNCTION reject_temporal_update() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'orders.created_at is append-only (id=%)', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.store_date IS DISTINCT FROM NEW.store_date THEN
    RAISE EXCEPTION 'orders.store_date is append-only (id=%)', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- === SECTION: 3 — ENUMS ===

CREATE TYPE order_status     AS ENUM ('open','sent_to_kitchen','served','paid','cancelled');
CREATE TYPE order_type       AS ENUM ('dine_in','takeaway','delivery');
CREATE TYPE payment_type     AS ENUM ('cash','card');
CREATE TYPE payment_scope    AS ENUM ('full_order','split_item','equal_split');
CREATE TYPE print_job_status AS ENUM ('queued','printing','success','failed','cancelled','retry');
CREATE TYPE user_role        AS ENUM ('admin','cashier','waiter','kitchen');

-- === SECTION: 4 — TENANTS ===

CREATE TABLE tenants (
  id         UUID        PRIMARY KEY,
  name       TEXT        NOT NULL,
  slug       TEXT        NOT NULL UNIQUE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER tenants_set_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- === SECTION: 5 — TENANT_SETTINGS ===

CREATE TABLE tenant_settings (
  tenant_id                UUID PRIMARY KEY REFERENCES tenants(id),
  timezone                 TEXT NOT NULL DEFAULT 'Europe/Istanbul',
  business_day_cutoff_hour SMALLINT NOT NULL DEFAULT 4
    CHECK (business_day_cutoff_hour BETWEEN 0 AND 23),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER tenant_settings_set_updated_at
  BEFORE UPDATE ON tenant_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER tenant_settings_tz_check
  BEFORE INSERT OR UPDATE OF timezone ON tenant_settings
  FOR EACH ROW EXECUTE FUNCTION validate_timezone();

-- === SECTION: 6 — USERS (ADR-002 forward-ref placeholder) ===
-- ADR-002 (Auth) will finalize column list. Placeholder for FK targets.
CREATE TABLE users (
  id            UUID      PRIMARY KEY,
  tenant_id     UUID      NOT NULL REFERENCES tenants(id),
  role          user_role NOT NULL,
  username      TEXT      NOT NULL,
  password_hash TEXT      NOT NULL,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)  -- §6.5 composite UNIQUE for FK targets
);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- === SECTION: 7 — CATALOG / MASTER DATA ===

-- categories
CREATE TABLE categories (
  id         UUID        PRIMARY KEY,
  tenant_id  UUID        NOT NULL REFERENCES tenants(id),
  name       TEXT        NOT NULL,
  sort_order SMALLINT    NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);

CREATE TRIGGER categories_set_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- products
CREATE TABLE products (
  id          UUID        PRIMARY KEY,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id),
  category_id UUID        NOT NULL,
  name        TEXT        NOT NULL,
  price_cents INTEGER     NOT NULL CHECK (price_cents >= 0),
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (category_id, tenant_id) REFERENCES categories (id, tenant_id)
);

CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- tables (masa)
CREATE TABLE tables (
  id         UUID        PRIMARY KEY,
  tenant_id  UUID        NOT NULL REFERENCES tenants(id),
  code       TEXT        NOT NULL,           -- e.g. "M01", "M02"
  capacity   SMALLINT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, code)                   -- table code unique per tenant
);

CREATE TRIGGER tables_set_updated_at
  BEFORE UPDATE ON tables
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- customers
CREATE TABLE customers (
  id         UUID        PRIMARY KEY,
  tenant_id  UUID        NOT NULL REFERENCES tenants(id),
  full_name  TEXT        NOT NULL,
  note       TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);

CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- === SECTION: 8 — CUSTOMER_PHONES ===
-- §6.2: full UNIQUE (no partial); §14.7 explicit lock policy. §8.3: hard-delete.
CREATE TABLE customer_phones (
  id               UUID        PRIMARY KEY,
  tenant_id        UUID        NOT NULL REFERENCES tenants(id),
  customer_id      UUID        NOT NULL,
  normalized_phone TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (customer_id, tenant_id) REFERENCES customers (id, tenant_id),
  UNIQUE (tenant_id, normalized_phone)
);

-- === SECTION: 9 — ORDERS ===

CREATE TABLE orders (
  id              UUID         PRIMARY KEY,
  tenant_id       UUID         NOT NULL REFERENCES tenants(id),
  table_id        UUID,                              -- NULL for takeaway/delivery
  customer_id     UUID,
  order_type      order_type   NOT NULL DEFAULT 'dine_in',
  status          order_status NOT NULL DEFAULT 'open',
  order_no        INTEGER      NOT NULL,             -- daily unique per §11
  store_date      DATE         NOT NULL,             -- trigger-populated, append-only
  is_fully_comped BOOLEAN      NOT NULL DEFAULT false,
  total_cents     INTEGER      NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  note            TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (table_id, tenant_id)    REFERENCES tables    (id, tenant_id),
  FOREIGN KEY (customer_id, tenant_id) REFERENCES customers (id, tenant_id)
);

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER orders_populate_store_date
  BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION populate_order_store_date();

CREATE TRIGGER orders_reject_temporal_update
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION reject_temporal_update();

-- === SECTION: 10 — ORDER_ITEMS ===
-- §7: snapshot invariant (product_name, category_name_snapshot, unit_price_cents).
CREATE TABLE order_items (
  id                     UUID        PRIMARY KEY,
  tenant_id              UUID        NOT NULL REFERENCES tenants(id),
  order_id               UUID        NOT NULL,
  product_id             UUID,                                 -- nullable: deleted product
  product_name           TEXT        NOT NULL,                 -- snapshot §7
  category_name_snapshot TEXT        NOT NULL,                 -- snapshot §7
  unit_price_cents       INTEGER     NOT NULL CHECK (unit_price_cents >= 0),
  quantity               SMALLINT    NOT NULL DEFAULT 1 CHECK (quantity > 0),
  total_cents            INTEGER     NOT NULL CHECK (total_cents >= 0),
  is_comped              BOOLEAN     NOT NULL DEFAULT false,
  note                   TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (order_id, tenant_id) REFERENCES orders (id, tenant_id)
);

-- === SECTION: 11 — PAYMENTS ===

CREATE TABLE payments (
  id            UUID          PRIMARY KEY,
  tenant_id     UUID          NOT NULL REFERENCES tenants(id),
  order_id      UUID          NOT NULL,
  payment_type  payment_type  NOT NULL,
  payment_scope payment_scope NOT NULL,
  amount_cents  INTEGER       NOT NULL CHECK (amount_cents > 0),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (order_id, tenant_id) REFERENCES orders (id, tenant_id)
);

-- === SECTION: 12 — PAYMENT_ITEMS ===
-- §10.1.b: link table; §10.5.2 C1: comped item cannot be added to a payment.
CREATE TABLE payment_items (
  payment_id    UUID NOT NULL,
  order_item_id UUID NOT NULL,
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  PRIMARY KEY (payment_id, order_item_id),
  UNIQUE (tenant_id, order_item_id),
  FOREIGN KEY (payment_id, tenant_id)    REFERENCES payments    (id, tenant_id),
  FOREIGN KEY (order_item_id, tenant_id) REFERENCES order_items (id, tenant_id)
);

CREATE OR REPLACE FUNCTION block_comped_item_in_payment() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM order_items
    WHERE id = NEW.order_item_id
      AND tenant_id = NEW.tenant_id
      AND is_comped = true
  ) THEN
    RAISE EXCEPTION 'Comped item cannot be added to payment (order_item_id: %)', NEW.order_item_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_items_block_comped_insert
  BEFORE INSERT ON payment_items
  FOR EACH ROW EXECUTE FUNCTION block_comped_item_in_payment();

-- === SECTION: 13 — ORDER_NO_COUNTERS ===
-- §11.6.4: no surrogate id; PK is (tenant_id, business_date).
-- §14.4: no additional index beyond PK.
CREATE TABLE order_no_counters (
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  business_date DATE NOT NULL,
  last_no       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, business_date)
);

-- === SECTION: 14 — AUDIT_LOGS ===
-- §12.2 exact DDL. tenant_id nullable (system actor); §6.5 muafiyet.
CREATE TABLE audit_logs (
  id            UUID        PRIMARY KEY,
  tenant_id     UUID        REFERENCES tenants(id) ON DELETE SET NULL,  -- NULL = system actor
  actor_user_id UUID        REFERENCES users(id)   ON DELETE SET NULL,
  actor         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  event_type    TEXT        NOT NULL
    CHECK (event_type ~ '^[a-z_]+\.[a-z_]+$'),
  entity_type   TEXT,
  entity_id     UUID,
  payload       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT audit_logs_payload_no_pii CHECK (
    NOT (payload ?| ARRAY[
      'address', 'adres', 'ad_soyad', 'api_key', 'authorization',
      'bearer', 'birthdate', 'card_holder', 'card_number', 'cookie',
      'customer_name', 'customer_phone', 'cvv', 'dob', 'email',
      'eposta', 'iban', 'ip', 'ip_address', 'jwt',
      'kart_no', 'musteri_adi', 'musteri_telefon', 'national_id',
      'password', 'password_hash', 'phone', 'phone_raw', 'refresh_token',
      'secret', 'session_id', 'session_token', 'set_cookie', 'sifre',
      'tax_id', 'tc_kimlik', 'tckn', 'telefon'
    ])
  )
);

-- === SECTION: 15 — CALL_LOGS ===
-- §13.1.B: 30d retention (cron_purger DELETE). §12 deny-list: raw_phone NEVER in audit payload.
CREATE TABLE call_logs (
  id               UUID        PRIMARY KEY,
  tenant_id        UUID        NOT NULL REFERENCES tenants(id),
  normalized_phone TEXT        NOT NULL,
  raw_phone        TEXT,
  customer_id      UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (customer_id, tenant_id) REFERENCES customers (id, tenant_id)
);

-- === SECTION: 16 — PRINT_JOBS (ADR-004 forward-ref placeholder) ===
-- ADR-004 (Print Agent) will finalize schema. Minimal placeholder for FK targets.
CREATE TABLE print_jobs (
  id         UUID             PRIMARY KEY,
  tenant_id  UUID             NOT NULL REFERENCES tenants(id),
  status     print_job_status NOT NULL DEFAULT 'queued',
  payload    JSONB            NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ      NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);

CREATE TRIGGER print_jobs_set_updated_at
  BEFORE UPDATE ON print_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- === SECTION: 17 — INDEXES ===
-- §14: CONCURRENTLY omitted per §15.5 init-file exception.

-- orders (§14.2)
CREATE UNIQUE INDEX orders_tenant_store_date_order_no_uq
  ON orders (tenant_id, store_date, order_no);  -- §14.2.A dual-role

CREATE UNIQUE INDEX orders_tenant_table_open_uq
  ON orders (tenant_id, table_id)
  WHERE status NOT IN ('paid', 'cancelled');     -- §14.2.B

-- audit_logs (§14.3.B three-index lock)
CREATE INDEX audit_logs_tenant_created_idx
  ON audit_logs (tenant_id, created_at DESC);

CREATE INDEX audit_logs_tenant_event_created_idx
  ON audit_logs (tenant_id, event_type, created_at DESC);

CREATE INDEX audit_logs_tenant_entity_idx
  ON audit_logs (tenant_id, entity_type, entity_id)
  WHERE entity_id IS NOT NULL;

-- call_logs (§14.3.C)
CREATE INDEX call_logs_tenant_created_idx
  ON call_logs (tenant_id, created_at DESC);

-- soft-delete partials (§14.5.A)
CREATE INDEX products_tenant_active_idx
  ON products (tenant_id, name) WHERE deleted_at IS NULL;

CREATE INDEX categories_tenant_active_idx
  ON categories (tenant_id, sort_order) WHERE deleted_at IS NULL;

CREATE INDEX customers_tenant_active_idx
  ON customers (tenant_id, full_name) WHERE deleted_at IS NULL;

CREATE INDEX tables_tenant_active_idx
  ON tables (tenant_id, code) WHERE deleted_at IS NULL;

-- payments (§14.6)
CREATE INDEX payments_tenant_order_idx
  ON payments (tenant_id, order_id);

-- print_jobs (§14.8 — pending partial)
CREATE INDEX print_jobs_tenant_status_created_idx
  ON print_jobs (tenant_id, status, created_at);

CREATE INDEX print_jobs_pending_idx
  ON print_jobs (tenant_id, created_at)
  WHERE status IN ('queued', 'printing', 'retry');

-- snapshot report indexes (§14.5.B)
CREATE INDEX order_items_tenant_product_idx
  ON order_items (tenant_id, product_name);

CREATE INDEX order_items_tenant_category_idx
  ON order_items (tenant_id, category_name_snapshot);

-- === SECTION: 18 — GRANTS ===
-- §15.6.B exact, including DEFAULT PRIVILEGES for future tables.

-- Migrator: full DDL
GRANT ALL ON SCHEMA public TO migrator;
GRANT ALL ON ALL TABLES IN SCHEMA public TO migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO migrator;

-- App tenant: DML only (new tables auto-covered)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_tenant;
REVOKE ALL ON SCHEMA public FROM app_tenant;
GRANT USAGE ON SCHEMA public TO app_tenant;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant;

-- Cron purger: bounded-log DELETE whitelist only — DO NOT use ALL TABLES (BLOCKER)
GRANT SELECT, DELETE ON audit_logs, call_logs, print_jobs TO cron_purger;

-- App admin: SELECT only
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_admin;

-- === SECTION: SEED ===
-- Initial tenant seed (single-tenant MVP).
-- Replace UUIDs with actual values before first deploy.
INSERT INTO tenants (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Pilot Restoran', 'pilot');

INSERT INTO tenant_settings (tenant_id, timezone, business_day_cutoff_hour)
VALUES ('00000000-0000-0000-0000-000000000001', 'Europe/Istanbul', 4);
