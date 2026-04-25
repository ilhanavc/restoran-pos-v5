# Lokal Geliştirme Kurulumu

Bu doküman yeni bir geliştirici makinesinde repo'yu çalışır hâle getirmek için adım adım talimatları içerir. Phase 1 sonu itibarıyla auth akışı (login → me → refresh → logout) bu adımlar takip edilerek uçtan uca smoke edilebilir.

> Üretime kapalı: Bu doküman dev makinesi içindir. `admin1234` gibi sabit dev-credential'ları **prod'a gitmez**. Seed script `NODE_ENV=production` ortamında otomatik bloklanır (`ALLOW_SEED=true` opt-in gerekir).

## Önkoşullar

| Araç           | Versiyon                  | Doğrulama                      |
| -------------- | ------------------------- | ------------------------------ |
| Node.js        | 22.11.x (LTS), 22.x serisi | `node --version`               |
| pnpm           | 9.x                       | `pnpm --version`               |
| Docker Desktop | son sürüm                 | `docker --version` ve daemon ayakta |
| Git            | herhangi modern           | `git --version`                |

Windows'ta path uzunluk sınırı problem çıkarabilir; gerekirse `git config --system core.longpaths true`.

## 1. Bağımlılıklar

Repo kökünde:

```bash
pnpm install
```

Workspace'lerin tamamı tek `pnpm install` ile kurulur (Turborepo + pnpm workspaces).

## 2. Postgres'i ayağa kaldır

Repo kökünde `docker-compose.yml` Postgres 17 servisini tanımlar.

```bash
docker compose up -d
```

Hazır olduğunu doğrula:

```bash
docker compose logs postgres | grep "ready to accept connections"
```

`.env` veya shell ortamında bağlantı stringleri:

- `DATABASE_URL` — `app_tenant` rolü (uygulama bağlantısı, DDL yetkisi yok)
- `MIGRATOR_DATABASE_URL` — `migrator` rolü (DDL yetkisi var)

Tam değişken listesi için repo kökündeki `.env.example` ve `apps/api/.env.example` dosyalarına bak. Buraya kopyalanmaz; tek kaynak `.env.example`'dır.

## 3. Migration'ları çalıştır

```bash
pnpm --filter @restoran-pos/db migrate
```

Bu komut `node-pg-migrate` ile `packages/db/migrations/` altındaki SQL dosyalarını sırayla uygular (`MIGRATOR_DATABASE_URL` üzerinden).

## 4. Seed (dev fixture)

Migration'lar bittikten sonra:

```bash
pnpm --filter @restoran-pos/db seed
```

Seed idempotent: aynı sabit UUID'ler `ON CONFLICT DO NOTHING` ile korunur, ikinci çalıştırma "0 inserted" çıktısı verir.

Seed içeriği:

- 1 tenant: `Demo Restoran`
- 1 admin user: `admin@local.test` / `admin1234` (bcrypt cost 12 ile hash'lenir)
- 5 masa (kod: `1` … `5`)
- 3 kategori (Yemek, İçecek, Tatlı)
- 5 ürün (Karışık Pide 150 ₺, Mercimek Çorbası 80 ₺, Adana Kebap 220 ₺, Ayran 35 ₺, Sütlaç 65 ₺)

Guard: `NODE_ENV=production` iken seed sadece `ALLOW_SEED=true` env'i de set edilirse çalışır. Aksi hâlde `[seed] blocked` mesajıyla `exit 1`.

## 5. API'yi başlat

```bash
pnpm --filter @restoran-pos/api dev
```

Health endpoint:

```bash
curl -i http://localhost:3001/health
```

`200` ve JSON cevabı bekleniyor.

## 6. Manuel smoke senaryosu — auth akışı

`cookies.txt` aynı klasörde oluşturulup adımlar arası taşınır. Beklenen sonuçlar her adımda yazılı; bir adım kırmızıysa Phase 1 exit edilmemiş demektir.

```bash
# 1) Login — 200 + accessToken + Set-Cookie: rt=...
curl -i -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"email":"admin@local.test","password":"admin1234"}'
```

`response.accessToken` değerini bir kabuk değişkenine al (örn. `ACCESS=$(...)`).

```bash
# 2) Me — 200, user.email = admin@local.test
curl -i http://localhost:3001/auth/me \
  -H "Authorization: Bearer $ACCESS"
```

```bash
# 3) Refresh — 200 + yeni accessToken (rotated)
curl -i -X POST http://localhost:3001/auth/refresh \
  -b cookies.txt -c cookies.txt \
  -H "X-Refresh-Request: 1"
```

Yeni token'ı `ACCESS` olarak güncelle.

```bash
# 4) Me yeni token ile — 200
curl -i http://localhost:3001/auth/me \
  -H "Authorization: Bearer $ACCESS"
```

```bash
# 5) Logout — 200 + cookie clear
curl -i -X POST http://localhost:3001/auth/logout \
  -b cookies.txt -c cookies.txt
```

```bash
# 6) Refresh tekrar denenirse 401 (cookie temizlendi)
curl -i -X POST http://localhost:3001/auth/refresh \
  -b cookies.txt \
  -H "X-Refresh-Request: 1"
```

`401 AUTH_REFRESH_INVALID` beklenir.

## Sorun giderme

- **`ECONNREFUSED localhost:5432`** — Postgres container ayakta değil, `docker compose ps` ile kontrol et.
- **`role "migrator" does not exist`** — `000_init.sql` çalışmamış, fresh DB üzerinde migrate'i baştan çalıştır.
- **Seed `tenants_pkey` çakışması yerine "0 inserted"** — beklenen davranış (idempotent).
- **`401 AUTH_INVALID_CREDENTIALS` adım 1'de** — seed çalışmamış veya `password_hash` farklı bir cost ile üretilmiş; `pnpm --filter @restoran-pos/db seed` baştan çalıştır.
