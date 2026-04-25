-- 003_users_add_email.sql
-- ADR-002 Auth: login identifier olarak email kullanılır.
-- username kolonu backward-compat için kalır; email şimdilik nullable, seed sonrası NOT NULL yapılabilir.

ALTER TABLE users
  ADD COLUMN email TEXT;

-- Case-insensitive uniqueness: lower() functional index (citext extension bağımlılığından kaçınır)
-- §6.2: tenant_id prefix zorunlu
CREATE UNIQUE INDEX users_tenant_email_ci_idx ON users (tenant_id, lower(email));
