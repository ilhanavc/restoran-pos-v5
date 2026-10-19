# Deploy Runbook — Restoran POS v5 (Prod)

> Kaynak kararlar: **ADR-031** (K1 topoloji · K2 domain/SSL · K3 deploy modeli) + ADR-001 §7 (migrator kontratları) + ADR-023 (yedekleme — ayrı runbook: `backup-strategy.md`).
> İlk kurulum **Session 81'de (2026-07-04)** uygulandı ve doğrulandı; bu doküman as-built kayıttır.
> Deploy modeli: **manuel** (ADR-031 K3). CI/CD otomasyonu pilot stabilize olunca ayrı iş (v5.1).

## 1. Mimari özet

- **Tek sunucu** (ADR-031 K1): Hetzner Cloud **CX23** (2 vCPU / 4 GB / 40 GB), Falkenstein/Almanya (KVKK), ~$7/ay. API + PostgreSQL 17 + Nginx aynı box; PM2 **tek instance** (cluster YOK — ADR-010 §5).
- **Domain** (K2): `restoranpos.org` (Namecheap; A kayıtları `@` + `www` → sunucu IP). **Path-based routing** — ayrı `api.` subdomain YOK:
  - `/` → web statik (`/opt/restoran-pos/apps/web/dist`, SPA fallback)
  - `/api/` → `127.0.0.1:3001/` (**prefix STRIP** — API route'ları root-mount, health = `/health`)
  - `/socket.io/` → `127.0.0.1:3001/socket.io/` (WebSocket upgrade başlıkları zorunlu)
- **SSL:** Let's Encrypt (certbot --nginx), otomatik yenileme timer'ı aktif, HTTP→HTTPS redirect.
- **Web build'e env GEREKMEZ:** `VITE_API_BASE_URL` default `/api`, `VITE_SOCKET_URL` default `''` (same-origin) — `apps/web/src/lib/env.ts`.

## 2. Prod envanteri (as-built)

| Öğe | Değer |
|---|---|
| Sunucu | `restoran-pos-prod` · IP `167.233.78.127` · Ubuntu 24.04 LTS · Hetzner projesi `restoran-pos` |
| SSH | `ssh -i ~/.ssh/restoran_pos_ed25519 root@167.233.78.127` (yalnız anahtar; parola girişine güvenme) |
| Kod | `/opt/restoran-pos` (çalışma kopyası) ← `/opt/git/restoran-pos.git` (bare; lokal `prod` remote'u buraya push'lar) |
| API süreci | PM2 `pos-api` → `/opt/restoran-pos/run-api.sh` (env source + `tsx src/index.ts`; API'de dist build YOK, `build`=typecheck) |
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

Migration için ayrıca: `MIGRATOR_DATABASE_URL` = `postgresql://migrator:<PG_MIGRATOR_PASSWORD>@127.0.0.1:5432/pos_prod` (kalıcı env'e yazılmaz; deploy anında `/root/pos-secrets.env`'den türetilir).

⚠️ **Secrets dosyası tuzağı:** dosya üretimi `if [ ! -f ]` guard'lıysa eski/yarım dosya korunur → değişkenler boş gider. Kullanmadan önce doğrula:
`awk -F= '{print NR": "$1" len="length($2)}' /root/pos-secrets.env` (5 satır, len>0 olmalı).

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

Migration'lı deploy notları: forward-only (ADR-003 — down yok); `pgmigrations`'tan DELETE migrator'a kapalı; **enum migration'larında incremental senaryo lokalde test edilmiş olmalı** (fresh CI yeşili yanıltıcı — bkz. Migration 042 dersi); **canlı-veri index migration'ları off-hours (restoran kapalı) + db-migration-guard MANUEL onayıyla koşulur — ADR-031 K12 Amendment 2026-07-13**. (K12'nin CI-regex CONCURRENTLY gate'i, node-pg-migrate `.sql`'de CONCURRENTLY imkânsız olduğundan — singleTransaction default — TS-migration altyapısı inene dek ERTELENDİ; düz `CREATE INDEX IF NOT EXISTS` + saniye-altı lock geçerli mekanizmadır. Emsal: Migration 041/042/047.)

## 5. İlk kurulum kaydı (fresh provisioning — tekrarlanabilir)

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

```bash
NEW_PW=$(openssl rand -hex 24)
sudo -u postgres psql -d pos_prod -c "ALTER ROLE migrator PASSWORD '${NEW_PW}';"
sed -i "s/^PG_MIGRATOR_PASSWORD=.*/PG_MIGRATOR_PASSWORD=${NEW_PW}/" /root/pos-secrets.env
```

(`app_tenant` parolası ayrı — değişirse `/etc/restoran-pos/api.env` `DATABASE_URL` da güncellenir + `pm2 restart pos-api`.)

## 8. SSL yenileme

Certbot systemd timer'ı otomatik yeniler (`systemctl list-timers | grep certbot`). Manuel test: `certbot renew --dry-run`. Sertifika durumu: `certbot certificates`.

## 9. Sorun giderme

| Belirti | Neden / çözüm |
|---|---|
| API çöküyor: `ERR_MODULE_NOT_FOUND @restoran-pos/shared-types/dist` | `pnpm --filter @restoran-pos/shared-types build` atlanmış — koş, `pm2 restart pos-api` |
| `password authentication failed` / "empty string is not a valid password" | Secrets dosyası yarım (bkz. §3 tuzak notu) — doğrula, gerekirse parolaları yeniden ata |
| 502 `/api` | API down: `pm2 logs pos-api --lines 50 --nostream` |
| `/auth/*` `429` beklenmedik | **ADR-002 Amd8 — §10.1'e bak** (üç kova, kurtarma tek komut). Kovalar gerçek istemci IP'sini görür (`trust proxy=1` + Nginx `$proxy_add_x_forwarded_for`) |
| Nginx config değişikliği | `nginx -t && systemctl reload nginx` (test etmeden reload etme) |
| Sunucu reboot sonrası API yok | `systemctl status pm2-root`; `pm2 resurrect` |
| Site tamamen erişilemez / **Namecheap parking sayfası** dönüyor | DNS nameserver ayarı **"Custom DNS"e** dönmüş olabilir (parking zone; A-kayıtları doğru olsa bile Custom-DNS'te UYGULANMAZ). Namecheap → Domain → Nameservers'ı **"Namecheap BasicDNS"e** çevir → Advanced-DNS A-kayıtları (`@`/`www` → `167.233.78.127`) tekrar geçerli olur. Tanı: `dig +short restoranpos.org` parking-IP dönerse önce nameserver-TİPİNİ kontrol et. A-kayıtlarına DOKUNMA (zaten doğru). Kayıt: S99 (2026-07-18) kesintisi. |

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

---

## 10. Geri dönüş (rollback)

Kod rollback: sunucuda `git checkout <önceki-commit>` + §4 build adımları + `pm2 restart pos-api`. **DB migration'ları forward-only** — migration içeren deploy geri alınamaz; bu yüzden migration'lı deploy'dan önce yedek zorunlu (`backup-strategy.md`). Operasyonel rollback (restoran akışı): ADR-031 K10 — kısa kesinti kağıt fallback + fix-forward, büyük arıza Adisyo'ya dönüş.
