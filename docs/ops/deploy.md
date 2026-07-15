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
| `TENANT_ID` | **Bootstrap sonrası** eklenir — bootstrap'in ürettiği gerçek tenant UUID ile EŞLEŞMELİ (ADR-031 K4) |
| `E2E_BYPASS_LOGIN_LIMIT` | Prod'da **ASLA set edilmez** |

Migration için ayrıca: `MIGRATOR_DATABASE_URL` = `postgresql://migrator:<PG_MIGRATOR_PASSWORD>@127.0.0.1:5432/pos_prod` (kalıcı env'e yazılmaz; deploy anında `/root/pos-secrets.env`'den türetilir).

⚠️ **Secrets dosyası tuzağı:** dosya üretimi `if [ ! -f ]` guard'lıysa eski/yarım dosya korunur → değişkenler boş gider. Kullanmadan önce doğrula:
`awk -F= '{print NR": "$1" len="length($2)}' /root/pos-secrets.env` (5 satır, len>0 olmalı).

## 4. Normal deploy prosedürü

**Lokal makinede (D:\restoran-pos-v5):**
```bash
# remote bir kez tanımlanır: git remote add prod ssh://root@167.233.78.127/opt/git/restoran-pos.git
GIT_SSH_COMMAND="ssh -i ~/.ssh/restoran_pos_ed25519" git push prod main
```

**Sunucuda:**
```bash
cd /opt/restoran-pos
git pull origin main
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
6. **Nginx + SSL:** site config (bkz. §1 route'ları; `/socket.io` bloğunda `Upgrade`/`Connection "upgrade"` başlıkları) → `nginx -t && systemctl reload nginx` → `certbot --nginx -d restoranpos.org -d www.restoranpos.org --redirect` (LE sözleşme onayı kullanıcıdan alındı).
7. **Servis:** `/opt/restoran-pos/run-api.sh` (env source + tsx) → `pm2 start ... --name pos-api` → `pm2 startup systemd && pm2 save`.
8. **Bootstrap (P5-2):** prod tenant/admin/agents bootstrap script'i koşulur → `TENANT_ID` env'e eklenir → `pm2 restart pos-api` → login smoke.

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

Doğrulama (her ikisi `f` dönmeli — 2026-07-04'te prod'da doğrulandı; sahiplik devri sonrası 2026-07-10'da YENİDEN doğrulandı):
- [x] `SELECT has_table_privilege('migrator','pgmigrations','DELETE');` → `f`
- [x] `SELECT has_table_privilege('migrator','orders','DELETE');` → `f`

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
| Login `429` beklenmedik | `E2E_BYPASS_LOGIN_LIMIT` prod'da set edilmiş olmamalı; loginLimiter gerçek IP görür (`trust proxy` kodda açık) |
| Nginx config değişikliği | `nginx -t && systemctl reload nginx` (test etmeden reload etme) |
| Sunucu reboot sonrası API yok | `systemctl status pm2-root`; `pm2 resurrect` |

## 10. Geri dönüş (rollback)

Kod rollback: sunucuda `git checkout <önceki-commit>` + §4 build adımları + `pm2 restart pos-api`. **DB migration'ları forward-only** — migration içeren deploy geri alınamaz; bu yüzden migration'lı deploy'dan önce yedek zorunlu (`backup-strategy.md`). Operasyonel rollback (restoran akışı): ADR-031 K10 — kısa kesinti kağıt fallback + fix-forward, büyük arıza Adisyo'ya dönüş.
