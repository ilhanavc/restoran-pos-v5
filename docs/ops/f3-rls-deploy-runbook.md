# F3 RLS Batch Deploy Runbook — Tenant İzolasyonu Prod'a İndirme

> **Kapsam:** F1 (`withTenant` altyapısı) + F2 (RLS `tables`/`areas`, Migration 054) +
> M4 (prod rol boot-assertion) + F3a (`orders`, 055) + F3b (`order_items`, 056) +
> F3c (`payments`+`payment_items`, 057). Hepsi main'de (`ae5774d`), prod'a HİÇ inmedi.
> **Kaynak:** ADR-041 + `deploy.md §4` (normal prosedür) + `§6.1` (RLS bootstrap).
> **Bu belge Claude tarafından tek başına KOŞULMAZ** — [USER]/[OPS] ile birlikte,
> yoğun-saat DIŞI, SSH onayıyla, rollback hazır.

## 🔴 NEDEN NORMAL DEPLOY'DAN FARKLI (en kritik kural)

Mevcut canlı prod app'i (S124 `86b007f`) `withTenant` sarımları İÇERMEZ. RLS migration'ları
(054-057) `FORCE ROW LEVEL SECURITY` açar → o tablolara context'siz erişim **0 satır** döndürür.
**Normal deploy sırası (`deploy.md §4`: migrate → restart) BU BATCH'TE RESTORANI KIRAR:** RLS
eski-app canlıyken açılırsa, eski-app sipariş/ödeme'yi context'siz sorgular → boş → operasyon durur.

**Doğru sıra:** `withTenant` RLS-KAPALIYKEN zararsızdır (okunmayan bir GUC set eder), RLS-AÇIKKEN
zorunludur. Bu yüzden: **non-RLS migration → YENİ KOD CANLI → SONRA RLS migration.** Yeni app her iki
durumda da çalışır; RLS onun altında güvenle açılır.

## ⚠️ ÖNCE: deploy HANGİ OTURUMDAN koşar (S129 dersi)

Deploy **yalnız kullanıcının kendi bilgisayarında koşan bir Claude Code oturumundan**
yapılabilir (Remote Control / `bridge` oturumu). Sebep: sunucunun SSH anahtarı
(`~/.ssh/restoran_pos_ed25519`) o makinede durur ve `restoranpos.org`'a ağ erişimi
oradan vardır.

**Anthropic bulut konteynerinde koşan bir oturumdan YAPILAMAZ:** anahtar yoktur ve
`restoranpos.org:443` egress politikasında kapalıdır (403 `connect_rejected`).
Bulut oturumu kodu yazar, test eder, PR açar ve merge eder; deploy adımı bilgisayarda
açılan oturuma devredilir.

**Hangi oturumda olduğunu anlamak:** proje yolu `D:\dev\restoran-pos-v5` ise bilgisayar
(deploy yapılabilir); `/home/user/restoran-pos-v5` + Linux ise buluttur (yapılamaz).

## ADIM 0 — Pre-flight (SADECE OKUMA, karar vermeden)

```bash
# Sunucuya bağlan
ssh -i ~/.ssh/restoran_pos_ed25519 root@167.233.78.127

# (a) Prod migration head — hangi migration'lar zaten uygulı?
sudo -u postgres psql -d pos_prod -tAc \
  "SELECT name FROM pgmigrations ORDER BY run_on DESC LIMIT 6;"
#   Beklenen: 053_... en üstte (051/052/053 S108-S124'te indi). 054-057 GÖRÜNMEMELİ.
#   ⚠️ 054+ görünüyorsa RLS zaten kısmen inmiş → DUR, bu runbook'u revize et.
#   053'ten ÖNCEyse (050/051/052) → non-RLS pending sayısını not et (ADIM 3 için).

# (b) API hangi rolle bağlanıyor? (M4 + withTenant için app_tenant ŞART)
grep -E "DATABASE_URL" /etc/restoran-pos/api.env
#   → postgresql://app_tenant:...@127.0.0.1:5432/pos_prod  (app_tenant OLMALI)
#   ⚠️ migrator/postgres ise → M4 restart'ta exit(1) yapar; ÖNCE app_tenant'a çevir.

# (c) app_tenant rol attribute'ları (NOBYPASSRLS olmalı) + migrator mevcut bypass durumu
sudo -u postgres psql -d pos_prod -tAc \
  "SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname IN ('app_tenant','migrator');"
#   app_tenant → (f, f)  ·  migrator → şu an (f, f) beklenir (ADIM 2'de t'ye çekilecek)

# (d) app_tenant'ın 6 RLS-tablosunda TÜM DML yetkisi var mı (W3 — eksik GRANT ancak
#     RLS aktifken hata olarak yüzeye çıkar → şimdi tam tara)
sudo -u postgres psql -d pos_prod -tAc \
  "SELECT tbl, has_table_privilege('app_tenant',tbl,'SELECT') s, \
          has_table_privilege('app_tenant',tbl,'INSERT') i, \
          has_table_privilege('app_tenant',tbl,'UPDATE') u, \
          has_table_privilege('app_tenant',tbl,'DELETE') d \
   FROM unnest(ARRAY['tables','areas','orders','order_items','payments','payment_items']) tbl;"
#   → her satır t|t|t|t olmalı. Herhangi bir f → o tablo/işlem RLS aktifken 500 verir; DUR, GRANT tamamla.
```

**Karar:** (a) head=053 + (b) app_tenant + (c) app_tenant(f,f) → temiz yol (aşağı). Aksi halde DUR + sapmayı çöz.

## ADIM 1 — Yedek (geri dönüş ağı)

```bash
sudo systemctl start pg-backup.service && systemctl show pg-backup.service -p Result
#   → Result=success  (yeni .age dump lokal + off-site; restore: backup-strategy.md §7)
```

## ADIM 2 — SUPERUSER bootstrap: `migrator BYPASSRLS` (BİR KEZ, kalıcı)

```bash
sudo -u postgres psql -d pos_prod -c "ALTER ROLE migrator BYPASSRLS;"
sudo -u postgres psql -d pos_prod -tAc \
  "SELECT rolbypassrls FROM pg_roles WHERE rolname='migrator';"   # → t
```
Gerekçe (`deploy.md §6.1`): migrator FORCE RLS altında kendi DDL/DML'ine takılmasın. Yalnız superuser
atayabilir; prod migration'ları non-superuser migrator ile koşar → migration İÇİNE konmadı. **KALICI.**

## ADIM 3 — (KOŞULLU) non-RLS migration'ları ÖNCE koş (yalnız ADIM 0'da head < 053 ise)

> head=053 ise BU ADIMI ATLA (051-053 zaten inmiş). head<053 ise: yeni kod bu şemaya bağımlı
> (print_jobs.last_error/target_agent) → restart'tan ÖNCE uygula. `up N` ile SADECE non-RLS olanları:

```bash
cd /opt/restoran-pos && source /root/pos-secrets.env
# N = ADIM 0'da sayılan non-RLS pending adedi (örn. head=050 ise 051,052,053 → N=3)
DATABASE_URL="postgresql://migrator:${PG_MIGRATOR_PASSWORD}@127.0.0.1:5432/pos_prod" \
  ./packages/db/node_modules/.bin/node-pg-migrate -m packages/db/migrations up N
```
Bu migration'lar additive (kolon/index) → eski app tolere eder.

**🔴 ZORUNLU TEYİT (W1 — `up N` sayaç footgun'u):** ADIM 4'e geçmeden ÖNCE head'in tam **053** olduğunu,
054'ün İNMEDİĞİNİ doğrula. Yanlış N ile 054 inerse RLS eski-app canlıyken açılır = runbook'un önlediği kırılma.
```bash
sudo -u postgres psql -d pos_prod -tAc "SELECT name FROM pgmigrations ORDER BY run_on DESC LIMIT 2;"
#   → 053_... en üstte, 054 YOK. 054 görünüyorsa: DERHAL ADIM 4'ü koş (kodu canlı et) VEYA rollback (RLS DISABLE).
```

## ADIM 4 — YENİ KODU CANLI ET (RLS henüz KAPALI → app_tenant sorunsuz çalışır)

```bash
# Lokalde (D:\restoran-pos-v5, main = ae5774d):
GIT_SSH_COMMAND="ssh -i ~/.ssh/restoran_pos_ed25519" git push prod main

# Sunucuda:
cd /opt/restoran-pos
git -C /opt/restoran-pos remote get-url origin   # → /opt/git/restoran-pos.git (GitHub DEĞİL)
git pull origin main
pnpm install --frozen-lockfile \
  --filter "@restoran-pos/api..." --filter "@restoran-pos/db..." --filter "@restoran-pos/web..."
pnpm --filter @restoran-pos/shared-types build   # ŞART (dist-main; atlanırsa ERR_MODULE_NOT_FOUND)
pm2 restart pos-api --time
```
**pm2 restart = M4 boot-assertion çalışır:** prod'da app_tenant (NOBYPASSRLS, non-superuser) doğrular,
değilse `process.exit(1)` (crash-loop). ADIM 0(b) app_tenant teyit ettiği için geçer. **Hemen doğrula:**
```bash
pm2 ls                                       # pos-api ONLINE (restart-loop YOK)
pm2 logs pos-api --lines 20 --nostream       # "exit(1)" / bypassrls hatası OLMAMALI
curl -s https://restoranpos.org/api/health   # {"status":"ok"}
```
⚠️ Crash-loop varsa: DATABASE_URL app_tenant değil → düzelt + restart. RLS henüz kapalı, geri dönüş kolay.

## ADIM 5 — RLS migration'larını koş (054-057) — yeni app artık context sağlıyor

```bash
cd /opt/restoran-pos && source /root/pos-secrets.env
DATABASE_URL="postgresql://migrator:${PG_MIGRATOR_PASSWORD}@127.0.0.1:5432/pos_prod" \
  ./packages/db/node_modules/.bin/node-pg-migrate -m packages/db/migrations up
#   → 054,055,056,057 uygulanır. Her biri kısa ACCESS EXCLUSIVE lock (<1sn/tablo), satır rewrite YOK.
#   (N1) Eşzamanlı uzun bir transaction ALTER'ı kuyruğa sokup yeni sorguları BLOKLAYABİLİR → yoğun-saat
#   dışı (zaten kural). İstenirse ekstra güvence: migration ÖNCESİ ayrı bir psql oturumunda beklemede uzun
#   txn olmadığını gör (`SELECT pid,state,query_start FROM pg_stat_activity WHERE state<>'idle' ORDER BY query_start;`).
```
Bu noktada RLS 6 tabloda AKTİF (tables/areas/orders/order_items/payments/payment_items); canlı app
`withTenant` ile context veriyor → operasyon kesintisiz. **API RESTART GEREKMEZ** (migration şema, kod değil).

## ADIM 6 — Doğrulama + canlı smoke

```bash
# (a) RLS gerçekten ısırıyor mu — app_tenant NOBYPASSRLS teyidi
sudo -u postgres psql -d pos_prod -tAc \
  "SELECT relname, relforcerowsecurity FROM pg_class \
   WHERE relname IN ('orders','order_items','payments','payment_items','tables','areas') ORDER BY 1;"
#   → altısı da force=t

# (b) Uygulama sağlığı
curl -s https://restoranpos.org/api/health
curl -s -o /dev/null -w "%{http_code}\n" https://restoranpos.org/
pm2 ls   # online, restart sayısı beklenen (yeni tabana not düş)
```
**Canlı smoke ([USER], gerçek cihaz/web) — 6 RLS-tablosunun HEPSİ yaz+oku (W2):** sekans güvenliği
`withTenant` kapsam-tamlığına bağlı; herhangi bir sarılmamış canlı yol ADIM 5 sonrası 0-satır/500 verir
(önceki `bulkDelete` HIGH tam bu sınıftı). Açıkça sına:
- **`tables`+`areas`:** masa listesi/board görünüyor · **masa aç** (yeni adisyon) · masa taşı/bölge oku.
- **`orders`+`order_items`:** açık adisyonlar görünüyor · **yeni sipariş** + kalem ekle · mutfak fişi.
- **`payments`+`payment_items`:** **ödeme al** (kasa fişi) · split ödeme · rapor (bugünkü ciro/kapanan siparişler).

**Hepsi VERİ DÖNÜYOR + yazma başarılıysa** RLS + withTenant uçtan uca çalışıyor. Herhangi biri boş/500 → o yol
sarılmamış → rollback (RLS DISABLE) + o call-site'ı withTenant'a sar (ayrı fix PR).

## 🔻 ROLLBACK (restoran kırılırsa — HIZLI, redeploy'suz)

RLS'i anında kapat (yeni app'in `withTenant`'ı tekrar zararsız olur; kod geri alınmaz):
```bash
sudo -u postgres psql -d pos_prod <<'SQL'
ALTER TABLE public.payments      NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.payments      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_items NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.payment_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items   NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.order_items   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders        NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.orders        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.areas         NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.areas         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tables        NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.tables        DISABLE ROW LEVEL SECURITY;
SQL
```
`migrator BYPASSRLS` + policy'ler kalır (zararsız, forward-only §15); yeniden denenebilir. Kod-rollback
gerekirse ayrı: önceki tag'e `git push prod` + restart (ama RLS-off yeni kod zaten çalışır, gerekmez).

## Sıra özeti (tek bakış)
0. Pre-flight (head=053? app_tenant?) → 1. Yedek → 2. `migrator BYPASSRLS` (superuser) →
3. *(koşullu)* non-RLS migrate → 4. **kod push+build+restart (M4 geçer, RLS kapalı)** →
5. **RLS migrate 054-057** → 6. doğrula+smoke. Kırılırsa: RLS DISABLE (yukarı).

## F4 fazları — aynı reçete, kısaltılmış hâli

F1-F3c'den sonra gelen her faz **tek bir RLS migration'ı + önceden merge edilmiş kod**
demektir. Kod zaten canlı olduğu için yukarıdaki ADIM 4 (kod canlı et) ile ADIM 5
(RLS migration) **aynı deploy'da sırayla** koşar; sıra DEĞİŞMEZ (önce kod, sonra RLS).

| Faz | Migration | Tablolar | Prod durumu |
|---|---|---|---|
| F4a | 058 | order_item_attributes, order_item_batches, order_no_counters, call_logs | ✅ canlı (S128) |
| F4b | 059 | products, product_variants, product_attribute_groups, categories, category_attribute_groups, attribute_groups, attribute_options | ✅ canlı (S128) |
| F4c | 060 | customers, customer_phones, customer_addresses | ✅ canlı (S130) |
| F4d-1 | 061 | tenant_settings | ✅ canlı (S131) |
| F4d-2 | 062 | print_jobs | ✅ canlı (S134) |
| **audit_logs** (son data-fazı) | 063 | audit_logs | ✅ **canlı (S134)** — data-fazları BİTTİ, 23 tablo |

**S131 notu — F4d-1 indi, 21 tablo force-RLS.** Bu fazda deploy'a **web build de** dahil
edildi (aynı dalgada `apps/web` değişikliği vardı; web statik `dist`'ten servis ediliyor →
`pnpm --filter @restoran-pos/web build` atlanırsa değişiklik canlıya ÇIKMAZ).

⚠️ **Migration 061 başlığındaki "servis kapalıyken" uyarısı DOĞRU SIRADA GEREKSİZDİR.**
Uyarı, `migration → restart` sırasını varsayıyordu: o sırada eski kod (withTenant'sız) RLS ile
karşılaşır ve defansif default'lara düşerek **sessizce** yanlış rapor penceresi üretir. Ama
runbook'un kilitli sırası **kod ÖNCE, RLS SONRA** olduğu için yeni kod migration'dan önce
canlıdır → eski-kod×RLS penceresi HİÇ OLUŞMAZ. Kalan tek kesinti `pm2 restart`'ın birkaç
saniyesidir (her deploy'da olan). S131'de bu sırayla indi, kesinti/hata gözlenmedi.

**S130 notu — kısaltılmış sıra üçüncü kez birebir çalıştı; canlı smoke ([USER]: müşteri
araması + paket sipariş) TEMİZ.** F4c'de ADIM 2/3 atlandı
(`migrator` BYPASSRLS S128'den kalıcı, head tam bir önceki). Deploy sonrası prod'da
**20 tablo** force-RLS. Server-side smoke: context'le 1667/1207/144 satır, context'siz 0.

**⚠️ Araç tuzağı (S128+S130'da ısırdı):** iç-içe `ssh '... psql -tAc "..."'` alıntıları
PG'ye identifier olarak gidiyor (`column "|" does not exist`) — sorgu sessizce DÜŞER, adım
atlanmış görünür. Doğrusu: `ssh host 'bash -s' <<'EOF'` + SQL'i ayrı tek-alıntı heredoc'la
besle, parametreyi `psql -v tid="$TID"` + `:'tid'` ile geçir.

**Kısaltılmış sıra (F4a/F4b'de iki kez denenmiş):**
1. Pre-flight (salt-okuma): migration head bir öncekinde mi · API rolü `app_tenant` mı ·
   `migrator` BYPASSRLS mi · yeni tabloların app_tenant DML yetkisi tam mı (t|t|t|t) · health ok mu
2. Yedek (`Result=success`)
3. `git push prod main` → sunucuda pull + `shared-types` build + `pm2 restart pos-api`
   → boot log'unda **`M4 OK: DB rolü NOBYPASSRLS`** görülmeli
4. N1 guard (uzun txn yok) → `migrate` → yeni tablolarda `force=t enable=t` teyidi
   (sorguya **`relkind='r'` + `nspname='public'`** koy — S128'de filtresiz sorgu sahte satır verdi)
5. Server-side smoke: app_tenant + gerçek tenant context ile ilgili tablolardan okuma
   **non-zero** dönmeli (sıfır = context kopuk) + prod log'da RLS hatası taraması
6. Rollback (gerekirse): o fazın tablolarında `NO FORCE` + `DISABLE` — migration başlığında hazır

### ⚠️ F4c'ye özel — RESTORAN KAPALIYKEN KOŞ (✅ S130'da uygulandı)

F4c müşteri tablolarını kilitler. Migration ile restart arasındaki **saniyeler** içinde
eski kod (withTenant'sız) müşteri tablolarını **sıfır satır** görür. Pratik sonucu:
müşteri listesi/arama boş, **paket siparişte `CUSTOMER_NOT_FOUND`**, arayan popup'ı isimsiz.
Veri bozulmaz, hatalar gürültülüdür, ama akşam servisinde bu birkaç saniye bile kabul edilemez.

- **Servis kapalıyken** koş (F4b 17:28'de indi; F4c için gün sonu).
- Migration→restart arasını minimize et; ikisini ardışık tek oturumda yap.
- Kâğıt fişler bu pencereden ETKİLENMEZ (`enqueuePackingJob` zaten sipariş tx'inin
  context'ini miras alıyor) — kuryenin adresi kâğıttan düşmez.
- Deploy sonrası smoke: bir **müşteri araması** + bir **paket sipariş** (ikisi de F4c'nin
  kırabileceği iki yol).
- Ayrıca: `scripts/import-v3-customers.ts` artık `withTenant` altında koşuyor; app_tenant
  DATABASE_URL ile çalıştırmak güvenli (F4c öncesinde RLS ile çakışırdı).

## Bilinen sınırlar / notlar
- **Deploy borcu SIFIR (S134):** F1→`audit_logs` **hepsi prod'da**, **23 tablo force-RLS**, RLS **data-fazları BİTTİ**. Kalan yalnız F4e (`agents`/`users`/`refresh_tokens`, login-resolution ADR'si).

#### audit_logs deploy koşum kaydı (2026-09-29 13:11-13:30 UTC / 16:11-16:30 TR)

Sapmalı sıra (K7) **birebir çalıştı**: `pg-backup` ✅ → **rol** (`ALTER ROLE cron_purger LOGIN PASSWORD … CONNECTION LIMIT 4`, parola sunucuda `openssl rand -hex 24` ile üretilip `/etc/restoran-pos/api.env` + `/root/pos-secrets.env`'e yazıldı, ekrana hiç basılmadı) → **gerçek bağlantı testi** (`current_user=cron_purger` — `pg_hba` teyidi, runbook'ta olmayan ama kritik adım) → `git push prod` (`326a3af`→`6d8a03f`) → pull+install+`shared-types build`+`pm2 restart` → **M4 OK ve M5 OK ikisi de** → N1 guard `0` → mig 063 (`PGOPTIONS='-c lock_timeout=3s'`) → doğrulama.

Kanıt: force-RLS **22→23** · policy'ler `cmd=INSERT` + `cmd=SELECT` (UPDATE/DELETE **yok**) · GRANT `audit_I:true tenants_S:true` · smoke **context'siz 0 / context ile 11.246** · **app_tenant DELETE → 0 satır** (denetim izi korunuyor) · health ok · nginx'te migration sonrası **0 adet 500**.

**Uçtan uca canlı kanıt (gerçek trafik):** 13:25:51'de `order.paid` + `order.takeaway_stage_changed` ×2 audit satırı RLS altında yazıldı.

⚠️ **Kalan izleme:** o üç satır "miras yoluyla güvenli" (F3a) gruptandı. Bu PR'da **yeni sarılan** 15 yol canlıda henüz tetiklenmedi → ilk kullanımda izlenmeli: müşteri kaydı/telefon/adres (9) · kullanıcı yönetimi (4) · yazıcı ayarı (1) · **rapor CSV indirme** (1) · denetim günlüğü ekranı (okuma). Herhangi biri **500** verirse o sarım eksik demektir → rollback + fix.

### ⚠️ audit_logs son-fazı — SIRA FARKLI (ADR-041 Amd5 K7)

Bu faz kısaltılmış reçeteyi **izlemez**; normal sıra "kod ÖNCE, RLS SONRA"dır, burada **rol adımı en BAŞA** girer:

| # | Adım | Neden bu sırada |
|---|---|---|
| 1 | **superuser:** `ALTER ROLE cron_purger LOGIN PASSWORD '<vault>' CONNECTION LIMIT 2;` | Rol `000_init:23`'te `BYPASSRLS NOLOGIN`; eksik olan yalnız LOGIN+parola. Reçete: `deploy.md §6.1.1` |
| 2 | `CRON_DATABASE_URL` API env'ine (`cron_purger` ile) | K2: yeni kod bu env olmadan prod'da **AÇILMAZ** (fail-fast) |
| 3 | kod deploy + `pnpm install` + `shared-types build` + `pm2 restart` | Log'da **İKİ** satır beklenir: `M4 OK: NOBYPASSRLS` **ve** `M5 OK: cron bağlantısı BYPASSRLS` |
| 4 | migration **063** — ⚠️ `SET lock_timeout='3s'` ile koş | GRANT'ler burada gelir (`audit_logs` INSERT + `tenants` SELECT) |
| 5 | doğrulama + canlı smoke | aşağıda |

**Neden 1-2 koddan önce:** K2 gereği `CRON_DATABASE_URL` yoksa prod'da `throw` → API açılmaz. Rol/env hazır olmadan kod deploy edilirse servis düşer.

⚠️ **`lock_timeout` — bu fazda emsalden farklı öneri (migration-guard CONCERN-2).** Migration tamamen katalog işlemi (satır rewrite yok, 11.478 satır süreyi etkilemez), ama aldığı kilit `ACCESS EXCLUSIVE` ve `audit_logs` projenin **en sıcak yazma yolu** — her mutasyon oraya bir INSERT atıyor. Uzun süren bir transaction varsa migration kuyruğa girer ve **arkasında tüm audit INSERT'lerini, dolayısıyla tüm mutasyonları** bekletir. 054-062'nin hiçbiri `lock_timeout` kullanmadı (emsal), ama burada risk daha yüksek:
```bash
DATABASE_URL="postgresql://migrator:${PG_MIGRATOR_PASSWORD}@127.0.0.1:5432/pos_prod" \
  PGOPTIONS='-c lock_timeout=3s' ./packages/db/node_modules/.bin/node-pg-migrate -m packages/db/migrations up
```
Takılırsa migration temiz düşer (uygulama donmaz) → uzun txn'i bul, tekrar koş.

**Risk profili — F4d-2'nin TERSİ ama tam değil:**
- **Gürültülü (baskın):** eksik bir sarım → audit INSERT'i policy'ye takılır → **500**. Müşteri CRUD (9 site), kullanıcı yönetimi (4), yazıcı ayarı (1), **tüm rapor CSV'leri** (1) anında durur. Veri kaybı YOK (audit mutasyonla aynı tx → 500 = tam rollback). Mevcut Sentry RLS alarmı bunu yakalar.
- **Sessiz (dört yol):** `customer.history_viewed` (yanıt sonrası + try/catch → **KVKK PII-okuma izi** kaybolur) · üç cron self-audit (try/catch) · denetim ekranı okuması (0 satır + HTTP **200** → ekran sessizce boşalır). Bunları alarm yakalamaz → smoke'ta elle bakılmalı.

⚠️ **Yoğun saat DIŞI ŞART** (500 riski müşteri CRUD'unu durdurur).

**Acil rollback:** `ALTER TABLE public.audit_logs NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.audit_logs DISABLE ROW LEVEL SECURITY;` — GRANT'ler ve `cron_purger` LOGIN geri alınmaz (zararsız); yeni kodun sarımları RLS kapalıyken de doğru çalışır.

**Deploy sonrası doğrulama:**
```bash
# (a) 23 tablo force-RLS + policy'ler komut-spesifik olmalı
sudo -u postgres psql -d pos_prod -tAc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relforcerowsecurity"
sudo -u postgres psql -d pos_prod -tAc "select policyname||' cmd='||cmd from pg_policies where tablename='audit_logs' order by 1"
#   → audit_logs_tenant_insert cmd=INSERT · audit_logs_tenant_select cmd=SELECT (UPDATE/DELETE policy YOK)
# (b) GRANT'ler
sudo -u postgres psql -d pos_prod -tAc "select 'audit_I:'||has_table_privilege('cron_purger','public.audit_logs','INSERT')||' tenants_S:'||has_table_privilege('cron_purger','public.tenants','SELECT')"
# (c) M4+M5 birlikte
pm2 logs pos-api --lines 40 --nostream | grep -E "M4 OK|M5 OK|M5 FAIL"
```
**Canlı smoke [USER]:** müşteri kaydı ekle/güncelle · kullanıcı ekle · bir rapor CSV indir · **denetim günlüğü ekranını aç (BOŞ OLMAMALI)** → hepsi 500 vermemeli. Ertesi gün: `audit.purge` event'i **üç task için** yazılmış olmalı (`deleted_count` baseline: `print_jobs` ~200, `call_logs` ~20, `audit_logs` 0 — 2 yıl retention, ilk gerçek silme 2028'de).
- `repositories/{payments,orders}.ts create()` test-only own-tx footgun (route'a bağlanırsa withTenant şart) — prod riski yok (route yok).
- **F4d-1 (tenant_settings) CANLI (S131).** Kalan: F4d-2 (print_jobs, mig 062 — kod hazır, prod'a inmedi) ve audit_logs son-fazı (henüz yazılmadı).

### F4d-2 (print_jobs) — ✅ CANLI (S134, 2026-09-29 11:10 TR)

Kısaltılmış sıra **dördüncü kez birebir** çalıştı. Koşum kaydı:
`pg-backup` (Result=success) → `git push prod main` (13408dd→326a3af) → sunucuda pull +
`pnpm install` + `shared-types build` + `pm2 restart` → **M4 OK: NOBYPASSRLS** → mig 062 → doğrulama.
ADIM 2/3 atlandı (migrator BYPASSRLS kalıcı, head tam bir önceki = 061). `apps/web` bu dalgada
değişmediği için **web build gerekmedi** (git diff ile teyit edildi).

Doğrulama kanıtı: force-RLS tablo sayısı **21→22** · `print_jobs` `t|t` ·
**app_tenant context'siz `0` / context ile `2495`** · `/api/health` ok · web 200 ·
pm2 online, restart-loop yok · migration sonrası hata log'u YOK ·
üç agent (IZGARA/FIRIN/KASA) poll ediyor, `204` (kuyruk boş — beklenen).

⚠️ **`204` tek başına kanıt DEĞİL** — sarım eksik olsaydı da 204 dönerdi (sessiz-bozulma sınıfı,
Amd4 K5). Claim yolunun uçtan uca kanıtı **gerçek fiş baskısıdır** → [USER] smoke.

✅ **[USER] SMOKE TAMAM (2026-09-29 11:20 TR):** paket siparişinde mutfak + kasa fişi ikisi de
doğru bastı. DB teyidi: ilgili job'lar `success` ve **`attempts: 0`** — attempt sıfır olması
result handler sarımının kanıtıdır (kırık olsaydı 404 → `printing` → 90 s reclaim → attempts
artar → aynı fiş ikinci kez basılır). Yazıcı ekranı `0 bekliyor / 0 başarısız` gösterdi; bu
**doğru** — süperuser sorgusu da `queued/retry/failed = 0` verdi.

> **🔎 Sonraki faz için not — `0/0` çift anlamlıdır.** Kuyruk derinliğinin sıfır görünmesi hem
> "sağlıklı boş kuyruk" hem "RLS kırık, satırlar görünmüyor" durumunda aynıdır. Ayırt etmenin
> tek yolu süperuser (RLS-bypass) sorgusuyla gerçek sayıyı karşılaştırmaktır:
> `sudo -u postgres psql -d pos_prod -tAc "select count(*) from print_jobs where status in ('queued','retry','failed')"`
> İki değer uyuşuyorsa ekran doğrudur. Aynı mantık `attempts` için de geçerli: canlıda result
> yolunun kanıtı `attempts` sütununun ARTMAMASIDIR.

#### Deploy notları (ADR-041 Amd4)

- **Yeni rol / parola / env adımı YOK.** `cron_purger` bu fazın kapsamı DIŞI (Amd4 K1): `print_jobs`
  purge'ünde `tenant_id IS NULL` pass'i yok (`cron/ttl-cleanup.ts:20`) → per-tenant, `withTenant`
  yeter. `CRON_DATABASE_URL`'i hiçbir kod okumuyor. Amd3'ün "F4d ön-görüsü" bu kararla geri alındı.
  cron_purger, gerçekten NULL-tenant yazan `audit_logs` son-fazına kalır.
- **Kilitli sıra (kod ÖNCE, RLS SONRA) bu fazda da geçerli** → eski-kod×RLS penceresi oluşmaz.
  Sıra bozulur da migration kod'dan önce koşarsa: baskı durur ve **sessizdir** (agent 204 alır,
  hata/log yok). ✅ **Fiş KAYBI olmaz** — job'lar `queued` kalır, doğru kod canlıya geçince basılır.
  Yine de yoğun saat dışı koş.
- **Web build gerekmez** — bu dilimde `apps/web` değişmedi.
- **Acil rollback** (baskı durursa): `ALTER TABLE public.print_jobs NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.print_jobs DISABLE ROW LEVEL SECURITY;` — yeni kodun sarımları RLS kapalıyken
  zararsızdır.
- **Deploy sonrası smoke [USER]:** gerçek fiş baskısı (mutfak + paket) + yazıcı yönetim ekranında
  kuyruk derinliğinin 0/0 DEĞİL gerçek değer gösterdiği + ertesi gün cron'un `audit.purge`
  event'inde `table:'print_jobs'` için `deleted_count > 0` yazdığı.
- **Sentry alarmı (Amd4 K6):** mevcut RLS-regresyon alarmı bu fazı KAÇIRIR — 204 ve
  `deleted_count:0` sağlıklı yanıt desenleridir. Eklenecek: (a) bir agent'ın ardışık N poll'unda
  sürekli 204 + kuyrukta `queued` job varken; (b) `audit.purge`'de `print_jobs` + `deleted_count:0`.
