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

# Yalnız migration içeren deploy'da (önce yedek al: pg-backup.sh — bkz. backup-strategy.md; restore prosedürü orada §7):
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

Migration'lı deploy notları: forward-only (ADR-003 — down yok); `pgmigrations`'tan DELETE migrator'a kapalı; **enum migration'larında incremental senaryo lokalde test edilmiş olmalı** (fresh CI yeşili yanıltıcı — bkz. Migration 042 dersi); go-live sonrası İLK canlı-veri migration PR'ından önce CONCURRENTLY gate PR'ı zorunlu (ADR-031 K12).

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

```sql
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM migrator;
```

Doğrulama (her ikisi `f` dönmeli — 2026-07-04'te prod'da doğrulandı):
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
