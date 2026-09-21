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

# (d) app_tenant'ın RLS'lenecek tablolarda DML yetkisi var mı (izolasyon işe yarasın)
sudo -u postgres psql -d pos_prod -tAc \
  "SELECT has_table_privilege('app_tenant','orders','SELECT'), \
          has_table_privilege('app_tenant','payments','INSERT');"
#   → t, t
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
**Canlı smoke ([USER], gerçek cihaz/web):** açık adisyonlar görünüyor mu · yeni sipariş aç · ödeme al
(kasa fişi) · rapor (bugünkü ciro) · paket akışı. **Hepsi VERİ DÖNÜYORSA** RLS + withTenant uçtan uca çalışıyor.

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

## Bilinen sınırlar / notlar
- Deploy borcu S125'ten beri birikti; bu batch onu TAMAMEN kapatır (F1→F3c).
- `repositories/{payments,orders}.ts create()` test-only own-tx footgun (route'a bağlanırsa withTenant şart) — prod riski yok (route yok).
- F4+ (customers/products/... RLS) bu batch'te YOK — ADR ile ayrı, ikinci-tenant öncesi.
