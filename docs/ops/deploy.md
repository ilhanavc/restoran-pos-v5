# Deploy Runbook — Restoran POS v5 (Prod)

> Kaynak kararlar: **ADR-031** (K1 topoloji · K2 domain/SSL · K3 deploy modeli) + ADR-001 §7 (migrator kontratları) + ADR-023 (yedekleme — ayrı runbook: `backup-strategy.md`).
> İlk kurulum **Session 81'de (2026-07-04)** uygulandı ve doğrulandı; bu doküman as-built kayıttır.
> Deploy modeli: **manuel** (ADR-031 K3). CI/CD otomasyonu pilot stabilize olunca ayrı iş (v5.1).

## 1. Mimari özet

- **Tek sunucu** (ADR-031 K1): Hetzner Cloud **CX23** (2 vCPU / 4 GB / 40 GB), Falkenstein/Almanya (KVKK), ~$7/ay. API + PostgreSQL 17 + Nginx aynı box; PM2 **tek instance** (cluster YOK — ADR-010 §5).
- **Domain** (K2): `restoranpos.org` (Namecheap; A kayıtları `@` + `www` → sunucu IP). **Path-based routing** — ayrı `api.` subdomain YOK:
  - `/` → web statik (`/srv/restoran-pos/current/apps/web/dist`, SPA fallback; `/assets/` → `/srv/restoran-pos/shared/web-assets/` havuzu — §11.4)
  - `/api/` → `127.0.0.1:3001/` (**prefix STRIP** — API route'ları root-mount, health = `/health`)
  - `/socket.io/` → `127.0.0.1:3001/socket.io/` (WebSocket upgrade başlıkları zorunlu)
- **SSL:** Let's Encrypt (certbot --nginx), otomatik yenileme timer'ı aktif, HTTP→HTTPS redirect.
- **Web build'e env GEREKMEZ:** `VITE_API_BASE_URL` default `/api`, `VITE_SOCKET_URL` default `''` (same-origin) — `apps/web/src/lib/env.ts`.

## 2. Prod envanteri (as-built)

| Öğe | Değer |
|---|---|
| Sunucu | `restoran-pos-prod` · IP `167.233.78.127` · Ubuntu 24.04 LTS · Hetzner projesi `restoran-pos` |
| SSH | `ssh -i ~/.ssh/restoran_pos_ed25519 root@167.233.78.127` (yalnız anahtar; parola girişine güvenme) |
| Kod | `/srv/restoran-pos/releases/<UTC>-<sha7>` + `current` işaretçisi (ADR-047, §11) ← `pos-release build` ile `/opt/git/restoran-pos.git`'ten (bare; lokal `prod` remote'u buraya push'lar). Eski çalışma kopyası `/opt/restoran-pos` 2026-11-24 cutover'ından sonra **30 gün dokunulmaz** (geri alma yolu), sonra arşivlenir |
| API süreci | PM2 `pos-api` → `/srv/restoran-pos/bin/run-api.sh` (env source + `POS_RELEASE_ID` + `cd current/apps/api` + `tsx src/index.ts`; API'de dist build YOK, `build`=typecheck) |
| Kalıcılık | `pm2-root.service` enabled + `pm2 save` → reboot sonrası otomatik ayağa kalkar |
| Nginx site | `/etc/nginx/sites-available/restoranpos` (certbot SSL bloklarını buraya enjekte etti) |
| DB | `pos_prod` @ localhost:5432 (PG **yalnız localhost dinler**, internete kapalı) |
| Secrets | `/root/pos-secrets.env` (üretim değerleri, 600) + `/etc/restoran-pos/api.env` (API runtime env, 600) |
| Güvenlik | UFW: yalnız 22/80/443 · fail2ban aktif · unattended-upgrades kurulu |
| Node/pnpm | Node 22 (NodeSource) + corepack pnpm (sürüm root `package.json` `packageManager`'dan) |

## 3. Ortam değişkenleri (`/etc/restoran-pos/api.env`)

| Değişken | Not |
|---|---|
| `NODE_ENV=production` | Secure cookie şartı |
| `PORT=3001` | Nginx proxy hedefi |
| `DATABASE_URL` | `postgresql://app_tenant:<PG_APP_PASSWORD>@127.0.0.1:5432/pos_prod` — API **app_tenant** ile bağlanır |
| `JWT_ACCESS_SECRET` / `JWT_AGENT_SECRET` | `openssl rand -hex 48` |
| `BRIDGE_TOKEN` | Caller Bridge eşleşmesi (`openssl rand -hex 32`) |
| `WEB_ORIGIN=https://restoranpos.org` | CORS + Socket.IO origin |
| `TENANT_ID` | **Bootstrap sonrası** eklenir — bootstrap'in ürettiği gerçek tenant UUID ile EŞLEŞMELİ (ADR-031 K4). **ADR-042'den beri anlamı: varsayılan (legacy) tenant** — işletme kodu göndermeyen istemciler ve öneksiz refresh token'lar buraya düşer. Env adı bilerek değişmedi |
| `E2E_BYPASS_LOGIN_LIMIT` | Prod'da **ASLA set edilmez** (`/auth/*` üç kovasının tamamını bypass eder; ADR-002 Amd8'den beri kodda `NODE_ENV=production` guard'ı var ve bu değişkeni yok sayar — bu satır defense-in-depth) |
| `E2E_BYPASS_BRIDGE_LIMIT` | Prod'da **ASLA set edilmez** (GUV-3 — bridge /incoming rate-limit bypass; kodda `NODE_ENV=production` guard'ı zaten yok sayar, bu satır defense-in-depth) |
| `E2E_BYPASS_CUSTOMER_HISTORY_LIMIT` | Prod'da **ASLA set edilmez** (customer-history/rehber rate-limit bypass; kodda `NODE_ENV=production` guard'lı, defense-in-depth) |
| `SENTRY_DSN` | Hata izleme (§3.2 A). Sır sayılmaz, yalnız kötüye kullanımda değişir (§12) |
| `CRON_DATABASE_URL` | `postgresql://cron_purger:<PG_CRON_PURGER_PASSWORD>@…/pos_prod` — retention cron'unun BYPASSRLS bağlantısı (§6.1.1). Açılışta doğrulanır; bozuksa **API açılmaz** |
| `PRINT_AGENT_EXPECTED_VERSION` | Yazıcı kartındaki "Güncelleme bekliyor" rozetinin referansı (§10.4); sır değil |

Sırların tamamı, rotasyon sıklığı ve reçeteleri: **§12**.

Migration için ayrıca: `MIGRATOR_DATABASE_URL` = `postgresql://migrator:<PG_MIGRATOR_PASSWORD>@127.0.0.1:5432/pos_prod` (kalıcı env'e yazılmaz; deploy anında `/root/pos-secrets.env`'den türetilir).

⚠️ **Secrets dosyası tuzağı:** dosya üretimi `if [ ! -f ]` guard'lıysa eski/yarım dosya korunur → değişkenler boş gider. Kullanmadan önce doğrula:
`awk -F= '{print NR": "$1" len="length($2)}' /root/pos-secrets.env` (**7 satır**, len>0 olmalı — 2026-11-25 sunucudan okundu: `JWT_ACCESS_SECRET` · `JWT_AGENT_SECRET` · `BRIDGE_TOKEN` · `PG_MIGRATOR_PASSWORD` · `PG_APP_PASSWORD` · `PRINT_AGENT_API_KEY` · `PG_CRON_PURGER_PASSWORD`).

ℹ️ API bu dosyayı **okumaz** — çalışan değerler `api.env`'dedir (`run-api.sh` → `set -a; source`). `pos-secrets.env` üretim değerlerinin kaydı ve migrator şifresinin kaynağıdır; bir sır değişince **ikisi birlikte** güncellenir (§12).

## 3.2 Observability + yedek-alarm aktivasyonu (ADR-040 — OPS-4/5)

> Kod S122'de indi ama **DSN/URL yoksa no-op** (güvenli). Aktive etmek için aşağıdaki 3 secret girilir. Değerler [USER] tarafından oluşturulur (hesap açma + secret Claude tarafından yapılamaz).

**A) Sentry Cloud — EU region (OPS-4).**
1. [sentry.io](https://sentry.io) → kayıt ol. **⚠️ Data region = Europe (Frankfurt)** — org oluşturulurken seçilir, **sonradan değiştirilemez** (KVKK).
2. İki proje aç: platform **Node.js** (→ `SENTRY_DSN`, api) + platform **React** (→ `VITE_SENTRY_DSN`, web). DSN'ler `https://…@o…ingest.de.sentry.io/…` biçiminde (`.de.` = EU; kod EU değilse uyarır).
3. **api (runtime):** `/etc/restoran-pos/api.env`'e ekle → restart:
   ```bash
   echo 'SENTRY_DSN=https://<api-dsn>@o<org>.ingest.de.sentry.io/<proj>' >> /etc/restoran-pos/api.env
   pm2 restart pos-api --update-env    # log: "[sentry] hata izleme etkin (EU region)"
   ```
4. **web (build-time — bundle'a gömülür, PUBLIC):** `apps/web/.env.production` (gitignore, sunucu-lokal) oluştur → web'i yeniden derle:
   ```bash
   echo 'VITE_SENTRY_DSN=https://<web-dsn>@o<org>.ingest.de.sentry.io/<proj>' > /opt/restoran-pos/apps/web/.env.production
   cd /opt/restoran-pos && pnpm --filter @restoran-pos/web build
   ```
   (Vite prod modda `.env.production`'ı otomatik yükler; sonraki her deploy build'i de otomatik alır.)
5. **Uptime probe (harici):** healthchecks.io/UptimeRobot'ta `https://restoranpos.org/api/health` için 1-2 dk aralıklı HTTP check → box tümüyle düşse bile alarm.

**B) Yedek dead-man's-switch — healthchecks.io (OPS-5).**
1. [healthchecks.io](https://healthchecks.io) ücretsiz hesap → yeni Check: **Period = 1 day**, **Grace = 2-3 saat** (03:00 yedeğe uygun). Bildirim kanalını (e-posta) doğrula.
2. Check ping URL'ini (`https://hc-ping.com/<uuid>`) `/etc/restoran-pos/backup.env`'e ekle:
   ```bash
   echo 'HEALTHCHECK_URL=https://hc-ping.com/<uuid>' >> /etc/restoran-pos/backup.env
   sudo systemctl start pg-backup.service    # test: healthchecks.io'da check "up" olmalı
   ```
   Beklenen pencerede ping gelmezse (timer bozuk / box down / dump fail) healthchecks.io **kendisi** alarm üretir. Ayrıntı: `backup-strategy.md §3.1`.

> ⚠️ Bu üç env de secret'tır — repoya commit edilmez; `E2E_BYPASS_*` env'leri prod'da ASLA set edilmez (§3 tablosu).

## 4. Normal deploy prosedürü

> ⛔ **Cutover yapıldı (2026-11-24, ADR-047):** bu bölümdeki sunucu akışı (`cd /opt/restoran-pos && git pull … pm2 restart`) **ARTIK KULLANILMAZ** — canlı kod `/opt`'ta değil. Deploy: `pos-release deploy` (§11.2) · geri alma: `pos-release rollback` (§11.3). Lokal `git push prod main` adımı, aşağıdaki **doğrulama** (token'sız 401 zinciri, ajan `last_seen_at`) ve **502 notu** hâlâ geçerlidir.

> ⚠️ **Deploy kaynağı = lokal bare repo, GitHub DEĞİL (OPS-11).** Sunucudaki `/opt/restoran-pos` çalışma kopyasının `origin` remote'u `/opt/git/restoran-pos.git` (lokal bare repo, §2 satırı) — **GitHub değil.** Akış iki adımlıdır ve **GitHub'a PR merge etmek TEK BAŞINA prod'a inmez:** (1) lokalden `git push prod main` bare repo'yu günceller, (2) sunucuda `git pull origin main` o bare repo'dan çeker. `git push prod` adımı atlanırsa GitHub güncel olsa bile sunucu eski commit'te kalır (S119'da yaşandı). Canlı olayda sunucudaki `origin`'in GitHub'ı gösterdiğini **varsayma** — doğrula: `git -C /opt/restoran-pos remote get-url origin` → `/opt/git/restoran-pos.git` dönmeli.

**Lokal makinede (D:\restoran-pos-v5):**
```bash
# remote bir kez tanımlanır: git remote add prod ssh://root@167.233.78.127/opt/git/restoran-pos.git
GIT_SSH_COMMAND="ssh -i ~/.ssh/restoran_pos_ed25519" git push prod main
```

**Sunucuda:**
```bash
cd /opt/restoran-pos
git pull origin main   # origin = /opt/git/restoran-pos.git (lokal bare), GitHub DEĞİL — bkz. §4 üstü uyarı
pnpm install --frozen-lockfile \
  --filter "@restoran-pos/api..." --filter "@restoran-pos/db..." --filter "@restoran-pos/web..."

# ŞART — atlanırsa API ERR_MODULE_NOT_FOUND ile çöker (tek dist-main workspace paketi):
pnpm --filter @restoran-pos/shared-types build

# Yalnız migration içeren deploy'da:
#  1) ÖNCE YEDEK — pg-backup.sh env'ini /etc/restoran-pos/backup.env'den alır; doğrudan
#     `sudo -u postgres <script>` çağrısı env'i kaybeder → systemd birimiyle çağır (S85 drill + S96 deploy doğruladı):
#       sudo systemctl start pg-backup.service && systemctl show pg-backup.service -p Result   # Result=success
#     (yeni .age dump lokal + off-site görünmeli; restore prosedürü backup-strategy.md §7).
#  2) CANLI-VERİ İNDEX migration'ları restoran KAPALIYKEN (off-hours) koşulur — ADR-031 K12 Amendment
#     2026-07-13: düz CREATE INDEX kısa AccessExclusiveLock alır; db-migration-guard MANUEL gate her index
#     PR'ında hedef tablo satır-sayısı + off-hours penceresini kayda geçirir (047 deploy'unda kaydedildi:
#     orders=24, order_items=67 — 500K eşiğinin çok altında, lock saniye-altı).
source /root/pos-secrets.env
DATABASE_URL="postgresql://migrator:${PG_MIGRATOR_PASSWORD}@127.0.0.1:5432/pos_prod" \
  ./packages/db/node_modules/.bin/node-pg-migrate -m packages/db/migrations up

# Yalnız web değiştiyse:
pnpm --filter @restoran-pos/web build

pm2 restart pos-api --time
```

**Doğrulama (her deploy sonrası):**
```bash
curl -s https://restoranpos.org/api/health          # {"status":"ok",...}
curl -s -o /dev/null -w "%{http_code}\n" https://restoranpos.org/   # 200
curl -s "https://restoranpos.org/socket.io/?EIO=4&transport=polling" | head -c 40  # 0{"sid":...
pm2 ls                                              # pos-api online, restart sayısı beklenen
```

⚠️ **`/api/health` TEK BAŞINA yetmez — değişiklik neye dokunduysa smoke onu sınamalı.** `health` route zincirinin tamamından geçmez; ona bakıp "deploy iyi" demek, middleware/mount katmanına dokunan bir değişiklikte kördür (S148 `#774` deneyimi). Zinciri kanıtlayan ucuz smoke: **token'sız gerçek route'lara** istek at, **401** gelmeli — 500 gelirse zincir kırık:

```bash
for r in orders tables printers audit-logs products/x/attribute-groups; do
  printf "  /%-30s " "$r"; curl -s -o /dev/null -w "%{http_code}\n" "https://restoranpos.org/api/$r"
done
# Beklenen: hepsi 401 (/kds kök GET'i olmadığı için 404). HİÇBİRİ 500 OLMAMALI.
# `/products/x/attribute-groups` bilerek listede: parametreli mount'un vakası.
```

Agent-JWT yolu (`/print/v1`) kullanıcı-JWT'den ayrı auth zinciridir; onu **`last_seen_at` tazeliğiyle** doğrula — kolon yalnız BAŞARILI kimlik doğrulamasında yazılır, yani tazeyse zincir çalışıyor:

```bash
sudo -u postgres psql -d pos_prod -At -c \
  "SELECT device_fingerprint, round(extract(epoch from (now()-last_seen_at))) AS sn_once
     FROM agents WHERE revoked_at IS NULL ORDER BY last_seen_at DESC;"
# Üç ajan (grill / kasa / win32) saniyeler içinde görünmeli.
```

ℹ️ **Restart anında nginx'te 502 görmek NORMALDİR, olay değil.** `pos-api` yeniden başlarken uzun-poll yapan yazıcı ajanları (`/print/v1/jobs/next?wait=25`) ve socket.io istemcileri bağlantıyı kaybeder. Ölçüm (2026-11-05 deploy'u): restart saniyesinde **7× 502**, hemen ardından `jobs/next` üzerinde **27× 204** — ajanlar kendiliğinden toparladı, müdahale gerekmedi. Kontrol ölçütü 502'nin **varlığı değil**, restart saniyesiyle **sınırlı kalması**; sonraki dakikalarda da sürüyorsa gerçek sorun vardır.

**Resmî hedef (ADR-050 K1, ürün sahibi kabulü S2):** güncelleme kesintisi **≤ 10 sn**, yalnız **bakım penceresinde (03:00–06:00 TR, S1)**, **onaylanmış sipariş/ödeme kaybı ve çift kayıt 0**. Sıfır kesinti hedef değildir (ikinci süreç gerektirir — `OPS-1`/`MIM-3`). Yarıda kalan isteğin bozulmaması düzgün kapanışla sağlanır (§11.9); `kill_timeout 8000` tanımlanana dek PM2 drenajı 1,6 sn'de keser.

Migration'lı deploy notları: forward-only (ADR-003 — down yok); `pgmigrations`'tan DELETE migrator'a kapalı; **enum migration'larında incremental senaryo lokalde test edilmiş olmalı** (fresh CI yeşili yanıltıcı — bkz. Migration 042 dersi); **canlı-veri index migration'ları off-hours (restoran kapalı) + db-migration-guard MANUEL onayıyla koşulur — ADR-031 K12 Amendment 2026-07-13**. (K12'nin CI-regex CONCURRENTLY gate'i, node-pg-migrate `.sql`'de CONCURRENTLY imkânsız olduğundan — singleTransaction default — TS-migration altyapısı inene dek ERTELENDİ; düz `CREATE INDEX IF NOT EXISTS` + saniye-altı lock geçerli mekanizmadır. Emsal: Migration 041/042/047.)

## 5. Yeni sunucu — felakette yedekten geri dönüş (güncel reçete) + ilk kurulum kaydı

### 5.0 Felakette yeni sunucuya geri dönüş (ADR-051 K2 — 2026-11-26)

> **Ne zaman:** sunucu kalıcı olarak kayboldu ya da kullanılamaz (disk/kutu arızası, silinme). Sunucu ayakta ama veri bozuksa bu değil → `backup-strategy.md` §7. Hesap/IP askısı (5 Kas tipi) bu değil → önce ödemeyi çöz.
> **Hedef (ADR-051 S1/S2):** ≤ **2 saat** içinde restoran tekrar sipariş alır · kayıp en fazla son saatlik yedekten sonraki siparişler. O sürede kâğıtla çalışılır (ADR-031 K10).
> ⚠️ Bu reçete **henüz uçtan uca koşulmadı** (ADR-051 PR-1 tatbikatı ölçer). Adım süreleri tatbikattan sonra aşağıdaki tabloya yazılır.

**0) Malzemeler — elinde olmadan başlama** (hiçbiri eski sunucuda değil):

| Malzeme | Nerede | Not |
|---|---|---|
| Hetzner + Namecheap hesap erişimi (2FA) | ürün sahibi | sunucu açma, DNS değiştirme |
| `age` **özel** anahtarı | kasa + çevrimdışı kopya (`backup-strategy.md` §5) | yoksa yedekler **açılamaz** |
| Storage Box erişimi | Hetzner paneli (Storage Box) | 🔴 eski sunucunun iki anahtarı (`/var/lib/postgresql/.ssh/storagebox` yedek işi + `/root/.ssh/storagebox`) onunla gitti → yeni sunucuda yeni anahtar(lar) üretip **panelden** Storage Box'a ekle (`backup-strategy.md` §5.2) |
| Kod | GitHub + dizüstündeki depo | yeni sunucuya dizüstünden `git push` |
| SSH anahtarı | dizüstü `~/.ssh/restoran_pos_ed25519` | |
| Sentry DSN'leri, healthchecks.io ping URL'i | ilgili panoların ayarları | §3.2 · yoksa sonra eklenir (no-op) |
| Dükkân PC'sine uzaktan erişim (RustDesk) | | yalnız Caller ID (`BRIDGE_TOKEN`) için |

**1) Sunucu + taban** — Hetzner Console → proje `restoran-pos` → **CX23**, Ubuntu 24.04, Almanya, SSH anahtarıyla. Sonra sunucuda:

```bash
apt update && apt -y upgrade && reboot          # çekirdek; tekrar bağlan
apt -y install ufw curl git fail2ban unattended-upgrades age rclone jq
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
timedatectl set-timezone Etc/UTC                # prod UTC'dir (log/zamanlayıcılar buna göre)
# gece paket güncellemesi penceresi 04:00-04:30 TR (§9.2) — servis saatinde Postgres'i yeniden başlatmasın
mkdir -p /etc/systemd/system/apt-daily-upgrade.timer.d && cat > /etc/systemd/system/apt-daily-upgrade.timer.d/override.conf <<'EOF'
[Timer]
OnCalendar=
OnCalendar=*-*-* 1:00
RandomizedDelaySec=30m
EOF
systemctl daemon-reload
```

**2) Yığın (stack)** — sürümler prod ile aynı (2026-11-26 okundu: Node 22.23, PostgreSQL 17.10, nginx 1.24, PM2 7.0, certbot 2.9):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt -y install nodejs && corepack enable
apt -y install postgresql-common && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y && apt -y install postgresql-17
apt -y install nginx certbot python3-certbot-nginx
npm i -g pm2 && pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M && pm2 set pm2-logrotate:retain 90 && pm2 set pm2-logrotate:compress true && pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
```
PostgreSQL varsayılanları yeterli (prod'da elle değiştirilmiş ayar yok; `pg_hba` paket varsayılanı: yerel `peer`, 127.0.0.1 `scram-sha-256`).

**3) Yedeği çek + roller + veritabanı** — ayrıntı ve doğrulama sorgusu `backup-strategy.md` §7 "Roller" notu:

```bash
# Storage Box anahtarı (0. adımdaki tabloya bak) → rclone remote 'storagebox' (backup-strategy.md §4.1)
rclone lsf storagebox:restoran-pos-backups --include 'pos_prod-*' | sort | tail -4   # en yeni ÇİFT: .dump.age + .globals.sql.age, aynı zaman damgası
rclone copy storagebox:restoran-pos-backups/pos_prod-<TS>.dump.age /root/restore/
rclone copy storagebox:restoran-pos-backups/pos_prod-<TS>.globals.sql.age /root/restore/
# age özel anahtarı dosya olarak taşınır (RustDesk/scp), yapıştırılmaz; iş bitince shred
age -d -i /root/age-key.txt /root/restore/pos_prod-<TS>.globals.sql.age | sudo -u postgres psql -v ON_ERROR_STOP=0 -q
#   → backup-strategy.md §7'deki rol doğrulama sorgusu; eşleşmiyorsa DUR
sudo -u postgres createdb -O postgres pos_prod
age -d -i /root/age-key.txt /root/restore/pos_prod-<TS>.dump.age > /root/restore/pos_prod.dump
sudo -u postgres pg_restore --dbname=pos_prod /root/restore/pos_prod.dump        # --no-owner YOK
sudo -u postgres psql -d pos_prod -At -c "SELECT max(name) FROM pgmigrations; SELECT max(created_at) FROM orders;"
#   son migration = kodun beklediği · son sipariş = yedek saati (kayıp aralık bu; ürün sahibine söylenir)
```
⚠️ 26 Kasım 2026'dan **eski** bir yedekten dönülüyorsa `.globals.sql.age` yoktur → rolleri elle kur: §6 (sahiplik + default ACL), §6.1 (`migrator BYPASSRLS`), §6.1.1 (`cron_purger LOGIN … CONNECTION LIMIT 4`); `app_tenant` `LOGIN NOBYPASSRLS`.

**4) Sırlar — hepsi YENİ üretilir** (eski `api.env`/`pos-secrets.env` sunucuyla gitti; §12 kuralları: sunucuda üret, ekrana basma):

```bash
umask 077; mkdir -p /etc/restoran-pos
APP=$(openssl rand -hex 24); CRON=$(openssl rand -hex 24); MIG=$(openssl rand -hex 24)
printf "ALTER ROLE app_tenant PASSWORD '%s';\nALTER ROLE cron_purger PASSWORD '%s';\nALTER ROLE migrator PASSWORD '%s';\n" "$APP" "$CRON" "$MIG" \
  | sudo -u postgres psql -d pos_prod -v ON_ERROR_STOP=1 -q
TENANT=$(sudo -u postgres psql -d pos_prod -At -c "SELECT id FROM tenants WHERE slug='dilan-pide'")
JA=$(openssl rand -hex 48); JG=$(openssl rand -hex 48); BT=$(openssl rand -hex 32)
cat > /etc/restoran-pos/api.env <<EOF
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://app_tenant:${APP}@127.0.0.1:5432/pos_prod
JWT_ACCESS_SECRET=${JA}
JWT_AGENT_SECRET=${JG}
BRIDGE_TOKEN=${BT}
WEB_ORIGIN=https://restoranpos.org
TENANT_ID=${TENANT}
SENTRY_DSN=
CRON_DATABASE_URL=postgresql://cron_purger:${CRON}@127.0.0.1:5432/pos_prod
PRINT_AGENT_EXPECTED_VERSION=0.0.5
EOF
cat > /root/pos-secrets.env <<EOF
JWT_ACCESS_SECRET=${JA}
JWT_AGENT_SECRET=${JG}
BRIDGE_TOKEN=${BT}
PG_MIGRATOR_PASSWORD=${MIG}
PG_APP_PASSWORD=${APP}
PG_CRON_PURGER_PASSWORD=${CRON}
EOF
unset APP CRON MIG JA JG BT
```
`SENTRY_DSN` boş kalabilir (kod no-op). `PRINT_AGENT_API_KEY` (eski `pk_`) **yeniden yazılmaz** — ajanlar `pk2_` kullanıyor ve onun hash'i DB'de, yedekle geldi. Sonuç: yazıcı ajanları **aynı anahtarla** yeni sunucuya kendiliğinden yeniden kaydolur (§12.9 tatbikatı), garson/kasa oturumları DB'deki yenileme jetonlarıyla **açık kalır**.

**5) Kod + yayın düzeni** — dizüstünde (yeni IP ile):

```bash
git remote set-url prod ssh://root@<YENİ_IP>/opt/git/restoran-pos.git
# sunucuda önce: git init --bare /opt/git/restoran-pos.git
GIT_SSH_COMMAND="ssh -i ~/.ssh/restoran_pos_ed25519" git push prod main
```
Sunucuda — §11.6 cutover'ının 1., 2., 5. adımlarının yeni sunucu hâli:
```bash
mkdir -p /srv/restoran-pos/{releases,shared/web-assets,bin}
git --git-dir=/opt/git/restoran-pos.git show main:apps/api/scripts/deploy/pos-release.sh > /srv/restoran-pos/bin/pos-release && chmod 755 /srv/restoran-pos/bin/pos-release
git --git-dir=/opt/git/restoran-pos.git show main:apps/api/scripts/deploy/run-api.sh   > /srv/restoran-pos/bin/run-api.sh   && chmod 700 /srv/restoran-pos/bin/run-api.sh
ln -s /srv/restoran-pos/bin/pos-release /usr/local/bin/pos-release
( umask 077; echo "VITE_SENTRY_DSN=" > /srv/restoran-pos/shared/web.env.production )   # DSN varsa yaz
pos-release build main                                       # çıktıdaki sürüm adı = <id>
ln -s releases/<id> /srv/restoran-pos/current && echo "$(date -u +%FT%TZ) <id>" >> /srv/restoran-pos/shared/history
cp -a -n /srv/restoran-pos/current/apps/web/dist/assets/. /srv/restoran-pos/shared/web-assets/
pm2 start /srv/restoran-pos/bin/run-api.sh --name pos-api --time --kill-timeout 8000 && pm2 save && pm2 startup systemd
pos-release status                                           # DB head = RELEASE.json migration_head
```
⚠️ `main`'in son migration'ı yedeğin head'inden **ilerideyse** (yedek eski) bekleyen migration'ları `pos-release deploy main` uygular — o durumda `build`+elle `current` yerine doğrudan `deploy` kullanılır (yedek önce alınır).

**6) Nginx** — `/etc/nginx/sites-available/restoranpos`: §11.4 blokları + §1 rotaları (`/api/` → `127.0.0.1:3001/` strip · `/socket.io/` upgrade başlıkları + `proxy_read_timeout 300s` · `location / { try_files $uri $uri/ /index.html; }`), yalnız `listen 80` ile → `ln -s` sites-enabled → `nginx -t && systemctl reload nginx`. SSL'i certbot 8. adımda ekler.

**7) Zamanlanmış işler + yedek** — §11.6'nın 6. adımı yeni sunucuda:
- `pg-backup.service` + `pg-backup.timer` (saatlik, `User=postgres`, `EnvironmentFile=/etc/restoran-pos/backup.env`, `ExecStart=/srv/restoran-pos/current/apps/api/scripts/backup/pg-backup.sh`) — birim metni `backup-strategy.md` §3. `backup.env`: `PGDATABASE=pos_prod` · `PGUSER=postgres` · `AGE_RECIPIENT=age1…` (public) · `RCLONE_REMOTE=storagebox:restoran-pos-backups` · `RETENTION_DAILY_DAYS=3` · `HEALTHCHECK_URL=` · `mkdir -p /var/backups/postgres && chown postgres: /var/backups/postgres && chmod 750 /var/backups/postgres` · 🔴 yedek işi **postgres kullanıcısının kendi** rclone'unu kullanır: `/var/lib/postgresql/.config/rclone/rclone.conf` (600) + `key_file = /var/lib/postgresql/.ssh/storagebox` (700 dizin, 600 dosya, sahibi postgres) — 3. adımda root için kurduğun yapılandırma yedek işine **yetmez**; kontrol `sudo -u postgres rclone lsd storagebox:`.
- `auth-429-watch.service` + `.timer` (§10.1; günlük 06:00 UTC, `EnvironmentFile=/etc/restoran-pos/auth-429-watch.env` = `RESTAURANT_IPS=`).
- `systemctl daemon-reload && systemctl enable --now pg-backup.timer auth-429-watch.timer && systemctl start pg-backup.service` → `Result=success` + yeni sunucudan Storage Box'a ilk `.dump.age` + `.globals.sql.age` çifti.

**8) DNS + SSL** — Namecheap → A `@` ve A `www` → **yeni IP** (TTL bugün 1799 sn ≈ 30 dk; istemcilerin geçişi bu kadar sürebilir) → `dig +short restoranpos.org @1.1.1.1` yeni IP'yi gösterince:
```bash
certbot --nginx -d restoranpos.org -d www.restoranpos.org --redirect   # LE e-posta/sözleşme onayı ürün sahibinden
systemctl list-timers | grep certbot
```

**9) Doğrulama** — §4 doğrulaması (health · `/` · socket.io · token'sız 5 uç **401**) + §6.1'in üç `curl`'ü (no-cache · immutable · 404) + `pos-release status` + ajanlar `last_seen_at` taze (aynı `agents` satırları) + kasada bir giriş + **kâğıtta** bir mutfak ve bir kasa fişi.

**10) Caller ID** — `BRIDGE_TOKEN` yeni → §12.5 ile dükkân PC'sinde güncellenir (o ana dek arayan numara açılır penceresi çalışmaz; sipariş alınabilir).

**11) Kapanış** — `shred -u /root/age-key.txt /root/restore/*` · eski sunucu (erişilebiliyorsa) **hemen silinmez**: kapatılır, 7 gün sonra silinir · ADR-051 durumuna ve `backup-strategy.md` §8'e süre + kayıp aralığı yazılır · `deploy.md` §2 envanterindeki IP güncellenir.

**Tatbikat süreleri** (ADR-051 PR-1 — geçici sunucu, DNS çevrilmeden, `/etc/hosts` ile):

| Adım | Süre | Not |
|---|---|---|
| 1–2 sunucu + yığın | — | |
| 3 yedek + roller + DB | — | |
| 4–5 sırlar + kod + yayın | — | |
| 6–7 nginx + zamanlayıcılar | — | |
| 8 DNS + SSL | — (TTL hariç) | |
| 9 doğrulama | — | |
| **Toplam (hedef ≤ 2 sa)** | — | |

ℹ️ Aynı sunucuda yaşayan ama POS'un parçası olmayan şeyler bu reçeteye **girmez**: `bize-dair` sitesi (`/etc/nginx/sites-available/bize-dair` + `bize-dair.service`, ayrı proje). Gerekirse kendi reçetesiyle kurulur.

### 5.0.1 İlk kurulum kaydı (tarihsel — S81, 2026-07-04, `/opt` düzeni; felakette KULLANMA → §5.0)

Sırasıyla (Session 81'de uygulandı):

1. **Sunucu:** Hetzner Console → proje `restoran-pos` → CX23, Ubuntu 24.04, Almanya, SSH key ile. DNS: Namecheap Advanced DNS → A `@` + A `www` → sunucu IP (parking CNAME/redirect silinir).
2. **Taban:** `apt update && apt upgrade` → reboot (kernel) → `apt install ufw curl git fail2ban unattended-upgrades` → `ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable`.
3. **Stack:** NodeSource `setup_22.x` + `apt install nodejs` → `corepack enable` · `apt install postgresql-common` + PGDG script + `apt install postgresql-17` · `apt install nginx certbot python3-certbot-nginx` · `npm i -g pm2`. *(Taze kurulumda ilk pnpm çağrısı corepack indirme onayı sorabilir — script içinde `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` ile bastır.)*
4. **Kod:** `/opt/git/restoran-pos.git` bare init → lokalden push → `/opt/restoran-pos`'a clone → §4'teki install + shared-types build + web build.
5. **DB:** `createdb pos_prod` → migration'ları **fresh-install istisnası** olarak `postgres` superuser ile koş (bkz. §6) → `ALTER ROLE app_tenant LOGIN PASSWORD ...` + `ALTER ROLE migrator PASSWORD ...` → §6 REVOKE'ları uygula.
6. **Nginx + SSL:** site config (bkz. §1 route'ları; `/socket.io` bloğunda `Upgrade`/`Connection "upgrade"` başlıkları; **önbellek blokları ZORUNLU — bkz. §6.1**) → `nginx -t && systemctl reload nginx` → `certbot --nginx -d restoranpos.org -d www.restoranpos.org --redirect` (LE sözleşme onayı kullanıcıdan alındı).
7. **Servis:** `/opt/restoran-pos/run-api.sh` (env source + tsx) → `pm2 start ... --name pos-api` → `pm2 startup systemd && pm2 save`.
8. **Bootstrap (P5-2):** prod tenant/admin/agents bootstrap script'i koşulur → `TENANT_ID` env'e eklenir → `pm2 restart pos-api` → login smoke.

### 5.1 Refresh cookie `Path` geçişi — TEK SEFERLİK (S137, ADR-002 Amd6)

> Yalnız bu dalga için. **Migration YOK**, sıra serbest, normal §4 prosedürü geçerli.
> Ama bu deploy **canlı oturumlara dokunuyor** → yoğun saat dışı tercih edilir.

- **Ne değişti:** refresh cookie `Path`'i `/api/auth/refresh` → **`/api/auth`**.
  Daraltma `/api/auth/logout`'a cookie gitmesini engelliyordu → çıkış token'ı **hiç
  revoke etmiyordu** (prod'da 4483 satırda `revoked_reason='logout'` sayısı **0**'dı;
  `POST /logout` 3 ms, yani DB'ye hiç gitmiyordu). Çıkıştan sonra token 30 gün geçerliydi.
- 🔴 **GEÇİŞ EMNİYETİ KODDA — SÖKMEYİN.** `setRefreshCookie`/`clearRefreshCookie` artık
  her yanıtta eski path için `Max-Age=0` **ikinci** bir `Set-Cookie` yazar. Olmazsa
  deploy anında tarayıcıda aynı isimli iki cookie oluşur, RFC 6265 §5.4 **uzun path'i
  öne koyar**, `cookie@0.7.2` **ilk geleni alır** → sunucu ESKİ (rotated) token'ı görür
  → `reuse_detected` → `revokeFamilyAll` → **canlı oturumlar düşer**. Ayrıntı
  `apps/api/src/auth/cookie.ts` docblock'u + ADR-002 §12.4.
  **Kaldırma en erken 2026-11-15** (refresh TTL 30 gün).
- **Telde beklenen (deploy sonrası `curl -D -` ile login):** İKİ `Set-Cookie` satırı —
  `Path=/api/auth; Max-Age=2592000` **ve** `Path=/api/auth/refresh; Max-Age=0`.
  İkincisi yoksa geçiş emniyeti devrede değil → deploy'u durdur.
- 🕐 **YOĞUN SAAT DIŞI ŞART — kilit için DEĞİL, geçiş artığı için.** Deploy anında
  tarayıcıda cookie hâlâ eski path'te. O tarayıcının **ilk** isteği `/logout` olursa
  cookie gitmez → revoke edilmez → `clearRefreshCookie` iki path'i de siler → token
  **kullanıcı tarafından artık iptal edilemez**, doğal süresine (30 gün) kadar yaşar.
  Self-heal yalnız önce bir login/refresh olursa çalışır.
  **Kapalıyken deploy bu pencereyi pratikte boşaltır:** açık sekme kalmaz, her istemci
  bir sonraki etkileşimine sayfa yüklemesiyle başlar, SPA in-memory access token'ını
  kaybettiği için **önce `/auth/refresh` çağırır** → cookie göçü çıkış düğmesine
  basılabilmesinden ÖNCE tamamlanır. Kalan tek vaka: deploy'dan önce açık kalmış bir
  sekmenin, bir sonraki refresh'inden önce çıkış yapması (access TTL 30 dk).
- ❌ **TOPLU TOKEN İPTALİ YAPILMAZ** (güvenlik denetimi C-1 önerdi, **gerekçeli
  reddedildi**). `UPDATE refresh_tokens SET revoked_at=now() ... WHERE revoked_at IS NULL`
  yukarıdaki artığı kapatırdı, ama **tedavi hastalıktan kötü**: iptal edilen token'ı
  sunan her istemci `rotateRefreshToken`'da reuse-detection'a düşer →
  **oturum başına bir `reuse_detected` + `revokeFamilyAll`** → aşağıdaki rollback
  ölçütünü (`reuse_detected` artmamalı) kullanılamaz hâle getirir ve güvenlik sinyalini
  gürültüye boğar. Kapalıyken deploy aynı korumayı bedelsiz sağlıyor.
- 🔎 **DEPLOY SONRASI İZLENECEK METRİK — `reuse_detected` SAYISI.** Deploy öncesi
  prod'da **10**'du. Artıyorsa geçiş emniyeti çalışmıyor demektir → derhal rollback
  (önceki commit + `pm2 restart pos-api`).
  ```sql
  SELECT revoked_reason, count(*) FROM refresh_tokens GROUP BY 1 ORDER BY 2 DESC;
  ```
- ✅ **KABUL KANITI — "ekranda sorun yok" KANIT DEĞİLDİR** (bu bug tam öyle kaçtı:
  kullanıcı çıkış+giriş yaptı, ekran sorunsuzdu, token sunucuda canlıydı). Gerçek bir
  çıkış yapıldıktan sonra DB'de **`revoked_reason='logout'` satırı** görünmelidir:
  ```sql
  SELECT count(*) FROM refresh_tokens WHERE revoked_reason = 'logout';  -- > 0 olmalı
  ```
- **Mobil ayrı kanal:** garson uygulamasının çıkışı da sunucuyu çağırmaya başladı
  (`logoutAndRevoke`, best-effort). **EAS OTA gerekir**; her yayında `channel:view` ile
  kanal→branch eşlemesini teyit et. Mobil inmeden API değişikliği zararsızdır
  (gövde kanalı açık, kimse kullanmıyor). Çevrimdışı çıkışta sunucudaki token 30 gün
  yaşar — bilinçli kabul (ADR-002 §12.6).

### 6.1 Nginx önbellek blokları — ATLANMAZ (S133, 2026-09-28 canlı olay)

> ✏️ **2026-11-24 (ADR-047):** canlıdaki hâli §11.4 — `root` artık `current`'ı, `/assets/` `alias` ile paylaşılan havuzu gösterir (`try_files` yerine `alias`; eksik parça yine **404**). Aşağıdaki gerekçe ve üç `curl` doğrulaması aynen geçerli.

Bu iki blok `location / { try_files ... }` bloğundan **ÖNCE** gelmelidir. Sunucu sıfırdan
kurulursa buradan yeniden uygulanır — aksi halde aşağıdaki arıza geri gelir.

```nginx
    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location = /index.html {
        add_header Cache-Control "no-cache" always;
    }
```

**Yaşanan arıza:** işletme bilgisayarında uygulama **beyaz ekran**, şahsi bilgisayarda
sorunsuz. Zincir: (1) `index.html` hiçbir `Cache-Control` taşımıyordu → tarayıcı sezgisel
önbellekle **eski HTML**'i tutuyordu; (2) yeni web build'i asset adlarını değiştirmişti;
(3) eski HTML artık var olmayan asset'leri istiyordu; (4) `location /` SPA fallback'i
`/assets/*`'ı da yakalayıp **`200` + `Content-Type: text/html`** döndürüyordu; (5) tarayıcı
HTML'i JS diye çalıştırıp `Unexpected token '<'` ile ölüyordu → beyaz ekran, hata mesajı yok.

**Neden `=404` kritik:** eksik asset'te HTML dönmesi hatayı **sessiz** yapıyordu. 404 dönerse
tarayıcı net hata verir, teşhis saniyeler sürer.

**Geçici kurtarma (son kullanıcı):** sert yenileme `Ctrl+Shift+R`.

**Doğrulama (değişiklikten sonra ZORUNLU):**
```bash
curl -sSI https://restoranpos.org/login            | grep -i cache-control   # no-cache
curl -sSI https://restoranpos.org/assets/<gercek>.js | grep -i cache-control # immutable
curl -sS -o /dev/null -w "%{http_code}\n" https://restoranpos.org/assets/yok.js  # 404
```

## 6. Migrator güvenlik kontratları (ADR-001 §7.1 — checklist buraya taşındı)

Fresh install'da migration'lar `postgres` superuser ile koşuldu (bootstrap istisnası — migrator henüz parolasızdı); ardından kontrat elle uygulandı. **Sonraki tüm migration'lar `migrator` ile koşar.**

**Sahiplik ön-koşulu (2026-07-10, Migration 044 deploy'unda keşfedildi ve uygulandı):** fresh install tabloları `postgres`-owned bırakır; PostgreSQL'de `ALTER TABLE` tablo SAHİPLİĞİ ister → migrator ilk `ALTER` migration'ında `aclcheck_error` ile düşer. Çözüm: public şemadaki tablo+sequence sahipliği migrator'a devredilir, ardından REVOKE kontratı YENİDEN uygulanır (sahiplik devri DELETE/TRUNCATE'i implicit geri getirir):

```sql
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tableowner='postgres' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO migrator', r.tablename);
  END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname='public' LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO migrator', r.sequencename);
  END LOOP;
END $$;
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM migrator;
```

(Prod'da 2026-07-10'da koşuldu: 27 tablo + sequence'lar devredildi. Yeni migration bir FONKSİYON `ALTER`/`DROP` ederse aynı reçete `ALTER FUNCTION ... OWNER TO migrator` ile uygulanır. Yeni TABLO yaratan migration'larda `app_tenant` GRANT'larının migration SQL'inde olduğundan emin ol — mevcut tabloların grant'ları sahiplik devrinden etkilenmez.)

**Yeni-tablo grant dersi (2026-07-13, Migration 045/046 deploy'unda yakalandı):** prod'daki tek default-ACL `FOR ROLE postgres` — migrator'ın yarattığı yeni tabloya UYGULANMAZ; Migration 045 (`order_item_batches`) grant'sız kalmıştı → deploy ön-kontrolünde yakalandı, Migration 046 (repo-takipli GRANT) ile kapatıldı. **Sistemik önlem — migrator için de default-ACL (prod'da 2026-07-13'te koşuldu; fresh-install'da §5.5'e dahil et):**

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO app_admin;
```

(Bu ağ gelecekteki migrator-yaratımı tabloları otomatik kapsar; yine de her yeni-tablo migration'ına explicit GRANT yazmak konvansiyon kalır — repo-takipli, fresh-install-portatif.)

### 6.1 RLS bootstrap — `migrator BYPASSRLS` (ADR-041 RLS serisi ön-koşulu: 054 F2 + 055 F3a + sonraki tablolar, SUPERUSER)

**İlk RLS migration'ı (054: pilot `tables`+`areas`) uygulanmadan ÖNCE, `postgres` superuser ile BİR KEZ koşulur:**

```sql
ALTER ROLE migrator BYPASSRLS;
```

**Neden migration'da değil:** `BYPASSRLS` attribute'unu yalnız superuser atayabilir; prod migration'ları `migrator` (non-superuser) ile koşar (§6) → migration içinde `must be superuser to change bypassrls attribute` ile patlar. Bu yüzden `app_tenant`/`cron_purger` rol kurulumu gibi manuel superuser bootstrap adımıdır (bir kez; idempotent). **KALICI** — geri alınmaz: F3+'da başka tablolar RLS'e girince FORCE RLS altında tablo-sahibi `migrator`'ın DDL/DML'i policy'e takılmasın diye gereklidir. `app_tenant` (runtime API rolü) NOBYPASSRLS KALIR — izolasyonun gerçek uygulayıcısı odur; asla BYPASSRLS verilmez.

### 6.1.1 `cron_purger` aktifleştirme — retention cron'unun BYPASSRLS bağlantısı (ADR-041 Amd5 K7, SUPERUSER, BİR KEZ)

**`063_rls_audit_logs.sql` uygulanmadan ÖNCE ve yeni kod deploy edilmeden ÖNCE** (sıra kritik, aşağıda):

```sql
ALTER ROLE cron_purger LOGIN PASSWORD '<vault>' CONNECTION LIMIT 4;
```
⚠️ **Limit 4, pool `max` 2** (güvenlik denetimi CONCERN-3): her purge task'ı advisory lock için
ayrı bir client tutar + sorgu için bir tane = tam 2/2, yani limit 2'de **sıfır headroom** kalır.
`pm2 reload` çakışması veya başarısız restart'tan artakalan idle client →
`too many connections for role cron_purger` → M5 `catch`'ine düşerse **API hiç açılmaz**.
Ayrıca: bu servis için `pm2 restart` kullanılır, **`reload` değil** (reload iki instance'ı
bir an üst üste bindirir).

**Bu adımdan HEMEN SONRA, kod deploy'undan ÖNCE doğrula** (migration-guard CONCERN-1 —
`cron_purger` bugüne dek NOLOGIN'di, yani CONNECT/USAGE yetkileri hiç sınanmadı):
```sql
SELECT has_database_privilege('cron_purger',current_database(),'CONNECT') c,
       has_schema_privilege('cron_purger','public','USAGE') u;
```
İkisi de `t` olmalı. (2026-09-29 prod ölçümü: `CONNECT:true USAGE:true` ✔ — `public` şemasının
PUBLIC'e default USAGE'ı sayesinde. Şema sertleştirmesi yapılmış bir kurulumda `f` gelirse
`GRANT USAGE ON SCHEMA public TO cron_purger` gerekir, aksi halde cron ilk gece 42501 ile
**sessizce** ölür.) Tablo GRANT'leri (`audit_logs` INSERT + `tenants` SELECT) migration 063 ile gelir.
Ardından API env'ine eklenir (`§Env`):
```
CRON_DATABASE_URL=postgresql://cron_purger:<vault>@127.0.0.1:5432/pos_prod
```

**Neden gerekli:** `audit_logs` force-RLS'e girdiğinde retention cron'unun üç işi `tenant_id IS NULL`
üzerinde çalışır (sistem-actor `audit.purge` self-audit INSERT'i + NULL-tenant DELETE pass'i).
Bunlar `withTenant` ile **çözülemez** (helper geçersiz UUID'de transaction'ı hiç açmaz) ve
`app_tenant` (NOBYPASSRLS) ile denenirse policy reddeder; task'lar `try/catch`'li olduğu için
hata **yutulur** → retention **sessizce ölür** (KVKK). Rol `000_init.sql:23`'te
`BYPASSRLS NOLOGIN` olarak zaten var; eksik olan yalnız LOGIN + parola.

**⚠️ DEPLOY SIRASI — F4 reçetesinden SAPMA (normalde "kod önce, RLS sonra"):**
1. bu SQL (superuser) → 2. `CRON_DATABASE_URL` env'e → 3. kod deploy + `pm2 restart`
(**M5 assertion geçmeli**) → 4. migration 063 → 5. doğrulama.
Gerekçe: yeni kod prod'da `CRON_DATABASE_URL` **yoksa açılmaz** (fail-fast, Amd5 K2) →
rol + env adımı koddan ÖNCE olmak zorundadır.

**⚠️ M5 boot-assertion (Amd5 K3 — M4'ün simetriği):** API prod'da cron bağlantısının
`rolbypassrls OR rolsuper` olduğunu doğrular; değilse `process.exit(1)`. M4 "app pool bypass
ETMEMELİ" der, M5 "cron pool bypass ETMELİ" der. Restart sonrası log'da **iki satır** beklenir:
`M4 OK: DB rolü NOBYPASSRLS` **ve** `M5 OK: cron bağlantısı BYPASSRLS`.

**Parola bir sırdır** — bu dosyaya, ADR'ye veya log'a YAZILMAZ; `migrator` parolası gibi
vault'ta/`/root/pos-secrets.env`'de durur. `CONNECTION LIMIT 2` bilinçli: cron tek işçi.
GRANT'ler migration 063 ile gelir (`audit_logs` INSERT + `tenants` SELECT); rol yalnız
`audit_logs`/`call_logs`/`print_jobs` üzerinde SELECT/DELETE + `audit_logs` INSERT +
`tenants` SELECT yetkisine sahiptir — dar yüzey bilinçlidir.

**Runtime rol teyidi (RLS'in gerçekten ısırdığının kanıtı):** API'nin `DATABASE_URL`'i `app_tenant` (NOBYPASSRLS) ile bağlanmalı — superuser/migrator ile bağlanırsa RLS sessizce etkisizleşir. Deploy sonrası doğrula:

```sql
-- app_tenant bağlantısıyla; false dönmeli:
SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user;
```

**⚠️ M4 boot-assertion (ADR-041 / #645 — prod'a İLK bu RLS batch'iyle iniyor):** API `index.ts` prod'da (`NODE_ENV=production`) açılışta bağlı DB rolünün **NOBYPASSRLS + non-superuser** olduğunu doğrular; değilse `process.exit(1)` (PM2 crash-loop). Gerekçe: app superuser/BYPASSRLS ile bağlanırsa FORCE RLS sessizce etkisizleşir → gürültülü fail bilinçli tercih. **Batch deploy sırası kritik:** önce `ALTER ROLE migrator BYPASSRLS` uygula + `pos-api`'nin `DATABASE_URL`'inin `app_tenant` (NOBYPASSRLS, §Env) ile bağlandığını teyit et, SONRA `pm2 restart pos-api`. `DATABASE_URL` yanlışlıkla `migrator`/`postgres`'e ayarlıysa M4 API'yi açılışta kapatır — RLS deploy'undan önce düzelt.

**F3a (Migration 055, `orders` RLS) EK superuser adımı GEREKTİRMEZ:** yukarıdaki bir-kez `BYPASSRLS` adımı KALICI olduğundan tüm RLS serisini (054, 055 ve sonraki tablolar) kapsar; 055 DDL'i (ENABLE/FORCE/POLICY) tablo-sahibi `migrator` ile koşar (sahiplik yeter, superuser gerekmez).

**⚠️ CASCADE İSTİSNASI (2026-07-23, S104 — canlı `42501` bug'ının kök nedeni):** yukarıdaki toplu REVOKE **fazla geniştir**. PostgreSQL, `ON DELETE CASCADE`/`SET NULL` referans eylemlerini **REFERANS EDEN tablonun SAHİBİNİN** yetkisiyle çalıştırır — çağıran rolün yetkisiyle değil. Sahip `migrator` ve DELETE ondan alınmış olduğu için **cascade zinciri 42501 ile patlıyordu**, `app_tenant`'ın DELETE yetkisi olmasına rağmen.

Canlı belirti: **`DELETE /api/users/:id` → 500** (personel silinemiyordu; 21 Tem ×4 + 22 Tem ×1 denendi). `has_table_privilege('app_tenant','refresh_tokens','DELETE')` = `t` olduğu için yetki taraması bunu **göstermez** — yanıltıcıdır.

```sql
-- Cascade hedefi tablolarda DELETE sahibe geri verilir (dar kapsam).
GRANT DELETE ON public.refresh_tokens, public.agents, public.print_jobs TO migrator;
```

**Yeni `ON DELETE CASCADE` FK ekleyen her migration'da bu kontrol ZORUNLU** — açığı bulan sorgu:

```sql
SELECT c.conname, tref.relname AS referencing_tablo, c.confdeltype AS eylem
FROM pg_constraint c JOIN pg_class tref ON tref.oid = c.conrelid
WHERE c.contype='f' AND c.confdeltype IN ('c','n')
  AND NOT has_table_privilege(pg_get_userbyid(tref.relowner), tref.oid,
        CASE c.confdeltype WHEN 'c' THEN 'DELETE' ELSE 'UPDATE' END);
-- 0 satır dönmeli. Satır dönerse o tabloya sahip-GRANT'ı gerekir.
```

Doğrulama (her ikisi `f` dönmeli — 2026-07-04'te prod'da doğrulandı; sahiplik devri sonrası 2026-07-10'da YENİDEN doğrulandı; cascade GRANT'ı sonrası 2026-07-23'te ÜÇÜNCÜ kez doğrulandı — güvenlik niyeti korunuyor):
- [x] `SELECT has_table_privilege('migrator','pgmigrations','DELETE');` → `f`
- [x] `SELECT has_table_privilege('migrator','orders','DELETE');` → `f`
- [x] Cascade açık sorgusu (yukarıda) → **0 satır** (2026-07-23)

## 7. Migrator credential rotasyonu (pilot — MANUEL; ADR-001 §7.2 sapması, ADR-031 K3)

`rotate-migrator.yml` otomasyonu CI/CD ile birlikte v5.1'e ertelendi (GitHub Actions prod PG'ye erişemez — PG localhost-only). Pilotta rotasyon sunucuda elle, **her migration'lı deploy sonrası gözden geçir / en geç aylık**:

**Reçete: §12.3** — "Hazırlık" + "A"nın `migrator` satırı (+ §12.4/5 doğrulaması).

> ⚠️ Buradaki eski üç satırlık reçete (2026-11-25'te kaldırıldı) parolayı `psql -c` ve `sed -i` komut satırına koyuyordu → çalışırken `ps` çıktısında görünür (ADR-050 K5 kural 4). Kullanma. `app_tenant` ve `cron_purger` parolaları da §12.3 A'dadır.

## 8. SSL yenileme

Certbot systemd timer'ı otomatik yeniler (`systemctl list-timers | grep certbot`). Manuel test: `certbot renew --dry-run`. Sertifika durumu: `certbot certificates`.

## 9. Sorun giderme

| Belirti | Neden / çözüm |
|---|---|
| API çöküyor: `ERR_MODULE_NOT_FOUND @restoran-pos/shared-types/dist` | `pnpm --filter @restoran-pos/shared-types build` atlanmış — koş, `pm2 restart pos-api` |
| `password authentication failed` / "empty string is not a valid password" | Secrets dosyası yarım (bkz. §3 tuzak notu) — doğrula, gerekirse parolaları yeniden ata |
| 502 `/api` | API down: `pm2 logs pos-api --lines 50 --nostream` |
| "Hata var mı?" / deploy sonrası sağlık kontrolü | **§9.1'e bak** — uygulama hataları `pos-api-out.log`'ta, `error.log`'ta **değil**. `grep '"level":50' /root/.pm2/logs/pos-api-out.log \| tail -20` |
| `/auth/*` `429` beklenmedik | **ADR-002 Amd8 — §10.1'e bak** (üç kova, kurtarma tek komut). Kovalar gerçek istemci IP'sini görür (`trust proxy=1` + Nginx `$proxy_add_x_forwarded_for`) |
| Nginx config değişikliği | `nginx -t && systemctl reload nginx` (test etmeden reload etme) |
| Bir migration'ı geri almak gerekiyor | 🔴 **`node-pg-migrate down` ASLA** (ADR-049 K4): 054-067 ve 070'teki `-- DOWN migration YOK` yorumu kütüphanenin down-bölüm işaretiyle eşleşir → `down`, up SQL'in kuyruğunu **yeniden koşar**. Bugün bunu yalnız `migrator`'ın `pgmigrations` DELETE yetkisinin olmaması durduruyor; superuser'la hiçbir şey durdurmaz. Yol: `pos-release rollback` (§11.3) → gerekirse `--sema-geri` (ADR-049) → yedekten yalnız etkilenen alan |
| Sunucu reboot sonrası API yok | `systemctl status pm2-root`; `pm2 resurrect` |
| Site tamamen erişilemez / **Namecheap parking sayfası** dönüyor | DNS nameserver ayarı **"Custom DNS"e** dönmüş olabilir (parking zone; A-kayıtları doğru olsa bile Custom-DNS'te UYGULANMAZ). Namecheap → Domain → Nameservers'ı **"Namecheap BasicDNS"e** çevir → Advanced-DNS A-kayıtları (`@`/`www` → `167.233.78.127`) tekrar geçerli olur. Tanı: `dig +short restoranpos.org` parking-IP dönerse önce nameserver-TİPİNİ kontrol et. A-kayıtlarına DOKUNMA (zaten doğru). Kayıt: S99 (2026-07-18) kesintisi. |

### 9.1 Log düzeni — hangi hata nerede (2026-11-03 ölçümü)

⚠️ **`pos-api-error.log` UYGULAMA HATASI İÇERMEZ.** Prod'da pino **stdout**'a yazar; `error.log` yalnız ham **stderr** dökümü alır. Ölçüldü: tüm geçmişte `error.log` içinde pino `level:50` satırı **0**, uygulama seviyesindeki 18 hata kaydının **hepsi** `out.log`'ta. `error.log`'a bakıp "hata log'u temiz" demek **kördür** — bu tuzağa S145'te düşüldü ve bir chip 20 gün açık kaldı.

| Dosya | İçerik |
|---|---|
| `/root/.pm2/logs/pos-api-out*.log` | **Uygulama log'u** — pino JSON. Hatalar (`level:50`), uyarılar (`level:40`), açılış satırları, iş kayıtları. **Hata aramak için burası.** ⚠️ 2026-11-03'ten beri günlük dönüyor: `pos-api-out.log` = bugün, `pos-api-out__<tarih>.log` = geçmiş. **`*` olmadan arama yaparsan yalnız bugünü görürsün.** |
| `/root/.pm2/logs/pos-api-error.log` | Ham stderr: yakalanmamış stack'ler, sürücü dökümleri. Örnek: 2026-10-16'da `unattended-upgrades` Postgres'i yeniden başlatınca düşen 776 satırlık `57P01` havuz dökümü (kaynağı ve 2026-11-03'teki pencere değişikliği: **§9.2**). Burada bir şey olması uygulama hatası demek **değil**; olmaması temiz demek **değil**. |

🔴 **2026-11-03'ten beri log'lar DÖNÜYOR — tek dosyaya bakmak artık ikinci bir körlük kaynağı.** `pm2-logrotate` günlük döndürdüğü için `pos-api-out.log` yalnız **bugünü** tutar; geçmiş `pos-api-out__<tarih>.log` dosyalarındadır. Kurulum anında ölçüldü: glob'la **18** `level:50` satırı görünüyor, yalnız canlı dosyaya bakınca **0**. Yani eski reçete bugünden sonra "hata log'u temiz" diye **yanlış** cevap verirdi — `error.log` tuzağının birebir aynısı, yeni kılıkta. **Her aramada `*` kullan.**

```bash
# Uygulama hatalarını ara (DOĞRU yol — donmus dosyalar DAHIL):
grep -h '"level":50' /root/.pm2/logs/pos-api-out*.log | tail -20

# Uyarılar:
grep -h '"level":40' /root/.pm2/logs/pos-api-out*.log | tail -20

# Belirli bir güne bak:
grep -h '^2026-10-19' /root/.pm2/logs/pos-api-out*.log | grep '"level":50'

# Sıkıştırılmış dosya da varsa (compress açılırsa) ikisini birlikte tara:
zgrep -h '"level":50' /root/.pm2/logs/pos-api-out*.log /root/.pm2/logs/pos-api-out*.log.gz 2>/dev/null | tail -20
```

`pm2 logs pos-api --nostream` ikisini **birleştirip** gösterir; dosyaya doğrudan bakarken yukarıdaki ayrım geçerlidir.

#### Saklama süresi — **90 gün, as-built** (2026-11-03'te canlıya alındı)

| | Durum |
|---|---|
| `pm2-logrotate` modülü | ✅ **KURULU** — v3.0.0, `online` |
| Ayarlar | `max_size 10M` · `retain 90` · `compress true` · `rotateInterval 0 0 * * *` · `workerInterval 30` |
| Sonuç | Günlük dönüş; geçmiş `pos-api-out__<tarih>.log` dosyalarında, **90 dosya** tutulur |
| Kurulum anındaki devir | `pos-api-out__2026-11-03_07-25-37.log` (700 KB) + `pos-api-error__...` (168 KB); canlı dosyalar 0'a indi |
| `pos-api` yeniden başlaması | **YOK** — restart sayacı kurulum öncesi ve sonrası **222**. Oturum kaybı olmadı, web 200 · api 200. |
| Disk | 38 GB'ın 6.0 GB'ı dolu (%17) |

**Geri alma (tek komut):** `pm2 uninstall pm2-logrotate` — modül ayrı bir süreç, `pos-api`'ye dokunmaz.

Kurulum sırasında ampirik olarak çıkan **iki tuzak** (ikisi de tahminle değil koşturarak bulundu):

- 🔴 **`pm2 trigger pm2-logrotate rotate` YOK.** *"Not any process has received a command"* döner; modül böyle bir eylem sunmuyor. Dönüşü gerçek mekanizmayla sınamak gerekir: `max_size`'ı geçici olarak `50K` yap → `workerInterval` (30 sn) kadar bekle → dosyaların döndüğünü gör → `max_size`'ı `10M`'ye geri al.
- ⚠️ **`compress true` ayarlanıyor ama `.gz` üretmedi.** Dönen dosyalar düz `.log` kaldı; modülün kendi log'u da `"...__<tarih>.log" has been created` diyor. `module_conf.json`'da değer **string** `"true"` olarak duruyor (`rotateModule` ise gerçek boolean). Bu hacimde **önemsiz** — 7 KB/gün × 90 gün ≈ 630 KB — o yüzden peşine düşülmedi, ama "sıkıştırılıyor" diye **varsayılmamalı**. Arama reçetelerinde `zgrep` satırı yine de duruyor; ileride `.gz` çıkarsa o da taranır.

**Önceki as-built (2026-10-19 → 2026-11-03):** modül kurulu değildi, sistem `logrotate` kuralı yoktu, log'lar 2026-07-04'ten beri hiç dönmüyordu (`out.log` 700 KB · `error.log` 168 KB, ~122 günde 868 KB).

⚠️ **Risk disk değil** — büyüme ~7 KB/gün, diskin dolması için on yıllar gerekir. Log'un **içeriği** sayıldı (2026-11-03):

| Ölçüm | Sonuç |
|---|---|
| Toplam satır | 2 745 |
| `tenantId` taşıyan satır | 1 537 — **1 535'i `caller_id.incoming.emitted`** (`level:30`) |
| `userId` taşıyan satır | **0** |
| `level:50` (hata) satırı | 18 — **hiçbirinde** `tenantId`/`userId` yok |
| Telefon numarası | **YOK** — caller_id satırının alanları yalnız `tenantId` · `callLogId` · `stationUserId` (CLAUDE.md "Caller ID verisini log'lamak yasak" kuralı tutuyor) |

🔴 **Bu bölümün önceki dayanağı yanlıştı.** Metin *"`#746`'dan beri 5xx log satırında `tenantId` ve `userId` var"* diyordu. **Kod için doğru, prod'da üretilmiş satır sayısı sıfır:** son `level:50` **27 Eylül**, `#746` ise **17 Ekim**'de deploy edildi → zenginleştirme hiç tetiklenmedi. Log'daki tek kişisel-veri bağı aslında **caller_id akışı** ve bölüm ondan hiç söz etmiyordu. *(Ders: doküman envanteri bayatlar — karar almadan önce koddan ve prod'dan yeniden say.)*

✅ **Müşteri telefonunun efektif saklama süresi zaten 30 gün — tanımlı VE prod'da çalışıyor.** `apps/api/src/cron/ttl-cleanup.ts` → `CALL_LOG_RETENTION_DAYS = 30` (KVKK §13.2.A). Prod'da doğrulandı (2026-11-03), pozitif + negatif kontrol birlikte:

| Kontrol | Sonuç |
|---|---|
| `call_logs` satır sayısı | 225, **en eski tam 30 gün** önce → purge koşuyor |
| 7 Tem log satırının `callLogId`'si DB'de | **0 satır** → numaraya çözülemez |
| 2 Kas log satırının `callLogId`'si DB'de | **1 satır** → bağ taze olduğunda gerçek (pozitif kontrol) |

Yani **30 günden eski bir log satırı fiilen anonimdir** — `callLogId` silinmiş bir satırı gösterir, telefon numarası ondan geri getirilemez. Süresiz kalan şey müşteri verisi değil, **personel etkinliği metaverisi**: hangi istasyon kullanıcısı ne zaman çağrı karşıladı (7 Tem'den beri 1 535 olay). **Politika boşluğu buradaydı; 90 günlük pencere ona sınır koydu.**

**Kıyas — asimetri aslında TERS yönde doğru.** nginx access log'u **gerçek IP** tutar ve onu silen bir DB işi yoktur → oradaki `daily`, `rotate 14` kısa pencere **yerinde**. PM2 `out.log` ise doğrudan PII tutmaz ve projenin **tek teşhis geçmişidir**. Pm2'yi nginx'in 14 gününe hizalamak müşteri verisini **hiç** daha iyi korumaz (tavanı DB purge'ü koyuyor), karşılığında teşhis gücünü yok eder.

**✅ KARAR: 90 gün** (ürün sahibi, 2026-11-03) — **uygulandı**, kurulan komutlar:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 90          # nginx'in 14'ü DEĞİL — gerekçe yukarıda
pm2 set pm2-logrotate:compress true      # ⚠️ .gz üretmedi, yukarıdaki tuzak notu
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
```

**90 gün neden:** DB'nin 30 günlük tavanının rahatça ötesinde kalır (teşhis için gereken "geçen aya bak" penceresi korunur), o güne kadar **tanımsız** olan personel-metaveri saklamasına ilk kez sınır koyar, dosya büyümesini hijyen olarak kapatır. S145'teki `23514` teşhisi log'un 4 Temmuz'a kadar gitmesi sayesinde kapandı; 14 gün olsaydı kapanamazdı (nginx tarafında tam olarak bu yaşandı — route atfı için gereken Eylül kayıtları silinmişti).

Reddedilen alternatifler kayda geçsin: **30 gün** (DB ile hizalı — tek sayı akılda kalır ama "geçen ay şöyleydi" karşılaştırması kaybolur) ve **14 gün** (nginx ile hizalı — müşteri verisini daha iyi korumaz, teşhis geçmişinin çoğunu siler).

**Doğrulama — gece koşumunu BEKLEMEDİK.** Zamanlanmış işi kurup sabahı beklemek, çalışıp çalışmadığını bilmeden geçen bir gece demektir. Dönüş aynı dakika gerçek mekanizmayla sınandı (`max_size` geçici `50K`, 30 sn bekle, geri `10M`) ve döndüğü görüldü; `pos-api` restart sayacı **222**'de kaldı, web 200 · api 200. Tekrar sınamak gerekirse:

```bash
# Donusun gerceklestigini kanitla (trigger YOK, mekanizmayi kullan):
pm2 set pm2-logrotate:max_size 50K && sleep 40 \
  && ls -lh /root/.pm2/logs/ && pm2 set pm2-logrotate:max_size 10M

# Ayarlari ve API'yi dogrula:
cat /root/.pm2/module_conf.json
curl -s -o /dev/null -w '%{http_code}\n' https://restoranpos.org/api/health
```

---

### 9.2 Otomatik paket güncellemesi — pencere 04:00 TR'ye taşındı (as-built, 2026-11-03)

**Sunucunun saat dilimi UTC'dir.** Türkiye = UTC+3; aşağıdaki her saat bu çevrimle okunur.

`unattended-upgrades` kurulu ve **kalması isteniyor** — internete açık bir sunucuda güvenlik yamaları günlük akmalı. Sorun yamaların kendisi değil, **ne zaman** uygulandığıydı.

| | Önce | Sonra |
|---|---|---|
| `OnCalendar` | `*-*-* 6:00` (dağıtım varsayılanı) | `*-*-* 1:00` |
| `RandomizedDelaySec` | 60 dk | 30 dk |
| Etkin pencere | **09:00–10:00 TR** | **04:00–04:30 TR** |
| Sonraki koşum (ölçüldü) | Çar 2026-11-04 06:16:35 UTC | Çar 2026-11-04 **01:19:08 UTC** |

**Korelasyon tahmin değil, ölçüldü.** Postgres sürecinin başlama zamanı `Sun Oct 25 06:40:44 UTC` = **09:40 TR** — eski pencerenin tam içinde. S145/S146/S147'de "Postgres ~09:30 TR'de kendiliğinden yeniden başladı" diye not düşülen 16/22/25 Ekim olaylarının kaynağı bu timer'dı. `pos-api-error.log`'daki 776 satırlık `57P01` havuz dökümü de aynı olayın izidir (§9.1 tablosu).

⚠️ **Yama hâlâ servisi yeniden başlatabilir, sadece artık ölü saatte.** `Unattended-Upgrade::Automatic-Reboot` **ayarlanmamış** → sunucu yeniden başlamıyor, yalnız paketi güncellenen servis (Postgres) yeniden başlıyor. Bugüne kadarki üç olayda `pos-api` hiç düşmedi (restart sayacı sabit kaldı) ve sipariş kaybı olmadı; havuz kendini toparladı.

```bash
# /etc/systemd/system/apt-daily-upgrade.timer.d/override.conf
[Timer]
OnCalendar=
OnCalendar=*-*-* 1:00
RandomizedDelaySec=30m
```

🔴 **Boş `OnCalendar=` satırı ATLANMAZ.** systemd'de `OnCalendar` **birikimli** bir listedir: boş atama olmadan yeni satır eskisini değiştirmez, **yanına eklenir** ve timer hem 01:00'de hem 06:00'da koşar — yani sorun çözülmüş görünür, aslında eski pencere yerinde kalır. Doğrulaması tek komut; çıktıda **tek** bir girdi görmelisin:

```bash
systemctl show apt-daily-upgrade.timer -p TimersCalendar -p RandomizedDelayUSec
systemctl list-timers apt-daily-upgrade.timer --all   # NEXT sutunu 01:00-01:30 UTC olmali
```

**Geri alma:** `rm /etc/systemd/system/apt-daily-upgrade.timer.d/override.conf && systemctl daemon-reload && systemctl restart apt-daily-upgrade.timer`

**Dokunulmadı:** `apt-daily.timer` (ayrı birim, günde iki kez paket listesi yeniler). Servis yeniden başlatmaz ve `APT::Periodic::Download-Upgradeable-Packages "0"` olduğu için indirme de yapmaz → yerinde bırakıldı.

---

### 10.1 `/auth/*` rate-limit — kurtarma ve izleme (ADR-002 Amd8, K7/K8)

Üç kova var (hepsi **bellek-içi**, `apps/api/src/routes/auth.ts`):

| Kova | Kapsam | Tavan |
|---|---|---|
| `authBaselineLimiter` | tüm `/auth/*`, **var olmayan yollar dahil**, per-IP | 60 / dk |
| `loginStrictLimiter` | `/login`, **IP + e-posta**, yalnız BAŞARISIZ | 5 / 15 dk |
| `loginVolumeLimiter` | `/login`, per-IP, yalnız BAŞARISIZ | 30 / 15 dk |

**🚑 Personel giriş yapamıyor / `429` alıyorsa — kurtarma TEK KOMUT:**

```bash
pm2 restart pos-api --time
```

Store bellek-içi olduğu için restart **tüm kovaları sıfırlar**. ⚠️ **Oturum kaybı YOK** — JWT ve refresh token'ları DB'de, restart onları etkilemez. Yani bu komut servis saatinde de güvenle koşulabilir.

**📈 K8 izleme — deploy sonrası ilk 7 gün (rollback ölçütü):**

**Deploy tarihi: 2026-10-11 09:08 UTC** (prod `64e45f0`, pm2 restart #215) → izleme penceresi 2026-10-18'e kadar.

> ✅ **K8 PENCERESİ KAPANDI — 2026-10-19 07:49 UTC. Rollback GEREKMEDİ.**
>
> **Sonuç:** 2026-10-11 → 2026-10-19 arası **10 ölçüm, hepsi `PASS`**, her birinde `restoran=0 diger=0 toplam=0`. Yani pencerede restoran IP'sinden **tek bir `429` bile doğmadı** — ölçüt "7 günde ≥2 olay"dı, gerçekleşen **0**. Kapanıştan hemen önce script elle de koşuldu (`--by-hour`): `RESTORAN IP 429: 0`, exit **0**, verdict `PASS`.
>
> **Yapılan:** `systemctl disable --now auth-429-watch.timer` → doğrulandı: `is-active` = `inactive`, `is-enabled` = `disabled`.
>
> ⚠️ **`auth-429-watch.service` BİRİMİ SİLİNMEDİ** — yalnız günlük timer durdu. Şüphe duyulan herhangi bir anda yukarıdaki elle koşum komutları aynen çalışır; `/auth/*` kilitlenmesi bildirilirse önce o script koşulur, sonra `pm2 restart pos-api`.
>
> ⚠️ **Tarihsel not:** ölçümün penceresi `/var/log/nginx/access.log*` ile sınırlıdır ve **logrotate 14 gün** tutar. Yani bu pencerenin ham kanıtı 2026-11-02 civarında silinir; kalıcı kayıt `/var/log/restoran-pos/auth-429-watch.log` ve bu paragraftır.

Ölçüm otomatik: `auth-429-watch.timer` her gün 06:00 UTC'de koşar ve `/var/log/restoran-pos/auth-429-watch.log`'a tek satır ekler. Elle koşmak / ara bakmak için:

```bash
set -a; . /etc/restoran-pos/auth-429-watch.env; set +a                # RESTAURANT_IPS gerekir
/opt/restoran-pos/apps/api/scripts/ops/auth-429-watch.sh --by-hour   # rapor + verdict (PASS=0, ALERT=1)
cat /var/log/restoran-pos/auth-429-watch.log                         # 7 günlük kayıt
systemctl list-timers auth-429-watch.timer                           # timer canlı mı
```

Script'in yaptığı iş, önceki düz `grep -c '" 429 '` sayımının **ayrıştırılmış** hâli — çünkü toplam sayı tek başına ölçüt değil:

- Deploy öncesi taban değer: **0** (2026-10-01→10-10 ölçümü).
- **Restoranın kendi IP'sinden** (başarılı `/auth/login` 200'lerinin 6/6'sı ve `refresh` 200'lerinin 503'ü tek bir baskın adresten) servis saatinde **≥1** `429` → derhal `pm2 restart pos-api` + tavanları yeniden değerlendir. Script bunu `RESTORAN IP 429` satırında verir.
  - ⚠️ **Adres repo'da TUTULMAZ** (repo public; işletmenin internet bağlantısını ifşa eder). Sunucuda `/etc/restoran-pos/auth-429-watch.env` (600) içinde: `RESTAURANT_IPS="<ip>"`. Script env'i okur, tanımsızsa **sessiz 0 dönmez** — anlamlı hatayla `exit 2` verir. Elle koşumda: `--only-ip <ip>`.
- **7 günde ≥2** böyle olay → PR geri alınır.
- Dış IP'lerden gelen `429` **beklenen sonuçtur**, ölçüt değildir (ölçümde 10 günde 88 adet `POST /auth/signin` taraması vardı) — script bunu ayrı `diger IP 429` satırında tutar.

⚠️ **ALERT geldiğinde İLK sorulacak soru — geliştirme makinesi aynı IP'den çıkıyor.** S140'ta ölçüldü: deploy doğrulamasında dev makinesinden atılan 65 istek (60×404 + 5×429) access log'da **restoranın IP'si olarak** göründü. Yani buradan prod'a atılan her `/auth/*` denemesi ölçütü **yanlış tetikler**. ALERT'te sırayla: (1) `--by-hour` ile saati al, (2) o saatte prod'a kasıtlı istek atılıp atılmadığını teyit et, (3) kasıtlı testse `--exclude <yol>` ile ele. S140'ın doğrulama probe'u `/api/auth/__ratelimit-probe` yolu üzerinden script'te **zaten varsayılan olarak elenir**; ham sayım için `--no-exclude`.

⚠️ **Kapsam sınırı:** personel yalnız restoran ağından değil **hücresel bağlantıdan da** giriyor (ölçüm: baskın IP dışındaki adreslerden 116 başarılı `refresh`). Tek bir hücresel cihaz kilitlenirse bu grep onu **göstermez** — kanal kullanıcı bildirimidir.

<details>
<summary><b>as-built: <code>auth-429-watch</code> systemd birimleri</b> (repo'da versiyonlanmaz — pg-backup emsali, S140'ta kuruldu)</summary>

`/etc/systemd/system/auth-429-watch.service`:

```ini
[Unit]
Description=Restoran POS /auth/* 429 izlemesi (ADR-002 Amd8 K8)
After=nginx.service

[Service]
Type=oneshot
User=root
EnvironmentFile=/etc/restoran-pos/auth-429-watch.env
ExecStart=/opt/restoran-pos/apps/api/scripts/ops/auth-429-watch.sh --append
# Script ALERT'te exit 1 döner; bu birim için başarısızlık DEĞİL (ölçüm yapıldı demek).
SuccessExitStatus=0 1
```

`/etc/systemd/system/auth-429-watch.timer`:

```ini
[Unit]
Description=Gunluk /auth/* 429 izleme anlik goruntusu

[Timer]
OnCalendar=*-*-* 06:00:00
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now auth-429-watch.timer
```

`root` olarak koşuyor çünkü `/var/log/nginx/access.log*` okuması ve `/var/log/restoran-pos/`'a yazması gerekiyor. **Yeni veri toplamıyor** — Nginx'in 14 gün zaten tuttuğu satırları sayıyor, snapshot log'una yalnız **sayı** yazıyor (IP yazmıyor; KVKK açısından ek toplama yok).

🔒 **Script root koşuyor ve girdisi saldırgan kontrolünde** — S140 güvenlik kapısı burada **kritik bir root-RCE** buldu ve kapattı. Script'in başındaki §GÜVENLİK bloğundaki iki kural (**K-A:** log verisi hiçbir harici komuta geçmez · **K-B:** alan konumuna (`$4`/`$7`) güvenilmez, regex + biçim doğrulaması) **bozulmamalı**. Prod'da ampirik: Nginx `$remote_user`'ı `Authorization: Basic`'ten auth_basic kapalıyken de doldurur, boşluk içerebilir (alan kayması) ve `$ ( ) \`` karakterlerini **kaçırmaz** — yani log satırı kabuğa giderse uzaktan kod çalıştırılır.

🧹 **Pencere kapanınca (2026-10-18):** `sudo systemctl disable --now auth-429-watch.timer`. Artık-root-timer bırakma.

</details>

🔒 **Bozulmaması gereken iki dış koşul** (kodda değil, altyapıda):
1. Nginx `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` **kalmalı**. `$http_x_forwarded_for`'a çevrilirse istemci kendi IP'sini uydurur ve **üç kova da anlamsızlaşır**.
2. API süreci `*:3001` dinliyor (yalnız loopback değil) → Nginx'i atlayan doğrudan erişim aynı sonucu doğurur. Koruma **ufw**'den geliyor: `ufw status` → yalnız `OpenSSH`, `80/tcp`, `443/tcp` açık olmalı. 3001 dışarı açılırsa rate-limit bypass edilebilir.

### 10.2 Çoklu-tenant tenant çözümü — Faz 1 deploy (ADR-042)

**Ne değişiyor:** giriş artık tenant'ı **işletme kodundan** (`tenants.slug`) çözüyor; refresh token kendini tanımlıyor (`rt1_<32hex tenant>_<secret>`). Alan **opsiyonel** — göndermeyen istemci `TENANT_ID`'deki varsayılan tenant'a düşer.

**Sıra bağlayıcı:**

| Adım | İş | Pencere |
|---|---|---|
| 0 | `SELECT id, slug FROM tenants;` → slug biçime uyuyor mu, `TENANT_ID` ile id eşleşiyor mu | ✅ 2026-10-13'te yapıldı: `dilan-pide`, uyuyor, **UPDATE gerekmedi** |
| 1 | **Mig 068** (`tenants_slug_format` CHECK) | **Kapalı restoran ŞART DEĞİL.** Ama `tenants` sıcak yolda okunuyor (giriş **ve fiş kuyruğa atma**) ve `AccessExclusiveLock` koşumun COMMIT'ine kadar tutulur → en kötü hâl ≤3 sn giriş+baskı duraklaması. **19:00-22:00 zirvesinde koşma.** Koşumda yalnız 068 olsun (prod head 067 mi, doğrula) |
| 2 | **API deploy** | 🔴 **RESTORAN KAPALIYKEN.** Fail-closed: dört çağrı noktasından biri yanlış tenant çözerse hata **sessizdir** (force-RLS'te context'siz SELECT 0 satır döner, fırlatmaz) → giriş 401, rotasyon 401, açık oturumlar 30 dk içinde düşer |
| 3 | **[USER] duman testi — gerçek tarayıcı + gerçek telefon** | Aşağıdaki beş madde |
| 4 | İstemciler (web + mobil) | Ayrı PR'lar; mobil **EAS Update OTA** yeter (JS-only) |
| 5 | Guard dönüşümü + rate-limit slug kanonikleştirmesi | — |
| 6 | **Ancak bundan sonra** ikinci tenant | Adım 4 inmeden açılırsa o şubenin personeli varsayılan tenant'a düşer → **yanıltıcı** "e-posta veya şifre hatalı" |

**Adım 3 — duman testi (200 yanıtı TEK BAŞINA kanıt değildir):**
1. İşletme kodu **boş** → giriş 200
2. İşletme kodu **doğru** (`dilan-pide`) → giriş 200
3. Sayfa yenile (rotasyon) → oturum **düşmüyor**
4. Çıkış → DB'de **sayarak** doğrula:
   `SELECT revoked_reason, count(*) FROM refresh_tokens WHERE revoked_at > now() - interval '5 min' GROUP BY 1;` → `logout` görünmeli
5. **App Store'daki GÜNCELLENMEMİŞ** mobil sürümle giriş + yenileme → çalışmalı (geriye uyumluluk)

**Geri alma:** `git revert` + redeploy. Önekli olarak dağıtılmış token'lar eski kodda öneksiz sanılıp varsayılan tenant'ta aranır ve hash'leri **orada vardır** (tenant tek) → **oturumlar düşmez**. Mig 068 geri alma gerektirmez; gerekirse:
`ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_slug_format;`
⚠️ Bu bedelsizlik **yalnız ikinci tenant yaratılmadan önce** geçerlidir.

**İzleme (K4(iv)) — legacy yolun boşaldığını ÖLÇEREK bilmek için:**
```bash
pm2 logs pos-api --nostream --lines 2000 | grep -c 'auth.login.without_slug'
pm2 logs pos-api --nostream --lines 2000 | grep -c 'auth.refresh.legacy_unprefixed'
```
Sayaçlar yalnız **başarılı** giriş / **biçim-geçerli** öneksiz token'da yazılır (bot gürültüsü sayılmaz). Token ömrü azami **37 gün**; ikisi de sıfırlanınca varsayılan-tenant fallback'i kapatılabilir.

---

### 10.3 Demo tenant açma — Faz 2 (ADR-043)

**Ne yapılır:** canlı tenant'a dokunmadan, prod DB'sinde ikinci bir tenant (`slug=demo`) + jenerik katalog + mağaza incelemesi için `waiter` hesabı.

**Ön koşul:** ADR-042 Faz 1 adım 4 (web + mobil işletme kodu alanı) **prod'da olmalı** — indi: 2026-10-16. Yoksa demo personeli varsayılan tenant'a düşer ve yanıltıcı "e-posta veya şifre hatalı" alır.

**Sıra:**

```bash
cd /opt/restoran-pos/apps/api
set -a; . /etc/restoran-pos/api.env; set +a    # TENANT_ID + DATABASE_URL birlikte gelir
```

Bu `source` K5 bariyerinin dayanağı olan **`TENANT_ID`**'yi ve **`DATABASE_URL`**'ü (`app_tenant`, NOBYPASSRLS) getirir.

🔴 **İKİ ADIM İKİ FARKLI ROL İSTER — karıştırma:**

| Adım | Rol | Neden |
|---|---|---|
| **bootstrap** | **`migrator`** (`MIGRATOR_DATABASE_URL`) | `bootstrap-prod.ts` **`withTenant` kullanmaz**; `tenant_settings`, `users` ve `agents` force-RLS altında. `app_tenant` ile koşarsa `tenants` satırını yazdıktan sonra **ilk korumalı INSERT'te RLS politikası ihlaliyle patlar** ve işlem geri alınır |
| **tohumlama** | **`app_tenant`** (`DATABASE_URL`) | Script her şeyi `withTenant` içinde yazar; `app_tenant` NOBYPASSRLS olduğu için bariyer atlansa bile DB ikinci ağ olur. `migrator` **BYPASSRLS**'tir, o bağlantıda tek savunma K5 kalır |

| Adım | Komut | Not |
|---|---|---|
| 1 | Koşum öncesi `COUNT(*)` kaydı: `areas · tables · categories · products · users` — **her iki tenant için** | Hasar tespitinin tek zemini. ⚠️ Sayımı **`sudo -u postgres psql`** ile yap (aşağıdaki doğrulama notu) |
| 2 | `MIGRATOR_DATABASE_URL=… ./node_modules/.bin/tsx scripts/bootstrap-prod.ts --tenant-name "Demo Restoran" --slug demo --admin-email …` | `ADMIN_PASSWORD` env ile. Tenant + `tenant_settings` + admin + **ilk `agents` satırı** kurar. **Bu adımda `migrator` şart** |
| 3 | `./node_modules/.bin/tsx scripts/seed-demo-tenant.ts --slug demo --dry-run` | Sourced `DATABASE_URL` ile (`app_tenant`). **Önce daima dry-run** — transaction gerçekten rollback eder |
| 4 | `./node_modules/.bin/tsx scripts/seed-demo-tenant.ts --slug demo` | `DEMO_WAITER_PASSWORD` env ile; satır **boşlukla** başlasın (`HISTCONTROL=ignorespace`) |
| 5 | Doğrulama (aşağıda) | |
| 6 | [USER] kimlikleri Play Console *App access* + App Store Connect *Sign-In Required* alanlarına girer | |
| 7 | **Ancak bundan sonra** canlı tenant'taki eski demo hesap devre dışı | ADR-043 K6 — ters sıra süren Play incelemesini **kırar** |

**Şifreler:** her ikisi de env ile çalışma anında verilir; repoya/ADR'ye/commit'e/sohbete **yazılmaz** (ADR-031 Amd4 K8).

**Beklenen yan etki — arıza DEĞİL:** `tenants > 1` olunca API açılışında `tenant-resolution guard` bir `warn` basar (*"çok tenant + varsayılan-tenant fallback açık"*). Bu ADR-042 K4-iii'ün bilinçli sinyalidir, **susturulmaz**.

**Demo tenant fiş BASMAZ.** Bootstrap bir `agents` satırı yaratır (kayıt sırrını taşıyan tek aday — **iptal edilmez**, edilirse o tenant'ta bir daha hiçbir ajan kaydolamaz), ama register öneki **sunucu sabitiyle** karşılaştırdığı için demo ajanı bugün 401 alır. Bu `MIM-7b`'dir, gövdesi **Faz 3**.

**Doğrulama — 🔴 `sudo -u postgres psql` ile, sourced `app_tenant` bağlantısıyla DEĞİL:**

> ⚠️ **Bu bölümün kendisi "sessiz 0" tuzağına düşebilir.** Yukarıdaki `source` kabukta `app_tenant`'ı bıraktı. O rolle, `app.current_tenant_id` **ayarlanmadan** force-RLS tablolarına atılan sorgular, `WHERE tenant_id = '…'` yüklemi olsa bile **0 döndürür** — hem canlı hem demo için. Yani doğrulama "her şey 0" der ve hiçbir şeyi kanıtlamaz. Sayımları `postgres` süperuser'ı (BYPASSRLS) ile çalıştır; context'li kontrol etmek istersen alttaki ikinci bloğu kullan.

```bash
sudo -u postgres psql -d pos_prod
```
```sql
-- 1) iki tenant
SELECT id, slug FROM tenants WHERE deleted_at IS NULL;
-- 2) CANLI tenant bozulmadı mı — adım 1'deki sayılarla karşılaştır
SELECT count(*) FROM orders   WHERE tenant_id = '<canli>';   -- küçülmemeli
SELECT count(*) FROM products WHERE tenant_id = '<canli>';   -- 98
-- 3) demo doğru dolu mu
SELECT count(*) FROM tables   WHERE tenant_id = '<demo>';    -- 10
SELECT count(*) FROM products WHERE tenant_id = '<demo>';    -- 15
```

**RLS'in gerçekten izole ettiğini görmek istersen** (süperuser değil, uygulamanın rolüyle) — her sorgu kendi transaction'ında ve context'li olmalı:
```sql
BEGIN;
  SET LOCAL ROLE app_tenant;
  SELECT set_config('app.current_tenant_id', '<demo>', true);
  SELECT count(*) FROM products;                 -- 15  (kendi verisi: akıl sağlığı)
  SELECT count(*) FROM orders;                   -- 0   (canlının siparişleri GÖRÜNMEMELİ)
COMMIT;
```
⚠️ `SET LOCAL ROLE` **transaction dışında etkisizdir** — `BEGIN` olmadan koşarsan sahte-yeşil alırsın.

⚠️ **"0 gördüm" tek başına kanıt değildir** — yanlış/eksik tenant context'i de 0 döndürür. Her "0" iddiasının yanında **kendi tenant'ının satır sayısı > 0** doğrulanır; ikisi birlikte kanıttır.

**[USER] duman testi:** işletme kodu `demo` + demo garson ile **gerçek telefondan** giriş → yalnız demo masalar, gerçek adisyon/müşteri **yok**; ardından işletme kodu `dilan-pide` ile giriş → canlı sistem normal.

#### 🔴 Acil geri alma

**PITR/yedekten dönüş bu iş için YOL DEĞİLDİR.** Script mevcut hiçbir satırı değiştirmez ve tek transaction'da koşar → **başarısız koşum iz bırakmaz**, geri alınacak bir şey olmaz. Geri alma yalnız **yanlış tenant'a yazıldıysa** gündeme gelir (K5 bariyeri bunu kapatır; bariyer sökülmüş bir sürümle koşulduysa geçerlidir).

Hasar **numaralanabilir**: `tenant_id` + `created_at` penceresi + bilinen doğal anahtarlar (2 bölge / 10 masa / 4 kategori / 15 ürün, adları script'te sabit).

Düzeltme **silme değil soft-delete** (K4 ile uyumlu):
```sql
UPDATE products   SET deleted_at = now() WHERE tenant_id = '<canli>' AND name IN (...) AND deleted_at IS NULL;
UPDATE categories SET deleted_at = now() WHERE tenant_id = '<canli>' AND name IN (...) AND deleted_at IS NULL;
UPDATE tables     SET deleted_at = now() WHERE tenant_id = '<canli>' AND code IN (...) AND deleted_at IS NULL;
UPDATE areas      SET deleted_at = now() WHERE tenant_id = '<canli>' AND name IN (...) AND deleted_at IS NULL;
```

İki tuzak, ikisi de yazılı olmalı:
- ⚠️ **`tables` soft-delete'i kodu SERBEST BIRAKMAZ** — `UNIQUE (tenant_id, code)` **kısmi değildir**. Yani o masa kodu bir daha kullanılamaz; gerçek masa o kodu istiyorsa kod elle değiştirilmelidir.
- ⚠️ **`users`'ta `deleted_at` kolonu YOK** (mig 018 hard-delete). Yanlış tenant'a bir demo garson yazıldıysa tek yol **şifre rotasyonu** veya elle `DELETE`.

### 10.4 Ajan tenant çözümü + kayıt anahtarı rotasyonu — Faz 3 (ADR-044)

🔴 **Dört dalga, sıra BAĞLAYICI: A → B → C → D.** Üç PR (`main`'de) tek pencerede iner; ayrı inişler dükkanı üç kez kapatırdı.

> ✅ **DALGA A İNDİ — 2026-11-14 10:58 UTC** (prod `04bb1ef` → `2c6045c`, migration head `068` → **`071`**, üçü tek transaction'da).
>
> ⚠️ **Ön koşul sapması, kayda geçsin:** tablo "restoran **KAPALI**" diyor; deploy **servis saatinde** (TR 13:58) indi, **ürün sahibinin açık talimatıyla**. Risk ölçülerek alındı: o anda **0 açık adisyon** vardı ve son sipariş 25 dk öncesindeydi. Sonuç sorunsuz, ama bu **emsal değildir** — Dalga D'nin "kapalı" koşulu rotasyon fail-closed olduğu için **esnetilemez**.
>
> **Alınan kabul kanıtları:** üç yazıcı restart'tan **8 sn** sonra `last_seen_at` taze (legacy `pk_` dalında akmaya devam etti — kabul ölçütünün kendisi) · `agent_registration_keys` **0 satır** · `agents.agent_version` **NULL** (ajan 0.0.4, sürüm yazımı B'yi bekler) · token'sız 5 route **5/5 401, hiç 500 yok** · 502 yalnız `10:58:31-32`'de **8 adet**, sonrası sıfır · `out.log`'da yeni hata yok · `index.html` `no-cache` + olmayan asset `404`. Yedek deploy ÖNCESİ: `Result=success`, `pos_prod-20261114-105731.dump.age`.
>
> > ✅ **DALGA B İNDİ — 2026-11-14 ~16:05 TR** (dükkan PC'si `DESKTOP-12RF81K`, yönetici PowerShell).
>
> **Yordam birebir script'le yapıldı:** `update-agents.ps1 -NewExe … -ExpectedVersion 0.0.5` — önce `-DryRun`, sonra gerçeği. Üç servis **nssm** ile sarılı ve üçü **aynı** `C:\Program Files\Restoran POS\Print Agent\print-agent.exe` dosyasını çalıştırıyor (kayıt defterinden doğrulandı) → ADR-044 K5'in düzeltilmiş hâli **pratikte teyit edildi**. Sıra: IZGARA → FIRIN(win32) → KASA.
>
> ⚠️ **Ön koşul eksikti, kayda geçsin:** reçete *"ajan 0.0.5"* diyor ama **0.0.5 exe'si derlenmemişti** — depodaki artefakt 21 Tem tarihliydi. `pnpm build && pnpm build:exe` ile derlendi; **sürümü kanıtlanmadan kurulmadı** (hem dizüstünde hem dükkan PC'sinde ulaşılamaz bir API adresine yönlendirilip boot log'u okundu → `başlatıldı v0.0.5`, canlıya dokunmadan). Sonraki dalgalarda bu adım reçeteye dahil sayılmalı.
>
> **Alınan kabul kanıtları:** kurulu SHA256 `8DF8A79F…` ≠ yeni `9E1FC9B8…` (gerçekten değişti) · yedek `print-agent.exe.bak` alındı · kopyalama SHA256 ile doğrulandı · **sunucu tarafı kanıt: üç `agents` satırının üçünde de `agent_version='0.0.5'`, hepsi ~17 sn içinde görüldü** — bu kolona yalnız BAŞARILI kimlik doğrulaması yazar, yani zincirin tamamı çalışıyor · `out.log`'da yeni hata yok · 401 zinciri temiz. Pencere: 0 açık adisyon, son sipariş 57 dk önce, **baskı kuyruğunda 0 bekleyen/0 basılan iş**.
>
> ✅ **`PRINT_AGENT_EXPECTED_VERSION=0.0.5` B'den SONRA yazıldı** (plan iyileştirmesi uygulandı → "üç kartta birden bayat rozeti" penceresi hiç oluşmadı). `/etc/restoran-pos/api.env` satır 14; yedek `api.env.bak-20261114-131023`. ⚠️ Ortam dosyası `run-api.sh` içinde `set -a; source …` ile yükleniyor → **`pm2 restart` yeterli, `--update-env` gerekmez**; yine de kanıt `/proc/<pid>/environ` okunarak alındı.
>
> ⏳ **Kalan [USER]:** kağıt testi (yazıcı yönetim ekranında sürüm satırı + bir mutfak, bir kasa fişi). **Sırada D** (canlı rotasyon, restoran KAPALI — bu koşul esnetilemez).
>
> ✅ **DALGA C KANITLANDI — 2026-11-15 06:19 UTC** (prod `80dc225`, demo tenant; canlı baskı yoluna dokunulmadı).
>
> **Sır disiplini:** anahtar üretimi + bütün curl'ler sunucuda **tek bir betikte** koştu; anahtar ve jeton yalnız kabuk değişkeninde durdu, istek gövdesine stdin'den verildi (süreç listesinde görünmez), betik sonunda `unset` edildi. Hiçbir terminale, log'a ya da sohbete düşmedi.
>
> **Alınan kabul kanıtları:** `rotate-agent-key.ts` demo için `pk2_<demo uuid>_<sır>` üretti (69 karakter) · `POST /agent/register` **200** · `GET /jobs/next?wait=0` **204** · demo sırrı + **canlı** tenant uuid'si → **401** `AUTH_INVALID_CREDENTIALS` · negatif kontrol (demo uuid + rastgele aynı uzunlukta sır) → **401** · `agents` satırı demo tenant'ta, `registration_key_id` = üretilen anahtarın id'si (`fe00e4e4…`) **birebir** · aynı fingerprint canlı tenant'ta **0 satır** · canlı üç ajanın `last_seen_at`'i önce/sonra **aynı**, canlı `agent_registration_keys` **0**.
>
> ⚠️ **Kabul ölçütünün yarısı bugün ifade EDİLEMEZ — Dalga D'ye taşındı:** ADR'nin "iki yönlü çapraz 401"inin ikinci yönü (*canlı anahtar demo'da 401*) için canlı tenant'ın bir `pk2_` anahtarı gerekir; o ancak Dalga D'de üretilir. Legacy `pk_` dalı tenant'ı sunucu sabitinden (`deps.tenantId`) aldığı için demo'ya yöneltilemez bile. → **Dalga D'nin kabul listesine eklendi:** rotasyondan hemen sonra canlı sır + **demo** uuid'si → **401**.
>
> 🔴 **Dalga C, Dalga D'yi riske atan bir betik hatası buldu (düzeltildi, bkz. aşağıdaki D yordamı notu):** `rotate-agent-key.ts` her koşumun sonunda havuzu iki kez kapatıyordu → **başarılı rotasyon** `HATA: Called end on pool more than once` ve çıkış kodu **1** ile bitiyordu; başarısız koşumda ise **asıl hata bu mesajın altında kayboluyordu**. Testler `rotateAgentKey()` fonksiyonunu çağırdığı için `main()`'deki bu kusuru göremiyordu. ([[feedback_ops_script_execute_not_review]] — betik okunarak değil ÇALIŞTIRILARAK doğrulandı.)
>
> 🧹 **Geride kalan:** demo tenant'ta `dalga-c-mim7b-202611150619` fingerprint'li bir ajan satırı + bir `agent_registration_keys` satırı. Zararsız: sır ve jeton koşum sonunda atıldı, kimsenin elinde değil. İstenirse yazıcı ekranından **kilitlenir** (bir kez görüldüğü için "Kaldır" kapısından geçmez — tasarım gereği).
>
> ✅ **DALGA D İNDİ — 2026-11-17 13:23–13:35 UTC** (prod `2115257`, **`git pull` yapılmadı** → mig 072 bilinçli olarak dışarıda kaldı).
>
> **Alınan kabul kanıtları:** `--dry-run` temiz → gerçek koşum çıkış kodu 0, `HATA` yok, anahtar id `df6c2e0a…`, 69 karakter · **üç `agents` satırının üçünde de `registration_key_id = df6c2e0a…`**, `last_seen_at` < 20 sn · canlı sır + **demo** uuid → **401** `AUTH_INVALID_CREDENTIALS`, deneme fingerprint'iyle ajan satırı **0** (çapraz 401'in ikinci yönü kapandı) · kâğıt testi üç yazıcıda geçti · `out.log`'da yeni hata 0.
>
> ⚠️ **Ön koşul sapması, kayda geçsin:** koşum anında **1 açık adisyon** vardı, son sipariş 16 dk önceydi; ürün sahibi bildirildikten sonra açık talimat verdi. Risk şöyle sınırlandı: servisler **tek tek** değiştirildi, her biri boot log'unda `register OK` görülmeden sonrakine geçilmedi, başarısızlıkta o servisin eski env'i otomatik geri yazılıyordu (eski `pk_` hâlâ geçerli). **Emsal değildir.**
>
> **Sır taşıma (yukarıdaki yordamın 1–2. adımlarının uygulanan hâli):** betik çıktısı sunucuda `umask 077` ile dosyaya yazıldı, anahtar hiçbir ekrana basılmadı → `scp` → **RustDesk dosya aktarma** (konsola yapıştırma karakter bozar) → dükkân PC'sinde yönetici betiği anahtarı dosyadan okudu, biçimini (`pk2_<tenant hex>_…`, 69 karakter) doğruladı, üç servisin `AppEnvironmentExtra` değerini **kayıt defterinden** (`HKLM:\SYSTEM\CurrentControlSet\Services\<svc>\Parameters`) yedekleyip yazdı, sonra anahtar dosyasını sildi. Sunucu kopyası `shred -u`.
>
> 🔎 **Bulgu:** KASA servisinde anahtar servis düzeyinde **yoktu** (sistem env'inden geliyordu); artık servis düzeyinde yeni anahtar var. Sistem env'inde eski `pk_` değeri kalmış olabilir — doğrulanmadı, zararsız (servis düzeyi önceliklidir).
>
> ℹ️ **4. adım (`--revoke-after-grace`) bu rotasyonda boş kalır:** `eski anahtar sayısı=0` — iptal edilecek eski `agent_registration_keys` satırı yok. Eski `pk_` anahtarı legacy dal kodda durdukça geçerlidir (bilinçli geri alma penceresi).

| Dalga | İçerik | Restoran | Kabul kanıtı (200/204 **kanıt değildir**) | Geri alma |
|---|---|---|---|---|
| **A** | Sunucu: mig **069 + 070 + 071** + v2 register dalı + sürüm yazımı + DTO + demo bariyeri | 🔴 **KAPALI** | Canlı üç yazıcı **legacy dalda** akmaya devam eder: `last_seen_at` < 60 sn, mutfak+kasa fişi **kağıtta**. `agent_registration_keys` **0 satır** | `git checkout <önceki>` + §4 build + `pm2 restart`. Kolonlar nullable → şema geri alma gerekmez (forward-only) |
| **B** | Ajan `0.0.5` — `update-agents.ps1` ile sıralı copy-over | 🔴 **KAPALI** | Üç servisin boot log'unda `0.0.5`; **yazıcı yönetim ekranında sürüm satırı** güncel, "Güncelleme bekliyor" rozeti söner | `.\update-agents.ps1 -Rollback` (script otomatik de geri alır) |
| **C** | MIM-7b kanıtı — **demo tenant**, canlı baskı yoluna DOKUNMADAN | açık olabilir | Demo için `pk2_` anahtarı üret → prod'a **curl** ile `POST /agent/register` **200** + `agents` satırında `registration_key_id` dolu + `GET /jobs/next` **204** + **iki yönlü çapraz 401** | Demo anahtar satırını iptal et (canlı yola hiç dokunulmadı) |
| **D** | Canlı tenant rotasyonu — **tek riskli dalga** | 🔴 **KAPALI** | `SELECT device_fingerprint, registration_key_id, last_seen_at FROM agents WHERE tenant_id = $1 AND revoked_at IS NULL;` → **üç satırın üçünde de YENİ anahtar id'si** + üç yazıcıda kağıt smoke | Eski anahtar henüz iptal edilmediği için: env'e eski değeri geri yaz + restart. ⚠️ Bu yol **ancak `api_key_hash` ezilmediği için** çalışır (ADR-044 güvenlik kapısı B1) |

**Dalga D yordamı** (makinenin başında, restoran kapalı):

```bash
# 0) Bağlantı: şifre ORTAM DOSYASINDAN okunur, komut satırına YAZILMAZ
#    (komut satırındaki şifre shell geçmişine ve `ps` çıktısına düşer).
#    api.env'deki DATABASE_URL `app_tenant` rolüdür — betiğin tercih ettiği rol
#    (force-RLS gerçekten ısırır). Bu biçim Dalga C'de prod'da kanıtlandı.
cd /opt/restoran-pos/apps/api
set -a; source /etc/restoran-pos/api.env; set +a
grep -c 'await pool.end' scripts/rotate-agent-key.ts    # → 0 olmalı (bkz. aşağıdaki ön koşul)
TENANT_ID=$(sudo -u postgres psql -d pos_prod -At -c "SELECT id FROM tenants WHERE slug='dilan-pide'")

# 1) Yeni anahtar üret — çıktı BİR KEZ görünür, hiçbir yere kopyalanmaz
./node_modules/.bin/tsx scripts/rotate-agent-key.ts \
  --tenant-id "$TENANT_ID" --actor <admin kullanıcı adı veya e-postası> --grace-days 7 --dry-run   # önce plan
./node_modules/.bin/tsx scripts/rotate-agent-key.ts \
  --tenant-id "$TENANT_ID" --actor <admin kullanıcı adı veya e-postası> --grace-days 7

# 2) Üç servisin nssm env'ini SIRAYLA güncelle + restart (dükkan PC'si, yönetici PowerShell)
# 3) DB'den doğrula: üç satırda da yeni registration_key_id
# 4) Kağıt smoke → ancak sonra: --revoke-after-grace (AYRI ve SONRAKİ koşum)
# 5) Dalga C'den devralınan: canlı sır + DEMO tenant uuid'si → register 401
#    (çapraz 401'in ikinci yönü; anahtarı sunucuda değişkende tut, ekrana basma)
```

⚠️ **Ön koşul (Dalga C'de bulundu):** sunucudaki `rotate-agent-key.ts` **havuzu iki kez kapatmayan** sürüm olmalı. Eski sürüm başarılı rotasyonu da `HATA: Called end on pool more than once` + çıkış kodu 1 ile bitirir → operatör "başarısız" sanıp **tekrar koşarsa ikinci bir anahtar üretilir** ve servislere yazılan ilki grace sonunda ölür. Kontrol: `grep -c 'await pool.end' /opt/restoran-pos/apps/api/scripts/rotate-agent-key.ts` → **0** olmalı (eski sürümde 1). Doğru çıktı: anahtar bloğu + `anahtar id=…` satırı, **`HATA` satırı YOK**, çıkış kodu 0.

🔴 **Kural: anahtar bloğu ekrana basıldıysa betiği ASLA tekrar koşma** — çıkış kodu 1 olsa bile. Anahtar basılmışsa transaction commit edilmiştir; tekrar koşmak ikinci bir anahtar üretir. Önce DB'ye bak: `SELECT id, created_at, valid_until FROM agent_registration_keys WHERE tenant_id = '<uuid>' ORDER BY created_at DESC LIMIT 2;` → en yeni satır az önceki koşumsa rotasyon **olmuştur**, ekrandaki anahtarla devam et.

⚠️ **Grace penceresi sessiz bir ölüm kipi taşır:** env'i güncellenmemiş bir servis, pencere dolduktan **sonraki ilk restart'ında** kaydolamaz ve o yazıcı susar. Rotasyon tamamlanmadan dükkandan ayrılma. Sızma şüphesi varsa `--grace-days 0` anahtarı anında öldürür.

**Deploy ön koşulları (A dalgası):**
- `shared-types` **build ŞART** (`pnpm --filter @restoran-pos/shared-types build`) — audit olay tipi oradan geliyor.
- Yedek adımı (§4) atlanmaz: bu deploy **üç migration** birden uygular.
- ⚠️ Prod 069'un gerisinde olduğu için üçü **tek transaction**'da koşar; `agents` üzerindeki kilit **069'da** alınıp COMMIT'e kadar tutulur (071'in kendi `lock_timeout`'u o kilit için no-op'tur).
- `PRINT_AGENT_EXPECTED_VERSION` → `/etc/restoran-pos/api.env`. Yazıcı kartındaki "Güncelleme bekliyor" rozetinin referansıdır; **boş bırakılırsa rozet hiç uyarmaz**. B dalgasından sonra `0.0.5` yazılır.

---

## 10. Geri dönüş (rollback)

> ⚠️ **Eski reçete KALDIRILDI (2026-11-24, ADR-047 ölçümü):** *"sunucuda `git checkout <önceki-commit>` + §4 build + restart"* **kullanılamaz** — çalışma kopyasını detached HEAD'de bırakır (sonraki `git pull` kırılır), geri almayı canlı dizinde **yeniden build**'e çevirir ve web parça uyuşmazlığını (S133 sınıfı) geri almada da yaratır.

**Bugün (2026-11-24 cutover'ından beri):** `pos-release rollback` — build yok, install yok, migration yok; şema kuralı (ADR-047 K5) güvenli değilse reddeder. Ayrıntı §11.3.

Operasyonel geri dönüş (restoran akışı) değişmedi: ADR-031 K10 — kısa kesintide kâğıt fallback + fix-forward, büyük arızada Adisyo'ya dönüş. **DB migration'ları forward-only** — migration'lı her deploy'dan önce yedek zorunlu (`pos-release deploy` bunu kendisi yapar).

## 11. Sürümlü yayın — `pos-release` (ADR-047, cutover SONRASI geçerli)

> **Durum: CANLIDA (cutover 2026-11-24 15:02–15:16 TR).** İlk sürüm `20261124T120706Z-cdff8a0` (yer değişikliği), ilk `pos-release deploy` `20261124T121052Z-647240d`. Tatbikat: deploy 30 sn (geçiş+smoke 7 sn) · **rollback 7,2 sn** · ileri `activate` 7 sn. Build tepe RSS ≈ 970 MB (23 sn). Betiğin kaynağı `apps/api/scripts/deploy/pos-release.sh`; sunucudaki kopya `self-install` ile güncellenir.

### 11.1 Düzen

```
/srv/restoran-pos/
├── releases/<UTC>-<sha7>/   değişmez sürüm (git archive + node_modules + shared-types/dist + web dist + RELEASE.json)
├── current -> releases/<id> tek canlı işaretçi (atomik rename ile değişir)
├── shared/  web.env.production · web-assets/ (tüm saklanan sürümlerin web parçaları) · release.conf · history · .lock
└── bin/     pos-release · run-api.sh   (hiçbir sürüme bağlı değil; PM2 bin/run-api.sh'ı koşar)
```

`shared/release.conf` (yoksa varsayılanlar = ürün sahibi cevapları S1/S2): `KEEP_RELEASES=5` · `SERVICE_START_HOUR=6` · `SERVICE_END_HOUR=3` (kilitli aralık 06:00→03:00, gece yarısını aşar → açık olan yalnız **03:00–06:00 bakım penceresi**, ADR-050 S1; 2026-11-25'e dek 10/24 idi) · `PNPM_STORE_DIR=` (boş = pnpm varsayılanı; prod'da store `/root/.local/share/pnpm/store/v3`, pnpm 9.15.9 corepack'ten — repo `packageManager` ile aynı, betik uyuşmazlıkta durur).

### 11.2 Normal deploy

**Lokalde** (değişmedi): `GIT_SSH_COMMAND="ssh -i ~/.ssh/restoran_pos_ed25519" git push prod main`

**Sunucuda** (yalnız bakım penceresinde **03:00–06:00 TR** — ADR-050 S1; dışında betik reddeder):
```bash
pos-release status                 # canlı sürüm, DB head, önceki sürüm, servis kilidi
pos-release deploy main            # ya da tam sha
```
Betik sırayla: sürümü hazırlar (canlıya dokunmaz) → bekleyen migration'ları etiketleriyle listeler → `breaking` varsa `--breaking-onay` ister → **yedek** (`pg-backup.service`, `Result=success` değilse DURUR) → migration (`migrator`, şifre `PGPASSWORD` ile, ekrana basılmaz) → web parçalarını havuza ekler → `current`'ı atomik çevirir → `pm2 restart pos-api` → smoke (§4'teki health · `/` · socket.io · token'sız 5 uç = 401 · pm2 kararlı) → başarılıysa eski sürümleri budar. Süreyi yazdırır.

- **Smoke başarısız + bu deploy'da migration YOK** → betik kendiliğinden önceki sürüme döner (S3).
- **Smoke başarısız + migration VAR** → durur, K5 kararını basar; karar insanda.
- **Acil düzeltme servis saatinde:** `--servis-icinde` (çıktıda uyarı). Agent-JWT yolu (`last_seen_at`) ve kâğıt smoke betiğin dışındadır — §4'teki sorgu aynen geçerli.

### 11.3 Geri alma

```bash
pos-release rollback               # önceki (son başarılı) sürüme
pos-release rollback <sürüm-adı>   # belirli sürüme; pos-release list ile bakılır
```
Servis saatinde de serbest. **K5 kuralı:** DB'nin migration head'i hedef sürümünkinden ilerideyse, aradaki her migration `-- rollback-compat: additive` olmalı; tek bir `breaking` (≤072 dosyaların tümü dahil) veya okunamayan DB → **REDDEDİLİR**. O durumda yol: düzeltip ileri deploy, ya da yedekten dönüş (veri kaybı — ürün sahibi kararı). Aynı kural eski bir sürümü `activate` etmeye ve eski bir commit'i `deploy` etmeye de uygulanır. Down dosyası olan `breaking`'ler için: **§11.8 `--sema-geri`** (ADR-049).

Hedef süre (K7): **≤ 2 dk** (geçiş + smoke); betik yazdırır, cutover tatbikatında ölçülür.

### 11.4 Nginx (cutover'da uygulanır; §6.1'in yeni yollu hâli)

```nginx
    root /srv/restoran-pos/current/apps/web/dist;

    location /assets/ {
        alias /srv/restoran-pos/shared/web-assets/;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location = /index.html {
        add_header Cache-Control "no-cache" always;
    }
```
`/assets/` artık **havuzdan** gelir: geçişten önce açılmış sekme ve geri alınan sürümün `index.html`'i eski parçalarını bulmaya devam eder (K4). `alias` ile `try_files` birlikte kullanılmaz (Nginx'in bilinen alias+try_files tuzağı); eşleşen `location /assets/` eksik dosyada zaten **404** döner — §6.1'in `=404` güvencesi korunur, §6.1'in üç `curl` doğrulaması aynen koşulur. `open_file_cache` prod'da **yok** (PR-0) → `current` değişimi Nginx'e anında yansır.

### 11.5 Sorun giderme

| Belirti | Anlamı / yapılacak |
|---|---|
| `Başka bir pos-release işlemi sürüyor` | `shared/.lock` tutuluyor; başka oturumda betik koşuyor mu bak |
| `pnpm sürümü uyuşmuyor` | betik pnpm'i sürümün içinden sorar (corepack → `packageManager`); uyuşmazlık corepack'in bozulduğunu gösterir |
| `Yedek başarısız` | `journalctl -u pg-backup.service -n 50`; yedek olmadan migration koşmaz, canlı etkilenmedi |
| `Geri dönüş REDDEDİLDİ` | listelenen migration'lardan biri `breaking`; §11.3 |
| `izinleri güvensiz` | `/root/pos-secrets.env` `root 600` olmalı |
| Derleme yarıda kaldı | yarım dizin `releases/.building-*` silinir; kalırsa 60 dk sonra `prune` temizler |

### 11.6 İlk geçiş (cutover) — restoran KAPALIYKEN, ~1 saat (ADR-047 K8)

Ön koşul: Claude oturumu prod'a yazabilecek kipte (otomatik kip prod yazmayı reddeder; kipi ürün sahibi değiştirir), 0 açık adisyon, dükkân PC'si açık (ajan kanıtı için). Gece seçimi ürün sahibinde (S5).

| # | Adım | Kabul kanıtı |
|---|---|---|
| 0 | `systemctl start pg-backup.service` | `Result=success` |
| 1 | `mkdir -p /srv/restoran-pos/{releases,shared/web-assets,bin}` · `cp /opt/restoran-pos/apps/web/.env.production /srv/restoran-pos/shared/web.env.production` (önce içeriği oku: yalnız `VITE_*` olmalı — security-reviewer notu) · betikleri bare repo'dan kur: `git --git-dir=/opt/git/restoran-pos.git show main:apps/api/scripts/deploy/pos-release.sh > /srv/restoran-pos/bin/pos-release && chmod 755 …` ve aynı yolla `run-api.sh` (`chmod 700`) · `ln -s /srv/restoran-pos/bin/pos-release /usr/local/bin/pos-release` | dosyalar yerinde, izinler |
| 2 | `pos-release build <prod'daki sha>` (kod değişikliği YOK) · `ln -s releases/<id> /srv/restoran-pos/current` (ilk işaretçi elle) · `echo "$(date -u +%FT%TZ) <id>" >> shared/history` | `RELEASE.json` `migration_head` = `pos-release status`'taki DB head |
| 3 | `cp -a -n /opt/restoran-pos/apps/web/dist/assets/. /srv/restoran-pos/shared/web-assets/` + `cp -a -n /srv/restoran-pos/current/apps/web/dist/assets/. …/web-assets/` | eski ve yeni `index.html`'in istediği her parça havuzda |
| 4 | `cp /etc/nginx/sites-available/restoranpos{,.bak.$(date +%Y%m%d)}` → §11.4 blokları → `nginx -t` → `systemctl reload nginx` | §6.1'in üç `curl`'ü (no-cache · immutable · 404) |
| 5 | `pm2 delete pos-api && pm2 start /srv/restoran-pos/bin/run-api.sh --name pos-api --time && pm2 save` | `pos-release status` · `readlink /proc/$(pm2 pid pos-api)/cwd` → yeni sürüm dizini · açılış log'unda `[api] Sürüm: <id>` · §4 smoke + ajan `last_seen_at` |
| 6 | `pg-backup.service` ve `auth-429-watch.service`'te `ExecStart` → `/srv/restoran-pos/current/apps/api/scripts/...` → `systemctl daemon-reload` → `systemctl start pg-backup.service` | `Result=success` + healthchecks.io ping (yol çevrilmezse **saatlik yedek sessizce durur**) |
| 7 | **Tatbikat:** migration'sız bir commit `pos-release deploy` → `pos-release rollback` → tekrar ileri · sonra `pos-release self-install <canlı-id>` | süreler ADR-047'ye; rollback ≤ 2 dk |
| 8 | Kâğıt smoke [USER]: Fiş Ayarları → "Deneme fişi bas" + bir mutfak fişi | kâğıt |

**Cutover'ın kendi geri alması** (4–6'nın herhangi birinde sorun): `.bak` Nginx dosyasını geri koy → `nginx -t` → reload → `pm2 delete pos-api && pm2 start /opt/restoran-pos/run-api.sh --name pos-api --time && pm2 save` → systemd `ExecStart`'larını `/opt/...`'a geri çevir → `daemon-reload`. `/opt/restoran-pos` cutover sonrası **30 gün dokunulmaz** (geri alma buna dayanır), sonra ayrı ve bilinçli bir adımla arşivlenir.

### 11.7 Cutover gecesi yapılacak doküman değişimi

§1 web kökü · §2 Kod/API süreci satırları (`/srv/restoran-pos`, `bin/run-api.sh`, `shared/web.env.production`) · §4 → yalnız §11.2'ye işaretçi · §6.1 → §11.4 bloğu · §10'daki "cutover'dan önce" paragrafı kaldırılır · bu bölümün "Durum" notu · `backup-strategy.md` `ExecStart` satırı · `bootstrap-prod.ts`/`seed-demo-tenant.ts` docblock yolları.

### 11.8 Şema geri alma — `pos-release rollback <sürüm> --sema-geri --onay` (ADR-049)

Ne zaman: bayraksız `rollback` *"aradaki migration'lardan en az biri 'breaking'"* diye reddetti ve betik *"Down dosyaları mevcut — … --sema-geri ile denenebilir"* ipucu verdi.

```bash
pos-release rollback <sürüm> --sema-geri            # 1) PLAN: neyi geri alacağını + "veri dönmez" uyarısını basar, hiçbir şey değiştirmez
pos-release rollback <sürüm> --sema-geri --onay     # 2) UYGULA: yedek → down'lar (yeniden eskiye) → K5 → kod geri → smoke
```

- **Bakım penceresi dışı (06:00–03:00):** kilit **geçerli** (bayraksız rollback'ten farklı — down DDL kilit alır). Servis içinde yalnız ürün sahibinin açık onayıyla `--servis-icinde` (ADR-049 S1).
- **Reddettiği durumlar:** `breaking` migration'ın down dosyası yok (ya da `-- down: yok` ile bilerek bırakılmış) · bir `breaking`'den **sonra** `additive` uygulanmış (sıra bozulur) · DB okunamıyor · hedef sürümün uygulanmamış migration'ı var. Yol: düzeltip ileri deploy; veri kaybı varsa `backup-strategy.md` §7/§7.1.
- **Down yarıda düşerse:** önceki down'lar tamamlanmıştır; betik DB head'ini yazar ve kodu değiştirmez → **canlı kod kısmen geri alınmış şemada çalışıyor**. Sebebi gider, **aynı komutu tekrar** çalıştır (plan DB'den yeniden hesaplanır, kaldığı yerden sürer).
- **Silinmiş veri:** down yapıyı geri getirir, **veriyi getirmez** → `backup-strategy.md` §7.1 (yalnız o sütun, deploy yedeğinden; tatbikatta 500 bin satır 12 sn).
- Down'lar `postgres` superuser olarak yerel soket + peer ile koşar (parola yok), CI'da sınanan `applyDown` ile: tek transaction, `lock_timeout` 5 sn, `statement_timeout` 120 sn, yalnız en yeni kayıt. **`node-pg-migrate down` ve psql'de elle down ASLA** (§9).
- ⚠️ **Sunucudaki betiği güncel tut:** `--sema-geri` `bin/pos-release`'in 2026-11-25 sürümüyle geldi. Kurulu kopya eskiyse bir sonraki deploy'dan sonra `pos-release self-install <canlı-sürüm>` (kesintisiz). 03:00–06:00 penceresi (ADR-050 PR-4) de aynı yolla gelir — self-install'dan önce kurulu betik hâlâ eski 10:00–24:00 kilidini uygular; `pos-release status`'taki "Servis saati" satırıyla teyit et.

**Down dosyası olan migration'lar** (ADR-049 K3 — her yeni down dosyası buraya bir satır ekler):

| Migration | Neyi geri alır | Neyi geri ALMAZ (veri) | Parça geri yükleme | CI gidiş-dönüş süresi |
|---|---|---|---|---|
| — (henüz yok, 2026-11-25) | | | | |

### 11.9 Düzgün kapanış + PM2 `kill_timeout` (ADR-050 K3)

API `SIGINT`/`SIGTERM` alınca (PM2 varsayılanı `SIGINT`): cron'ları durdurur → yeni bağlantı almaz, socket.io istemcilerini koparır (hemen yeniden bağlanırlar) → yarıdaki istekleri **en çok 5 sn** bekler → kalanları (ör. yazıcı ajanının 25 sn'lik uzun-poll'u) kapatır, ajan kendiliğinden yeniden bağlanır → DB havuzlarını kapatır → çıkar. Log: `[api] Kapanış başladı` … `[api] Kapanış tamam {ms, forced}`.

⚠️ **PM2'nin varsayılan `kill_timeout`'u 1,6 sn** — 5 sn'lik drenajı keser. Süreç bir kez, **bakım penceresinde** (ADR-050 S1: 03:00–06:00) yeniden tanımlanır:

```bash
pm2 delete pos-api && pm2 start /srv/restoran-pos/bin/run-api.sh --name pos-api --time --kill-timeout 8000 && pm2 save
pm2 describe pos-api | grep -i 'kill'      # kill_timeout 8000
```

Kabul kanıtı (o gece): `pm2 restart pos-api` → `pos-api-out.log`'da `Kapanış başladı` ve `Kapanış tamam` satırları (sinyalin `run-api.sh` → `exec tsx` → node zincirinden geçtiğinin kanıtı); ardından §4 smoke + ajan `last_seen_at`.

## 12. Sır (anahtar/parola) rotasyonu (ADR-050 K4/K5)

> **Ne zaman:** her yıl **Ocak'ın ilk Pazartesi gecesi**, hepsi **tek gecede toplu** (S3) · bir sırrın sızdığından şüphelenilirse **o sır, pencere beklenmeden** (§12.7).
> **Ön koşul:** bakım penceresi 03:00–06:00 TR (S1) · 0 açık adisyon · Claude oturumu **otomatik kipte değil** (prod'a yazar; kipi ürün sahibi değiştirir) · §11.9'daki `kill_timeout 8000` tanımlı (yoksa restart drenajı keser).

### 12.1 Kurallar (K5)

1. Yeni değer **sunucuda** `openssl rand` ile üretilir ve **hiçbir ekrana basılmaz.** Sohbet, pano ya da RustDesk ile **asla yapıştırılmaz** (ADR-044 dersi: yapıştırma karakter bozar, sır geçmişte kalır). Sunucu dışına çıkması gereken tek sır (`BRIDGE_TOKEN`) **dosya** olarak taşınır (§12.5).
2. Sıra her zaman: **`.bak` → değişim → tek restart → §12.4 doğrulama**. Doğrulama geçmezse §12.6 ile `.bak`'a dön.
3. Bir sır değişince **iki dosya birlikte** güncellenir: `/etc/restoran-pos/api.env` (API'nin gerçekten okuduğu) ve `/root/pos-secrets.env` (kayıt). Biri unutulursa bir sonraki rotasyon ya da migrator adımı eski değerle çalışır.
4. Değerler komut satırına (`argv`) konmaz — `ps` çıktısında görünür. Aşağıdaki yardımcılar değeri ortam değişkeninden ve stdin'den taşır.
5. Bitince §12.8 tablosu güncellenir.

### 12.2 Envanter

`pos-secrets.env` satırları 2026-11-25'te sunucudan **yalnız adlarıyla** okundu (§3 awk komutu).

| Sır | Düzey | Nerede | Sıklık | Değişince kim etkilenir | Reçete |
|---|---|---|---|---|---|
| `JWT_ACCESS_SECRET` | Platform | `api.env` + `pos-secrets.env` | Yılda 1 + şüphede | Açık 30 dk'lık giriş jetonları geçersiz → web/mobil 401'de **sessizce** yeniler, **kimse çıkış yapmaz** (yenileme jetonu bu sırla imzalı değil, DB'de duran rastgele değer). *Doğrulanmamış:* canlı yayın (socket.io) bağlantısının jetonu yenileyip yeniden bağlandığı → ilk tatbikatta ölçülür | §12.3 B |
| `JWT_AGENT_SECRET` | Platform | aynı | Yılda 1 + şüphede | Yazıcı ajanlarının iki jetonu da geçersiz → ajanlar kayıt anahtarıyla **kendiliğinden yeniden kaydolur**. ✅ Yerel tatbikat (ADR-050 PR-3, 2026-11-25, §12.9): **aynı `agents` satırı** korunur (eşleşme `id`'ye bağlı), ajan restart'tan ≈ 14 sn sonra kendiliğinden döner. Ön koşul: kayıt anahtarı geçerli olmalı (§12.3 B kapısı) | §12.3 B |
| `PG_APP_PASSWORD` | Platform | `pos-secrets.env` + `api.env` `DATABASE_URL` içinde | Yılda 1 | Yok (değişim + restart aynı dakikada) | §12.3 A |
| `PG_CRON_PURGER_PASSWORD` | Platform | `pos-secrets.env` + `api.env` `CRON_DATABASE_URL` içinde | Yılda 1 | Yok. Yanlışsa **API açılmaz** (açılışta doğrulanır) — hata hemen görünür | §12.3 A |
| `PG_MIGRATOR_PASSWORD` | Platform | yalnız `pos-secrets.env` | Yılda 1 | Yok (yalnız migration anında kullanılır) | §12.3 A (eski tek başına reçete: §7) |
| `BRIDGE_TOKEN` | Platform değeri, **fiziksel olarak dükkân PC'sinde de** | `api.env` + `pos-secrets.env` + caller-bridge `appsettings.json` | Yılda 1 (dükkâna uzaktan bağlanılan gece) + şüphede | Sunucu değiştiği andan köprü güncellenene dek **Caller ID açılır penceresi çalışmaz** | §12.5 |
| Ajan kayıt anahtarı (`pk2_`) | **Müşteri (tenant)** | DB (hash) + ajan PC'si servis ortamı | Şüphede / cihaz el değiştirince — yıllık toplu geceye **dahil değil** | O müşterinin ajanları | §10.4 Dalga D yordamı (`rotate-agent-key.ts`) |
| `PRINT_AGENT_API_KEY` | Müşteri (tek, eski) | yalnız `pos-secrets.env` | **Döndürülmez** | — | ADR-044 öncesi eski `pk_` anahtarının kaydı. Ajanlar 2026-11-17'den beri `pk2_` kullanıyor; eski dal kodda durdukça bu değer geçerlidir (§10.4 son not). Eski dal kaldırılınca satır silinir |
| `age` özel anahtarı | Platform | **sunucu DIŞI** (kasa + çevrimdışı kopya) | **Periyodik değil**, yalnız sızıntıda | Eski yedekler eski anahtarla açılır | `backup-strategy.md` §5.1 |
| Storage Box SSH anahtarları (**iki**) | Platform | yedek işi: `/var/lib/postgresql/.ssh/storagebox` (postgres kullanıcısının rclone'u) · elle işlemler: `/root/.ssh/storagebox` | Yılda 1 + şüphede | Bir sonraki saatlik yedek | `backup-strategy.md` §5.2 |
| `HEALTHCHECK_URL` | Platform | `/etc/restoran-pos/backup.env` | Şüphede | Sızarsa biri sahte "yedek başarılı" sinyali gönderip yedek alarmını susturabilir | healthchecks.io'da check'in ping URL'ini yenile → `backup.env` → `systemctl start pg-backup.service` ile ping teyidi |
| `SENTRY_DSN` / `VITE_SENTRY_DSN` | Platform | `api.env` / `shared/web.env.production` | **Sır sayılmaz** (web DSN'i zaten tarayıcı paketinde) — yalnız kötüye kullanımda | Yok | Sentry'de DSN'i yenile → env + `pm2 restart` / web için bir sonraki deploy |
| SSH anahtarları, Hetzner/GitHub/Expo/Apple/Google/Sentry/healthchecks hesapları | Platform | ürün sahibinde | Yılda 1 **gözden geçirme** | — | §12.3 D |
| TLS sertifikası | Platform | certbot | Otomatik | — | §12.3 D (yalnız kontrol) |

ℹ️ `BRIDGE_TOKEN` **tüm müşterilerde tek değer** (ADR-050 K6): bir müşterideki sızıntı herkesi etkiler, tek müşteri için döndürülemez. İkinci müşteri Caller ID kurmadan önce ayrı ADR gerekir — bu bölüm yalnız bugünkü tek-müşteri hâlini anlatır.

### 12.3 Yıllık gece — sırayla

**Hazırlık (tek kabuk oturumunda, sonuna kadar aynı oturum):**

```bash
umask 077
TS=$(date +%Y%m%d-%H%M%S)
cp -p /root/pos-secrets.env        /root/pos-secrets.env.bak-$TS
cp -p /etc/restoran-pos/api.env    /etc/restoran-pos/api.env.bak-$TS
systemctl start pg-backup.service && systemctl show pg-backup.service -p Result   # Result=success

# ANAHTAR=değer satırını $NEW ile değiştirir. Değer argv'de görünmez, ekrana basılmaz.
set_secret() {   # set_secret <dosya> <ANAHTAR>
  grep -q "^$2=" "$1" || { echo "YOK: $2 ($1)"; return 1; }
  NEW="$NEW" K="$2" awk 'index($0, ENVIRON["K"]"=")==1 {print ENVIRON["K"]"="ENVIRON["NEW"]; next} {print}' "$1" > "$1.tmp" && mv "$1.tmp" "$1"
}
# postgresql://<rol>:<parola>@... içindeki parolayı $NEW ile değiştirir.
set_url_pw() {   # set_url_pw <dosya> <ANAHTAR> <rol>
  grep -q "^$2=postgresql://$3:" "$1" || { echo "YOK: $2/$3 ($1)"; return 1; }
  NEW="$NEW" K="$2" R="$3" awk 'index($0, ENVIRON["K"]"=")==1 {p=index($0,"@"); print ENVIRON["K"]"=postgresql://"ENVIRON["R"]":"ENVIRON["NEW"] substr($0,p); next} {print}' "$1" > "$1.tmp" && mv "$1.tmp" "$1"
}
# DB rol parolası — SQL stdin'den gider (printf kabuk iç komutu, argv'de görünmez).
set_role_pw() {  # set_role_pw <rol>
  printf "ALTER ROLE %s PASSWORD '%s';\n" "$1" "$NEW" | sudo -u postgres psql -d pos_prod -v ON_ERROR_STOP=1 -q
}
```

**Ön kontrol — biri bile geçmezse rotasyona BAŞLAMA** (yarım rotasyon, hiçbir dosyada kaydı olmayan bir DB parolası bırakabilir; `.bak` da ancak gerçek durumu yansıtıyorsa geri dönüş yoludur):

```bash
# 1) Döndürülecek her anahtar iki dosyada da var mı
for k in JWT_ACCESS_SECRET JWT_AGENT_SECRET BRIDGE_TOKEN; do
  grep -q "^$k=" /root/pos-secrets.env && grep -q "^$k=" /etc/restoran-pos/api.env || echo "YOK: $k"; done
for k in PG_APP_PASSWORD PG_CRON_PURGER_PASSWORD PG_MIGRATOR_PASSWORD; do grep -q "^$k=" /root/pos-secrets.env || echo "YOK: $k"; done
grep -q '^DATABASE_URL=postgresql://app_tenant:' /etc/restoran-pos/api.env || echo "YOK: DATABASE_URL"
grep -q '^CRON_DATABASE_URL=postgresql://cron_purger:' /etc/restoran-pos/api.env || echo "YOK: CRON_DATABASE_URL"

# 2) Kayıt (pos-secrets) ile çalışan değer (api.env) AYNI mı — değer basılmaz, yalnız sonuç
( set -a; . /root/pos-secrets.env; S_APP=$PG_APP_PASSWORD; S_CRON=$PG_CRON_PURGER_PASSWORD; S_JA=$JWT_ACCESS_SECRET; S_JG=$JWT_AGENT_SECRET; S_BT=$BRIDGE_TOKEN
  . /etc/restoran-pos/api.env
  [ "$DATABASE_URL" = "postgresql://app_tenant:${S_APP}@${DATABASE_URL#*@}" ] && echo "app: AYNI" || echo "app: FARKLI"
  [ "$CRON_DATABASE_URL" = "postgresql://cron_purger:${S_CRON}@${CRON_DATABASE_URL#*@}" ] && echo "cron: AYNI" || echo "cron: FARKLI"
  for p in "JWT_ACCESS:$S_JA:$JWT_ACCESS_SECRET" "JWT_AGENT:$S_JG:$JWT_AGENT_SECRET" "BRIDGE:$S_BT:$BRIDGE_TOKEN"; do
    IFS=: read -r n a b <<<"$p"; [ "$a" = "$b" ] && echo "$n: AYNI" || echo "$n: FARKLI"; done )

# 3) Üç rol pos-secrets'taki parolayla bağlanabiliyor mu (§7 elle rotasyonu kayda geçmemiş olabilir)
( set -a; . /root/pos-secrets.env
  PGPASSWORD="$PG_APP_PASSWORD"         psql -h 127.0.0.1 -U app_tenant  -d pos_prod -Atc 'select 1'
  PGPASSWORD="$PG_CRON_PURGER_PASSWORD" psql -h 127.0.0.1 -U cron_purger -d pos_prod -Atc 'select 1'
  PGPASSWORD="$PG_MIGRATOR_PASSWORD"    psql -h 127.0.0.1 -U migrator    -d pos_prod -Atc 'select 1' )   # üç kez 1

# 4) Önceki durumun fotoğrafı (§12.4 karşılaştırır)
sudo -u postgres psql -d pos_prod -At -c "SELECT id FROM agents WHERE revoked_at IS NULL ORDER BY id" > /root/agents-before-$TS.txt
pm2 jlist | python3 -c 'import sys,json; print([p["pm2_env"]["restart_time"] for p in json.load(sys.stdin) if p["name"]=="pos-api"][0])'   # restart sayısı — not al
stat -c '%a %U %n' /root/pos-secrets.env /etc/restoran-pos/api.env   # 600 root
```

Hepsi "AYNI", üç kez `1`, "YOK" satırı yok → devam. "FARKLI" varsa önce hangisinin gerçek olduğu bulunup kayıt düzeltilir; o gece rotasyon yapılmaz.

2026-11-25 (salt-okur prova, 1–3. adımlar): "YOK" yok · beş karşılaştırmanın beşi **AYNI** · üç rol kayıttaki parolayla bağlandı (`1`). Kayıt bugün gerçek durumla tutarlı.

⚠️ Prod'da `log_statement=none`, `log_min_duration_statement=-1`, `pg_stat_statements` **kurulu değil** (2026-11-25 okundu) → başarılı `ALTER ROLE` hiçbir yere yazılmaz. Ama `log_min_error_statement=error`: **komut hata verirse** parolayı içeren satır PostgreSQL log'una düşer. O değer zaten uygulanmamıştır — **kullanma, yeniden üret.** Bu üç ayar ileride değişirse bu not yeniden ölçülür.

🔴 **Zincir kuralı:** aşağıdaki her satır `&&` ile bağlı. Bir satır `YOK` ya da hata verirse **sonraki satıra GEÇME** — `NEW` bir sonraki atamada ezilir ve DB'de hiçbir dosyada kaydı olmayan parola kalır. Doğrudan **§12.6** geri dönüşe git.

**A — Veritabanı parolaları** (her biri: üret → rol → iki dosya):

```bash
NEW=$(openssl rand -hex 24); set_role_pw app_tenant \
  && set_secret /root/pos-secrets.env PG_APP_PASSWORD \
  && set_url_pw /etc/restoran-pos/api.env DATABASE_URL app_tenant

NEW=$(openssl rand -hex 24); set_role_pw cron_purger \
  && set_secret /root/pos-secrets.env PG_CRON_PURGER_PASSWORD \
  && set_url_pw /etc/restoran-pos/api.env CRON_DATABASE_URL cron_purger

NEW=$(openssl rand -hex 24); set_role_pw migrator \
  && set_secret /root/pos-secrets.env PG_MIGRATOR_PASSWORD
```

ℹ️ `ALTER ROLE` açık bağlantıları koparmaz; çalışan API restart'a kadar eski bağlantılarla sürer. Bu yüzden A ile restart **aynı dakikada** olmalı.

**B — JWT sırları:**

```bash
NEW=$(openssl rand -hex 48); set_secret /root/pos-secrets.env JWT_ACCESS_SECRET \
  && set_secret /etc/restoran-pos/api.env JWT_ACCESS_SECRET; unset NEW
```

**`JWT_AGENT_SECRET` — kapı (PR-3 yerel tatbikatıyla açıldı, §12.9):** ajanlar yeni sırla ancak **kayıt anahtarı hâlâ geçerliyse** geri dönebilir. Önce bak — canlı tenant'ın en az bir anahtarı `geçerli` değilse **KOŞMA** (önce §10.4 ile yeni anahtar):

```bash
sudo -u postgres psql -d pos_prod -At -c "SELECT left(id::text,8), coalesce(valid_until::text,'süresiz'),
  CASE WHEN revoked_at IS NULL AND (valid_until IS NULL OR valid_until > now() + interval '1 hour') THEN 'geçerli' ELSE 'GEÇERSİZ' END
  FROM agent_registration_keys ORDER BY created_at"      # 2026-11-25: df6c2e0a (canlı) süresiz, geçerli

NEW=$(openssl rand -hex 48); set_secret /root/pos-secrets.env JWT_AGENT_SECRET \
  && set_secret /etc/restoran-pos/api.env JWT_AGENT_SECRET; unset NEW
```

Beklenen (C'deki restart'tan sonra): her ajan önce birkaç `fetch hatası` (restart anı), sonra `401 alındı` → `refresh failed HTTP 401, re-registering` → normal sorgu. §12.4/3'teki id karşılaştırması **aynı** çıkmalı.

**C — Tek restart, sonra §12.4:**

```bash
diff <(cut -d= -f1 /etc/restoran-pos/api.env.bak-$TS) <(cut -d= -f1 /etc/restoran-pos/api.env) && echo "api.env anahtar adları aynı"
diff <(cut -d= -f1 /root/pos-secrets.env.bak-$TS)     <(cut -d= -f1 /root/pos-secrets.env)     && echo "pos-secrets anahtar adları aynı"
pm2 restart pos-api --time       # env run-api.sh içinde yeniden okunur; --update-env gerekmez
```

**D — Gözden geçirme (değer üretilmez):**

```bash
cat /root/.ssh/authorized_keys | awk '{print $NF}'   # yalnız tanınan anahtar adları (2026-11-25: 1 satır)
systemctl list-timers --all | grep certbot           # certbot.timer var ve yakın bir "NEXT" gösteriyor
certbot certificates | grep -E 'Expiry|Domains'
```
Hesaplar (Hetzner, GitHub, Expo, Apple, Google Play, Sentry, healthchecks.io, Namecheap): **2FA açık mı**, tanımadığın oturum/anahtar/erişim jetonu var mı — ürün sahibi kendi tarayıcısından bakar.

**E — Storage Box anahtarı:** `backup-strategy.md` §5.2. **F — `BRIDGE_TOKEN`:** §12.5 (dükkân PC'si açıkken).

### 12.4 Doğrulama (her rotasyondan sonra)

1. API **kararlı**: ön kontroldeki `pm2 jlist` satırıyla restart sayısını **~30 sn arayla iki kez** oku → ikisi de "önceki + 1" olmalı, artmaya devam etmemeli. (`CRON_DATABASE_URL` ya da DB parolası yanlışsa süreç önce dinlemeye başlar, açılış kontrolünde `process.exit(1)` ile çıkar → PM2'de **yeniden başlama döngüsü**; `pm2 ls` o an `online` gösterebilir, tek bakış yetmez.) · `grep '"level":50' /root/.pm2/logs/pos-api-out.log | tail` → **yeni satır yok**.
2. §4 smoke: health · `/` · socket.io · token'sız 5 uç **401** (500 yok).
3. Ajanlar: §4 `last_seen_at` sorgusu → üç ajan **≤ 1 dk** içinde taze. **Aynı satırlar** mı: `sudo -u postgres psql -d pos_prod -At -c "SELECT id FROM agents WHERE revoked_at IS NULL ORDER BY id" | diff /root/agents-before-$TS.txt - && echo "ajan id'leri aynı"` (yalnız sayıya bakmak, yeniden kaydın yeni satır açıp eskisini iptal etmesini göremez).
4. Kullanıcı: önceden giriş yapılmış bir web sekmesi ve garson telefonu **çıkış yapmadan** çalışmaya devam ediyor; masa ekranında canlı güncelleme geliyor.
5. Migrator (A'da döndüyse): `( set -a; . /root/pos-secrets.env; PGPASSWORD="$PG_MIGRATOR_PASSWORD" psql -h 127.0.0.1 -U migrator -d pos_prod -Atc 'select 1' )` → `1`.
6. Kâğıt: bir mutfak fişi (yazıcı yolu uçtan uca).

7. İzinler: `stat -c '%a %U %n' /root/pos-secrets.env /etc/restoran-pos/api.env` → yine `600 root` (`mv` izni `.tmp`'den alır; `umask 077` sayesinde aynı kalmalı).

Hepsi geçince `.bak-$TS` ve `agents-before-$TS.txt` dosyaları **ertesi gün** `shred -u` ile silinir (`.bak`'larda artık geçersiz ama eski sırlar var).

### 12.5 `BRIDGE_TOKEN` (dükkân PC'si — RustDesk dosya aktarma)

Kesinti penceresini kısa tutmak için sıra: **önce dosyayı taşı, sonra sunucu değişimi ve köprü güncellemesi art arda.**

```bash
# 1) Sunucuda — yalnız üret (henüz hiçbir yer değişmedi)
umask 077; openssl rand -hex 32 > /root/bridge-token.txt
```

2) `scp` ile dizüstüne → **RustDesk dosya aktarma** ile dükkân PC'sinde **yönetici kullanıcının profil klasörüne** (`$env:USERPROFILE`; `C:\Temp` gibi kökten izin alan klasör **değil** — orayı `Users` grubu okuyabilir). Aşağıdaki PowerShell de **`.ps1` dosyası olarak** aynı yolla taşınır; RustDesk konsoluna **yapıştırılmaz** (ADR-044 dersi: karakter bozar).

```bash
# 3) Sunucuda — değiştir + restart (bu andan köprü güncellenene dek Caller ID çalışmaz)
NEW=$(cat /root/bridge-token.txt); set_secret /root/pos-secrets.env BRIDGE_TOKEN \
  && set_secret /etc/restoran-pos/api.env BRIDGE_TOKEN; unset NEW
pm2 restart pos-api --time
```

4) Hemen ardından dükkân PC'sinde **yönetici PowerShell** ile `.ps1`:

```powershell
$tokFile = Join-Path $env:USERPROFILE 'bridge-token.txt'
$svc = Get-CimInstance Win32_Service -Filter "Name='restoran-pos-caller-bridge'"
$cfg = Join-Path (Split-Path $svc.PathName.Trim('"')) 'appsettings.json'
Copy-Item $cfg "$cfg.bak-$(Get-Date -f yyyyMMdd-HHmmss)"
$tok = (Get-Content -Raw $tokFile).Trim()
if ($tok -notmatch '^[0-9a-f]{64}$') { throw 'Anahtar biçimi hatalı' }
$j = Get-Content -Raw $cfg | ConvertFrom-Json
$j.Bridge.BridgeToken = $tok
$j | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $cfg
Restart-Service restoran-pos-caller-bridge
Remove-Item $tokFile
```

*Doğrulanmamış:* servis adı ve `PathName`'in tırnaklı tek yol olduğu (README'deki ad `restoran-pos-caller-bridge`) — ilk koşumda `$svc.PathName` önce **okunur**. `Remove-Item` güvenli silme değildir; dosya profil klasöründe ve sır zaten yalnız bu PC'de kullanıldığı için kabul. Kanıt: bir test araması → açılır pencere görünür; API log'unda `/bridge/caller-id/incoming` için 401 yok. Bitince sunucuda `shred -u /root/bridge-token.txt` ve dizüstündeki kopya silinir.

### 12.6 Geri dönüş

Doğrulama geçmezse (aynı kabuk oturumunda, `$TS` duruyor):

```bash
( set -a; . /root/pos-secrets.env.bak-$TS; set +a
  printf "ALTER ROLE app_tenant PASSWORD '%s';\nALTER ROLE cron_purger PASSWORD '%s';\nALTER ROLE migrator PASSWORD '%s';\n" \
    "$PG_APP_PASSWORD" "$PG_CRON_PURGER_PASSWORD" "$PG_MIGRATOR_PASSWORD" \
  | sudo -u postgres psql -d pos_prod -v ON_ERROR_STOP=1 -q )
cp -p /root/pos-secrets.env.bak-$TS     /root/pos-secrets.env
cp -p /etc/restoran-pos/api.env.bak-$TS /etc/restoran-pos/api.env
pm2 restart pos-api --time
```

Sonra §12.4 yeniden. JWT dönüşü kimseyi çıkarmaz (aynı sessiz yenileme). `BRIDGE_TOKEN` döndüyse köprüde de `appsettings.json.bak-*` geri konur.

### 12.7 Sızıntı şüphesinde

İlgili sır **pencere beklenmeden** döndürülür — servis saatindeyse **ürün sahibinin açık onayıyla** (ADR-049 S1 emsali). Yalnız o sırrın satırı koşulur (hazırlık + ilgili A/B/§12.5 satırı + C + §12.4). Olay `docs/ops/` altında tarih, şüphe kaynağı, döndürülen sır ve doğrulama sonucuyla kayda geçer. Ajan kayıt anahtarı için `--grace-days 0` (§10.4).

⚠️ **`JWT_AGENT_SECRET` servis saatinde döndürülürse:** her ajan ≈ 15 sn yazdıramaz (§12.9). Kâğıt yedeği (ADR-031 K10) hazır olsun; §12.4/3 ajan id karşılaştırması → ajan dönmediyse ilgili servisi yeniden başlat; o da yetmezse §10.4 Dalga D yordamıyla yeni kayıt anahtarı ver.

### 12.8 Son rotasyon kaydı

| Sır | Son rotasyon | Not |
|---|---|---|
| `JWT_ACCESS_SECRET` | *Doğrulanmamış* — ilk kurulumdan (2026-07-04) beri değişmediği varsayılıyor | |
| `JWT_AGENT_SECRET` | *Doğrulanmamış* — aynı | ✅ PR-3 yerel tatbikat 2026-11-25: ajan aynı satırla döndü (§12.9); prod ölçümü ilk rotasyon gecesinde |
| `PG_APP_PASSWORD` | *Doğrulanmamış* — aynı | |
| `PG_CRON_PURGER_PASSWORD` | *Doğrulanmamış* — §6.1.1 aktivasyonundan beri | |
| `PG_MIGRATOR_PASSWORD` | *Doğrulanmamış* — §7 elle rotasyonu kayda geçmemiş | |
| `BRIDGE_TOKEN` | *Doğrulanmamış* — ilk kurulumdan beri | |
| Ajan kayıt anahtarı (`pk2_`, canlı tenant) | **2026-11-17** (ADR-044 Dalga D) | |
| Storage Box SSH anahtarı | *Doğrulanmamış* — kurulumdan (2026-08-11) beri | |
| Hesap / SSH gözden geçirmesi | — | |

**Sıradaki toplu gece:** Ocak 2027'nin ilk Pazartesi gecesi (takvim hatırlatması 4 Ocak 2027).

### 12.9 Tatbikat kaydı — `JWT_AGENT_SECRET` (ADR-050 PR-3, yerel, 2026-11-25)

**Soru:** ajan sırrı değişince yazıcı ajanları kendiliğinden dönüyor mu, ve **aynı `agents` satırıyla** mı (yazıcı hedeflemesi `print_jobs.target_agent_id` → `agents.id`'ye bağlı; yeni satır = eşleşme kaybı)?

**Düzen:** yerel `pos_dev`'in kopyası `pos_drill` (bekleyen işler silinmiş — ajan eski deneme fişlerini almasın) · API `:3101` · ajan v0.0.5 kaynaktan, `pk2_` anahtarı (`rotate-agent-key.ts`), parmak izi `drill-ops12-pr3`, yazıcı `127.0.0.1:9` (basılacak gerçek yazıcı yok), uzun-poll 5 sn.

| Adım | Sonuç |
|---|---|
| Sır A ile kayıt | `register OK`, `204` döngüsü |
| API kapat → sır **B** ile aç (1. rotasyon) | ajan: 3× `fetch hatası` (1/3/9 sn geri çekilme) → `401` → `refresh failed HTTP 401, re-registering` → `204` döngüsü |
| B → A (2. rotasyon, saatli ölçüm) | API ayakta +7,9 sn · yeniden kayıt +13,9 sn · ilk boş-kuyruk yanıtı +18,9 sn (5 sn'lik uzun-poll beklemesi dahil) — süreler kill anından |
| `agents` tablosu (önce / 1. sonra / 2. sonra) | **birebir aynı**: id, parmak izi, `registration_key_id`, `revoked_at`; satır sayısı 4 → 4 |

**Koddan teyit** (`apps/api/src/routes/print-jobs.ts` register): aynı tenant + aynı parmak izi → mevcut satır yeniden kullanılır (yalnız `agent_version` ve v2'de `registration_key_id` tazelenir); prod'daki üç ajanın parmak izi servis ortamında sabit verildiği için aynı yol işler.

**Sonuç:** kapı açıldı (§12.3 B). Prod'daki gerçek süre: restart ≈ 7 sn + ajanın geri çekilme adımı (en kötü ≈ 9 sn) → yazıcı başına ≈ 15 sn kesinti, gece penceresinde. **Ön koşul:** kayıt anahtarı geçerli — 2026-11-25'te canlı anahtar `df6c2e0a` süresiz. Prod ölçümü ilk gerçek rotasyon gecesinde §12.8'e yazılır.

**Yan bulgu (tatbikat sırasında):** dizüstündeki eski ajan yapılandırması (`%PROGRAMDATA%\restoran-pos\print-agent.json`, yazıcı `192.168.1.100:9100`) `PRINT_AGENT_CONFIG_PATH` verilmezse **env'deki yazıcıyı ezer**. İlk denemede ajan `pos_dev`'deki haziran tarihli 2 deneme fişini aldı; o adreste yazıcı olmadığı için `TCP timeout` → hiçbir şey basılmadı, iki iş `failed` oldu. Ders: yerel ajan denemesi **ayrı DB + açık `PRINT_AGENT_CONFIG_PATH`** ile yapılır.
