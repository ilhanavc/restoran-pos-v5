-- 033_users_username_unique.sql
--
-- ADR-002 §10.11 (Amendment 2026-05-08): Sprint 0/1 borç kapanışı.
-- Numara: 029 yerine 033 (FIFO sıralama; 031+032 dev DB'de zaten applied,
-- node-pg-migrate out-of-order detection 029'u reddederdi —
-- memory feedback_pr_merge_collision_avoidance.md).
-- (tenant_id, lower(username)) için case-insensitive UNIQUE INDEX.
-- Migration 003 email_ci_idx pattern paralelliği korunur.
--
-- Migration 018 hard-delete sonrası users tablosunda deleted_at kolonu YOK,
-- bu nedenle partial WHERE clause gerekmez — full UNIQUE INDEX yeterli.
--
-- CONCURRENTLY skip: ADR-003 §14.1.B Phase-conditional enforcement (Phase 0-3
-- dev ortamı muafiyeti; Phase 4 prod cutover öncesi aktive edilir).
--
-- Pre-flight (dev DB pos_dev): DUPLICATE GROUPS 0 (tek user "ilhan").
-- CI ephemeral postgres'te fresh DB; dolayısıyla duplicate riski yok.

CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_username_ci_idx
  ON users (tenant_id, lower(username));
