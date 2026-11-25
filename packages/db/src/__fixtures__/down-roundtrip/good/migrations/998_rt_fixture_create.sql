-- rollback-compat: additive
-- Test fixture only (ADR-049 K5.2 control); never in packages/db/migrations.
CREATE TABLE rt_fixture (id int PRIMARY KEY, note text NOT NULL DEFAULT '');
