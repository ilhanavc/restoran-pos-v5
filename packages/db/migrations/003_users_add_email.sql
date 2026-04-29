-- 003_users_add_email.sql
-- ADR-002 Auth: login identifier olarak email kullanılır.
-- username kolonu backward-compat için kalır; email şimdilik nullable, seed sonrası NOT NULL yapılabilir.
-- ADR-003 §15 forward-only; idempotent re-run kemeri (IF NOT EXISTS) — 005-007 ile tutarlılık.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email TEXT;

-- Case-insensitive uniqueness: lower() functional index (citext extension bağımlılığından kaçınır)
-- §6.2: tenant_id prefix zorunlu
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_email_ci_idx ON users (tenant_id, lower(email));
