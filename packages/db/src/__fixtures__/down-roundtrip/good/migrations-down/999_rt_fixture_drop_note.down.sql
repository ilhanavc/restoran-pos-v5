-- down-for: 999_rt_fixture_drop_note
-- Correct down: column comes back with the same type, NOT NULL and default (position differs; compared by name).
ALTER TABLE rt_fixture ADD COLUMN note text NOT NULL DEFAULT '';
