-- down-for: 999_rt_fixture_drop_note
-- Deliberately wrong down (negative control): wrong type and no default.
ALTER TABLE rt_fixture ADD COLUMN note varchar(10);
