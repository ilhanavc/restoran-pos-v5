-- 001_fix_enum_values.sql
-- Aligns DB enum values with shared-types domain model.
-- No data exists yet — safe to rename and add values.
-- ADR-003 forward-only: no down migration.

-- === order_status: add missing states ===
-- Note: ADD VALUE is non-transactional in PG but safe on empty tables.
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'partially_served' AFTER 'sent_to_kitchen';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'billed' AFTER 'served';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'void' AFTER 'cancelled';

-- === payment_type: add transfer (comp handled via order_items.is_comped) ===
ALTER TYPE payment_type ADD VALUE IF NOT EXISTS 'transfer';

-- === payment_scope: rename to domain-idiomatic names ===
ALTER TYPE payment_scope RENAME VALUE 'full_order' TO 'full';
ALTER TYPE payment_scope RENAME VALUE 'split_item' TO 'item';
ALTER TYPE payment_scope RENAME VALUE 'equal_split' TO 'partial';
