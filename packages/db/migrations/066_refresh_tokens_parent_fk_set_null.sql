-- 066_refresh_tokens_parent_fk_set_null.sql
--
-- ⚠️⚠️ BU MIGRATION'IN GEREKÇESİ S136'DA ÇÜRÜDÜ — BUGÜN SAVUNMACI (DEFENSIVE),
-- BU DALGADA KULLANILMIYOR. DÜRÜST BAŞLIK:
--
-- İlk yazımda bu migration "`refresh_tokens` 37 gün retention'ının ÖN KOŞULU"
-- olarak tanımlanmıştı: retention satırları SİLİYORDU ve `parent_id` self-FK'si
-- (`NO ACTION`) yüzünden gecelik purge her gece `23503` ile patlıyordu.
-- Aynı dalga içinde **ürün sahibi retention'ı SİLME'den ANONİMLEŞTİRME'ye
-- çevirdi** (migration 067 + `cron/ttl-cleanup.ts` → `purgeRefreshTokens` artık
-- UPDATE koşuyor, DELETE koşmuyor). Yani bu migration'ın var oluş sebebi olan
-- DELETE **artık yok**.
--
-- 🔬 "O ZAMAN BAŞKA BİR SİLME YOLU BUNA İHTİYAÇ DUYUYOR MU?" — AMPİRİK OLARAK
-- ÖLÇÜLDÜ (pos_test, mig 066 head'inde, FK bilinçli olarak `NO ACTION`'a geri
-- alınıp aynı transaction'da test edildi; A←B←C gerçek RTR zinciri, A 40 gün
-- önce expire / B 3 gün önce / C 20 gün sonra):
--
--   (A1) `deleteAllForUser` (parola sıfırlama, `routes/users.ts:484`;
--        `DELETE … WHERE tenant_id = $1 AND user_id = $2`)
--        → **DELETE 3, hata YOK.**
--   (A2) Eski retention yüklemi (`DELETE … WHERE expires_at < now() - 7 gün`)
--        → **ERROR 23503** … "Key (id)=(…a) is still referenced".
--   (A3) `DELETE FROM users` (mig 018 `ON DELETE CASCADE` → üç token birlikte)
--        → **DELETE 1, hata YOK.**
--
-- 🔑 NEDEN A1/A3 PATLAMIYOR DA A2 PATLIYOR (fark tesadüf değil, yapısal):
-- Postgres'te `NO ACTION` referential kontrolü **ifade sonuna kadar ertelenir**
-- (`RESTRICT`'in aksine, o anındadır). A1 ve A3 bir ailenin/kullanıcının
-- TAMAMINI tek ifadede siler → ifade sonunda artık dangling referans KALMAZ,
-- kontrol geçer. A2 ise aileyi **ortadan böler** (yalnız cutoff'u geçen atayı
-- siler, çocuğu bırakır) → hayatta kalan çocuk silinmiş atasına referans verir.
-- `parent_id` zincir içinde asla tenant/user sınırı aşmadığı için "kullanıcının
-- tüm token'ları" her zaman kapalı bir kümedir; bu yüzden A1/A3 **yapısal
-- olarak** güvenlidir, veriye bağlı bir şans değil.
--
-- ✅ KARAR: migration GERİ ALINMADI, DOSYA SİLİNMEDİ — ama artık retention'ın
-- ön koşulu DEĞİL, **savunmacı bir sağlamlaştırma**dır. Gerekçeleri:
--   • `pos_test`'te zaten uygulanmış ve `pgmigrations`'a yazılmış durumda;
--     forward-only disiplininde (ADR-003 §15) uygulanmış bir migration dosyası
--     geri çekilmez.
--   • `ON DELETE SET NULL` hiçbir mevcut davranışı değiştirmiyor: bugün
--     tetiklenen tek silme yolları A1/A3'tür ve ikisi de aileyi bütün olarak
--     siler → referential action'ın NULL'layacağı bir satır hiç kalmaz.
--   • İleride kısmî bir silme yolu eklenirse (tenant off-boarding, seçmeli
--     oturum temizliği) `23503` yerine sessizce doğru davranır.
-- ⚠️ DÜRÜSTLÜK NOTU: bu bir "latent bug fix" DEĞİLDİR. Bugün ölçülebilir
-- hiçbir bozukluğu düzeltmiyor; ölçüm A1 ve A3'ün 066 OLMADAN da çalıştığını
-- gösterdi. Değeri yalnız ileriye dönüktür.
--
-- ⚠️ `parent_id` NULL'a düşmesinin OPERASYONEL BEDELİ (kayda geçer, "sıfır"
-- değil): `parent_id` uygulama kodunda yalnız YAZILIR, hiç OKUNMAZ
-- (`repositories/refresh-tokens.ts:104` yazar; `auth/refresh.ts:290` üretir).
-- Reuse-detection ve grace penceresi `token_hash` + `family_id` +
-- `revoked_reason` üzerinden çalışır (`findByTokenHash`,
-- `findActiveByFamilyForUpdate`, `countGraceRecoveries`) — `parent_id`'ye
-- DOKUNMAZ. Ama kolon geçmişte **gerçek bir olay teşhisinde kullanıldı**
-- (`.claude/memory/decisions.md:4226` — aynı ebeveynden iki çocuk = rotasyon
-- çatallanması). Bugün hiçbir silme yolu onu NULL'lamadığı için bu adli sinyal
-- de kaybolmuyor; kısmî bir silme yolu eklenirse kaybolmaya başlar. Daha uzun
-- adli pencere gerekirse çözüm FK'yi geri almak DEĞİL, çatallanma tespitini
-- yazım anında (`issueRefreshToken`) yapmaktır.
--
-- FK'yi tamamen DÜŞÜRMEK düşünülmedi: kısıt, canlı zincirde var olmayan bir
-- atayı işaret eden satır yazılmasını hâlâ engelliyor.
--
-- ⚠️ RLS ile İLİŞKİSİ: `refresh_tokens` force-RLS'li (mig 065). FK referential
-- action'ı Postgres'in iç RI tetikleyicisi koşturur; bu tetikleyiciler
-- row-security'den ve çağıran rolün UPDATE yetkisinden BAĞIMSIZDIR → bu
-- migration `cron_purger`'a UPDATE GEREKTİRMEZ. (Anonimleştirme için gereken
-- kolon-seviyesi UPDATE yetkisi ayrı bir karardır → migration 067.)
--
-- Forward-only (ADR-003 §15). Idempotent (ADR-003 §16) — up→up güvenli tekrar
-- (mig 005/018 deseni: DROP CONSTRAINT IF EXISTS → ADD CONSTRAINT).
-- DOWN migration YOK (ev-deseni; runner yalnız `node-pg-migrate up` koşar).
-- ACİL ROLLBACK (operatör manuel) — eski davranışa dönmek:
--   ALTER TABLE public.refresh_tokens DROP CONSTRAINT refresh_tokens_parent_id_fkey;
--   ALTER TABLE public.refresh_tokens ADD CONSTRAINT refresh_tokens_parent_id_fkey
--     FOREIGN KEY (parent_id) REFERENCES refresh_tokens(id);
--   DROP INDEX IF EXISTS public.refresh_tokens_parent_idx;
-- (Rollback artık retention'ı KIRMAZ — retention DELETE koşmuyor. A1/A3 de
-- ampirik olarak `NO ACTION` altında çalışıyor → bugün rollback'in gözlenebilir
-- bir etkisi yoktur. Bu, migration'ın bu dalgada neden düşük riskli olduğunun
-- diğer yüzü.)

-- 🔒 KİLİT PROFİLİ (ÖLÇÜLDÜ). Bu migration aynı transaction'da şu kilitleri
-- tutar: **`AccessExclusiveLock`** (← `DROP CONSTRAINT`'ten gelir, en ağırı)
--   + `ShareRowExclusiveLock` (ADD CONSTRAINT) + `RowShare` + `AccessShare`.
-- `AccessExclusive` commit'e kadar tutulur ve **SELECT'leri de bloklar** — yani
-- yalnız yazmalar değil, login/refresh/logout okumaları da kuyruğa girer.
-- Tarama maliyeti önemsiz (~4.4k satır, milisaniyeler); gerçek risk
-- **kuyruklanmadır**. `lock_timeout='3s'` yalnız kilidi EDİNMEYİ sınırlar;
-- kuyrukta bekleyen istekler en kötü ~3 sn stall olur → yoğun saat DIŞINDA koş.
-- Timeout tetiklenirse migration HIZLI BAŞARISIZ olur; operatör tekrar dener.
--
-- `NOT VALID` + `VALIDATE CONSTRAINT` iki-adımı GEREKSİZ (ölçüldü): `NOT VALID`
-- varyantı da aynı tx'te `AccessExclusiveLock` alır çünkü `DROP CONSTRAINT`
-- zaten eskale ediyor → iki-adım hiçbir kilit kazancı sağlamaz.
SET lock_timeout = '3s';

ALTER TABLE public.refresh_tokens
  DROP CONSTRAINT IF EXISTS refresh_tokens_parent_id_fkey;

ALTER TABLE public.refresh_tokens
  ADD CONSTRAINT refresh_tokens_parent_id_fkey
  FOREIGN KEY (parent_id) REFERENCES public.refresh_tokens (id)
  ON DELETE SET NULL;

-- `parent_id` üzerinde index YOKTU. Referential action'ın RI tetikleyicisi
-- silinen her satır için `… WHERE parent_id = $1` koşar; index'siz her biri seq
-- scan olur.
--
-- ⚠️ BU INDEX'İN GEREKÇESİ DE KÜÇÜLDÜ (dürüstlük notu): ilk yazımda "gecelik
-- toplu DELETE her gece ~2.6k satır silecek" denmişti. Retention artık
-- silmiyor (mig 067) → RI tetikleyicisini tetikleyen tek yollar
-- `deleteAllForUser` (parola sıfırlama) ve `DELETE FROM users` kaldı; ikisi de
-- seyrek ve tek kullanıcı kapsamlı. Yani index bugün **ölçülebilir bir kazanç
-- sağlamıyor**; savunmacı olarak bırakılıyor (partial index, `parent_id IS NOT
-- NULL` → boyutu küçük, yazma yolu bedeli satır başına tek giriş).
CREATE INDEX IF NOT EXISTS refresh_tokens_parent_idx
  ON public.refresh_tokens (parent_id)
  WHERE parent_id IS NOT NULL;
