-- Migration 052 — ADR-032 Amendment 4 (Yazdır butonunda hedef yazıcı seçimi)
--
-- Forward-only (ADR-003 §9.5c) — DOWN migration YOK (048/049/051 emsali).
--
-- NEDEN: Bugün `payload.kind` ikili görev yapıyor — hem içerik tipi (şablon,
-- codepage, buzzer, ikon, PII politikası) hem de fiziksel adres (hangi agent
-- çekebilir). Adisyon fişinde bu ikisi eş-anlamlı DEĞİL: içerik her zaman
-- "adisyon"dur, hedef ise kullanıcının o anki kararıdır (kasa yazıcısı arızalıysa
-- Izgara'dan bastır). Kolon fiziksel yönlendirmeyi içerik tipinden ayırır.
--
-- SEMANTİK: NULL = "hedef belirtilmemiş" = bugünkü davranış, bit-bit (kind
-- filtresi geçerli). DOLU = yalnız o agent bu işi çekebilir; kind filtresini
-- EZER (K1.3) ve hedefi dışındaki hiçbir agent işi reclaim EDEMEZ.
--
-- VERİ ETKİSİ: mevcut satırlar NULL kalır → mutfak istasyon yönlendirmesi
-- (ADR-032 Amd1) ve agent binary'si HİÇ değişmez. DEFAULT / NOT NULL / CHECK /
-- backfill YOK → tablo yeniden yazımı yok, kilit süresi ~ms.
--
-- ON DELETE SET NULL: agent satırı silinirse (normalde revoke edilir, silinmez —
-- Amd2 K8) hedefli iş sonsuza dek kilitli kalmaz, genel havuza düşer. CASCADE
-- YASAK: baskı işini silmek denetim izini siler.
--
-- COMPOSITE FK (db-migration-guard bulgusu, HIGH — düzeltildi): `agents(id)`'e
-- tek-kolonlu FK yalnız id'nin VARLIĞINI doğrular, `agents.tenant_id =
-- print_jobs.tenant_id` eşleşmesini DOĞRULAMAZ — cross-tenant bir
-- target_agent_id DB katmanında engellenmez (uygulama katmanı 404 ile
-- korusa da, bu tek katmanlı savunma olurdu). Migration 043'ün composite-FK +
-- kolon-spesifik `ON DELETE SET NULL` deseni birebir izlenir (aynı bug sınıfı:
-- kolon-listesiz SET NULL, tenant_id NOT NULL'ı da null'layıp 23502 ile patlar).
-- `agents` şimdiye kadar hiçbir composite FK hedefi olmadığı için (id, tenant_id)
-- unique constraint'i yoktu — print_jobs'ın KENDİ (id, tenant_id) deseniyle
-- birebir eklenir.
--
-- GERİ ALMA: `DROP COLUMN` YASAKTIR — canlı claim SELECT'i kolonu okur, düşürmek
-- her agent poll'unu 42703 ile patlatır. Doğru geri alma: kod revert +
-- `pm2 restart pos-api`; şema olduğu gibi kalır (kolon nullable ve nötr).

ALTER TABLE agents
  ADD CONSTRAINT agents_id_tenant_id_uq UNIQUE (id, tenant_id);

ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS target_agent_id uuid NULL;

ALTER TABLE print_jobs
  ADD CONSTRAINT print_jobs_target_agent_id_tenant_id_fkey
  FOREIGN KEY (target_agent_id, tenant_id) REFERENCES agents (id, tenant_id)
  ON DELETE SET NULL (target_agent_id);

-- Kısmi index: hedefli işler azınlıktır → INSERT maliyeti minimum. Hem claim'in
-- hedef dalını hem FK'nin parent-delete kontrolünü korur.
CREATE INDEX IF NOT EXISTS print_jobs_target_agent_idx
  ON print_jobs (target_agent_id)
  WHERE target_agent_id IS NOT NULL;

COMMENT ON COLUMN print_jobs.target_agent_id IS
  'Hedef yazıcı (agent) — ADR-032 Amendment 4. NULL = hedef belirtilmemiş: iş, payload.kind filtresini beyan eden herhangi bir agent tarafından çekilir (bugünkü davranış). DOLU = yalnız bu agent çekebilir; kind filtresini EZER ve başka agent reclaim edemez. Mutfak işleri (enqueue-kitchen-job) DAİMA NULL bırakır.';
