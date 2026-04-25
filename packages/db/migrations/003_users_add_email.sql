-- 003_users_add_email.sql
-- ADR-002 Auth: login identifier olarak email kullanılır.
-- username kolonu backward-compat için kalır; email şimdilik nullable, seed sonrası NOT NULL yapılabilir.

ALTER TABLE users
  ADD COLUMN email TEXT,
  ADD CONSTRAINT users_tenant_email_unique UNIQUE (tenant_id, email);
