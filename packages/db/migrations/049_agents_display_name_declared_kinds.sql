-- Migration 049 — ADR-032 Amendment 2 (yazıcı yönetim ekranı — görünürlük)
--
-- Forward-only (ADR-003 §9.5c) — DOWN migration yok.
--
-- NEDEN: Yazıcı yönetim ekranı (ADR-032 Amd2 Dilim A) iki gözlem alanına
-- ihtiyaç duyar. Bugün `agents` tablosu yalnız kimlik + canlılık taşıyor
-- (id · tenant_id · device_fingerprint · api_key_hash · last_seen_at ·
-- revoked_at · revoke_reason · created_at); admin ne yazıcıya insan-etiketi
-- verebiliyor ne de agent'ın gerçekte hangi iş türlerini çektiğini görebiliyor.
--
-- display_name (K1): istasyon etiketi — "Fırın", "Izgara", "Kasa". Amd1'in
-- yarattığı adlandırma borcunu kapatır: `kitchen` kind'ı artık "mutfak" değil
-- "fırın/taban istasyon" anlamındadır; slug'ı değiştirmek canlı `print_station`
-- verisini kırar, insan-etiketi bu farkı kullanıcı gözünde kapatır. NULL iken
-- UI device_fingerprint'e düşer. Fiş üstündeki FIRIN/IZGARA etiketi AYRI
-- katmandır (print/resolve-item-stations.ts) — bu kolon fişi DEĞİŞTİRMEZ.
--
-- declared_kinds (K2): GÖZLENEN iş-türü kümesi — claim ucu (GET /jobs/next)
-- agent'ın gönderdiği `?kind=` dizisini fire-and-forget buraya yazar. OTORİTER
-- DEĞİLDİR: claim SELECT/filtre davranışı DEĞİŞMEZ (ADR-032 Design B korunur).
-- Yalnız teşhis: NULL = agent hiç kind bildirmedi → UI "filtresiz çekiyor"
-- uyarısı bundan beslenir (ADR-032'nin ölçülemeyen riski ilk kez görünür).
--
-- GÜVENLİ (K12): ikisi de nullable · DEFAULT yok (tablo yeniden yazımı YOK) ·
-- NOT NULL yok · index yok (tablo ≤4 satır) · CHECK yok · backfill yok. Deploy
-- anında davranış DEĞİŞMEZ (display_name NULL → UI fingerprint'e düşer;
-- declared_kinds NULL → ilk poll'da saniyeler içinde dolar). ADR-031 K12
-- CONCURRENTLY gate'i TETİKLENMEZ (index yok). `categories` · `products` ·
-- `print_jobs` · `orders` tablolarına HİÇ DOKUNULMAZ.

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS display_name TEXT;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS declared_kinds TEXT[];

COMMENT ON COLUMN agents.display_name IS
  'ADR-032 Amd2 K1: yazıcının admin tarafından verilen istasyon etiketi (ör. "Fırın", "Izgara", "Kasa"). NULL iken UI device_fingerprint gösterir. Fiş üstündeki FIRIN/IZGARA etiketinden AYRI katman — bu değer fişi değiştirmez.';

COMMENT ON COLUMN agents.declared_kinds IS
  'ADR-032 Amd2 K2: agent''ın claim anında bildirdiği iş-türü kümesi (?kind=), fire-and-forget yazılır. GÖZLENEN — claim filtresinde KULLANILMAZ (Design B). NULL = kind bildirilmedi → UI "filtresiz çekiyor" uyarısı.';
