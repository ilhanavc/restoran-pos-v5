-- rollback-compat: breaking
-- Test fixture only: a contract step that drops a column.
ALTER TABLE rt_fixture DROP COLUMN note;
