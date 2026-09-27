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
- **Deploy borcu SIFIR (S130):** F1→F4c hepsi prod'da, 20 tablo force-RLS.
- `repositories/{payments,orders}.ts create()` test-only own-tx footgun (route'a bağlanırsa withTenant şart) — prod riski yok (route yok).
- F4d (tenant_settings/print_jobs + cron_purger) ve audit_logs son-fazı HENÜZ yazılmadı — sıradaki dilimler.
