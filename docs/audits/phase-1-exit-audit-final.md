# Phase 1 Exit Audit — Katman 3 (Stratejik / Risk Kontrolü)

**Tarih:** 2026-04-26 (Session 25 oturum 2 sonrası)
**Audit kapsamı:** context-anchor §2 borçlar + pain-points.md 23 ağrı + charter scope drift + Phase 2 hazırlığı
**Repo durumu:** main `68fe9a9`, origin/main güncel.

---

## 1. Açık stratejik borçlar — ⚠️ ÇOK FAZLA AMA TAKİP EDİLİYOR

Anchor §2 listesi 14 kalem içeriyor; iki kategoriye ayrılır.

### 1A. Phase 0'dan taşınan, Phase 1'de KAPATILMAYAN kalemler (8)

| Kalem | Kaynak | Durum |
|---|---|---|
| Daily-closeout ADR | §10.4.2 forward-ref | ⚠️ Açık |
| Error taxonomy ADR | §10.5 C6 + §11.10 | ⚠️ Açık |
| PITR/backup stratejisi (`docs/ops/backup-strategy.md`) | §13 | ⚠️ Açık (Phase 4 implementasyonu zaten geç, ADR olmaması Phase 2'de problem değil) |
| Cron lock id registry (`docs/engineering/cron-conventions.md`) | Phase 0 implementer turu | ⚠️ Açık |
| KVKK veri haritası (`docs/compliance/kvkk-data-mapping.md`) | §13 retention yasal dayanak | ⚠️ Açık |
| §11 parity stress harness | §11.10 | ⚠️ Açık |
| §14.6 payments index ölçümü | Phase 1 ölçüm borcu | ⚠️ Açık |
| §14.5.B snapshot index DROP threshold | Phase 1 ölçüm borcu | ⚠️ Açık |
| `customer_phones` data-model notu | ayrı PR | ⚠️ Açık |

**Kanıt:** anchor §2 satır 60-72 — tek satırlık liste maddeleri.

### 1B. Phase 1.5'te yeni eklenen kalemler (2)

| Kalem | Commit | Durum |
|---|---|---|
| decisions.md §9 CREATE TYPE drift | İş #7 commit `2526aa7` mesajı | ⚠️ Yeni |
| Demo seed pwd `admin1234` (9 char) | `b5a0277` | ⚠️ Yeni |

### 1C. v5.1 forward-ref listesi (8)

`Refund ADR, admin uncomp, kurye tracking, prepaid, breach-list, jti denylist, kid v2, ABAC merkezi helper` — bilinçli olarak v5.1'e itelendi, MVP kapsam dışı. ✅ Disiplinli.

### 1D. KAPATILANLAR

ADR-001 ve ADR-002 forward-ref'leri tamamen resolve edildi (anchor §2 satır 73-74). ✅

**Risk değerlendirmesi:** Liste şişmiş. **PITR ve KVKK haritası** dışındakiler "doc + ADR" niteliğinde, kod yazımına engel değil. PITR Phase 4'e zaten ertelenmiş; KVKK haritası prod öncesi şart ama Phase 2'de değil. Phase 2'ye geçişi engellemiyor.

---

## 2. Pain-points kontrolü (23 ağrı)

| # | Ağrı | v5 önlemi durumu |
|---|---|---|
| P-01 Türkçe karakter | ADR-004 Print Agent (Phase 2/3 implementasyonu) | ⚠️ ADR var, kod yok — Phase 2/3 |
| P-02 Sessiz yazıcı arızası | ADR-004 timeout/retry kuralı | ⚠️ ADR var, kod yok |
| P-03 Çift basım | DB `idempotency_key UNIQUE` 000_init.sql | ✅ DB tarafı |
| P-04 StoreBridge karmaşıklığı | ADR-004 + sıfırdan yazım kuralı | ✅ Karar net |
| P-05 Yazıcı ekleme = redeploy | `printers` tablosu admin CRUD | ⚠️ Tablo var, endpoint yok |
| P-06 Float para | `MoneyCentsSchema` zod + `*_cents INT` DB | **⚠️ ESLint float yasağı kuralı YOK** — pain-points.md "ESLint rule" diyor, mevcut config'te float ban yok |
| P-07 Telefon UNIQUE | 000_init.sql partial index | ✅ DB tarafı |
| P-08 Snapshot NOT NULL | 000_init.sql kolonlar | ✅ DB tarafı |
| P-09 Audit retention | Tablo + §13 kuralı, cron Phase 2/3 | ⚠️ Cron yok |
| P-10 call_logs tek tablo | 000_init.sql | ✅ |
| P-11 Aynı masaya iki sipariş | partial UNIQUE 000_init.sql | ✅ |
| P-12 order_no race | §11 + tablo, servis Phase 2 | ✅ DB tarafı |
| P-13 mixed/other enum yok | `{cash, card, transfer}` | ✅ |
| P-14 Refund | Refund ADR v5.1, MVP tam iptal Phase 2/3 | ⚠️ ADR yok, MVP davranışı net |
| P-15 Manuel kapanış | **Daily-closeout ADR yazılmadı** | ⚠️ ADR yok |
| P-16 Z raporu karışıklığı | Glossary + ADR tutarlı | ✅ |
| P-17 Müşteri silme | `anonymized_at` ADR-003 §8.3 | ✅ DB tarafı |
| P-18 Raw telefon audit | `AuditSanitizer<T>` kontratı, **kod yazılmadı** | ⚠️ Kontrat var, kod yok |
| P-19 Caller ID 2-3sn | Socket.IO planlandı, kod yok | ⚠️ Phase 2 |
| P-20 Yedek altyapısı | **PITR ADR yazılmadı** | ⚠️ Phase 4 |
| P-21 Route guard | `authenticate` + `authorize` middleware | ✅ Kod var |
| P-22 Multi-araç kaosu | CLAUDE.md disiplini | ✅ |
| P-23 Cloud scale | Mimari karar | ✅ |

**Özet:** 11 ✅ tam, 7 ⚠️ kısmi/açık, 5 yazıcı (ADR-004 var, kod Phase 2/3).

**Kritik bulgu:** **P-06 ESLint float yasağı kuralı eksik.** Pain-points.md açıkça "ESLint rule" diyor, mevcut config'te `no-restricted-syntax` veya benzer bir float ban kuralı YOK. Sadece zod runtime guard var. Phase 2 endpoint'leri yazılırken bu kural devreye girmeli.

---

## 3. Kapsam kayması kontrolü — ✅ TEMİZ

Phase 1 + Phase 1.5'te yazılan her şey charter'la eşleşiyor:

| Yazılan | Charter Phase 1 madde | v5.1 sızması var mı? |
|---|---|---|
| `shared-types` zod | "zod şemaları" | Yok |
| `shared-domain` pure (money/order/tax/table/...) | "Order/Table/Menu/Payment/Money/User entity ve policy'leri (TDD)" | Yok |
| `packages/db` repos (users/refresh_tokens/tables) | "Repository pattern" | Yok |
| `apps/api` auth | "Auth sistem (JWT access + refresh, role matrix)" | Yok |
| ESLint enforce | ADR-001 §2.2 disiplin | Yok |
| Migration idempotency fix | Bug fix | Yok |
| Menu/Payment/User policy (Phase 1.5 telafi) | Charter Phase 1 madde — sessiz daraltma kapatıldı | Yok |
| ADR-004 Accepted | Charter Phase 1 ADR forward-ref | Yok |

**Charter dışı yazım: SIFIR.** Hatta tersi — atlanan bir çubuğun (Menu/Payment/User policy) telafisi yapıldı. Phase 1.5 forensic Verdict B kapatıldı.

---

## 4. Phase 2 hazırlığı

Charter satır 161-164: REST endpoints + Socket.IO + Web UI + E2E. Phase 1 altyapısının Phase 2 için yeterliliği:

### 4A. Hazır olanlar ✅

- Express `buildApp` fabrikası (`apps/api/src/app.ts`)
- `helmet`, `cors` (origin whitelist), `cookieParser`, `express.json` 100kb limit
- `authenticate` + `authorize` middleware
- Auth router (login/refresh/logout/me) + login rate limiter
- Repository pattern (users/refresh-tokens/tables)
- `RepositoryError`/`NotFoundError`/`ConflictError`/`mapPgError` (packages/db)
- DB schema 14 tablo + 7 enum + 4 rol
- Vitest test setup (auth.test.ts mevcut)
- CI yeşil

### 4B. EKSİK — Phase 2 başında halledilmesi gereken altyapı parçaları

| # | Eksik | Kanıt | Aciliyet |
|---|---|---|---|
| 1 | **Error taxonomy ADR** | Açık borç §10.5 C6 + §11.10. DB RAISE → Türkçe i18n-key, `23505` → CONFLICT + retry. Endpoint hata kodları bu ADR'ye dayanacak. | 🔴 İlk endpoint'ten önce |
| 2 | **Merkezi error handler middleware** | `apps/api/src/app.ts` — `app.use(errorHandler)` yok. `auth.ts:152-162` her endpoint'te inline try/catch + console.error. Çoğalmaya engel olmak için merkezi şart. | 🔴 İlk endpoint'ten önce |
| 3 | **Merkezi request validation middleware** | `auth.ts:83 LoginRequestSchema.safeParse(req.body)` pattern her endpoint'te tekrar yazılacak. `validateBody(Schema)` helper şart. | 🟡 İlk 2-3 endpoint'te kabul edilir, sonrası refactor borcu |
| 4 | **Logger altyapısı (pino/winston)** | `auth.ts:159` verbatim TODO: `// logger altyapısı Phase 1'de gelecek, şimdilik console.error`. **Phase 1'de gelmedi**, Phase 2 borcu. | 🟡 İlk endpoint'ten önce ideal |
| 5 | **writeAudit() fonksiyonu + AuditSanitizer impl** | ADR-003 §12.4 kontratı var, kod yok. Phase 2 her finansal/auth endpoint audit yazacak. | 🔴 İlk finansal endpoint'ten önce |
| 6 | **Socket.IO altyapısı** | Phase 2 charter maddesi. Auth handshake (ADR-002 JWT verify), KDS + sipariş push. `apps/api/src/`'da hiç socket kodu yok. | 🟡 İlk realtime endpoint'inde (KDS, sipariş) |
| 7 | **Genel API rate limiter** | Sadece login'de var (`auth.ts:72`). POST/PATCH/DELETE genel throttle yok. | 🟢 Pilot öncesi yeter |
| 8 | **`apps/api/src/services/` klasörü** | Phase 2 OrderService, MenuService, OrderCompService gelecek; klasör yok. | 🟡 Doğal olarak ilk feature ile gelir |
| 9 | **`apps/api/src/errors.ts` (HTTP error mapping)** | `RepositoryError` packages/db'de var, HTTP'ye nasıl çevrilecek tanımlı değil. Error taxonomy ADR sonrası. | 🔴 #1 ile birlikte |
| 10 | **ESLint float yasağı kuralı** | P-06 pain-point açıkça "ESLint rule" diyor. Mevcut config'te yok. | 🟢 Phase 2 başlamadan veya ilk haftada |

### 4C. Phase 2 ilk endpoint'ler için sıralama önerisi

```
1. Error taxonomy ADR yaz (1 oturum)
2. errors.ts + errorHandler middleware (1 commit)
3. validateBody(Schema) middleware (1 commit)
4. Logger pino kurulumu (1 commit)
5. writeAudit() impl + sanitizer (1 commit)
6. ESLint float ban kuralı (1 commit)
─────────────────────────────────────
Bunlar Phase 2 öncesi 1 hafta. Sonra ilk endpoint:
7. POST /tables (basit) → entire stack smoke
8. POST /menu/categories → soft delete pattern smoke
9. POST /orders → snapshot + invariant smoke
```

---

## VERDICT

**"Phase 2'ye geçilebilir AMA şu kalemler Phase 2 başında halledilmeli:"**

Zorunlu (🔴 ilk endpoint'ten önce):
1. **Error taxonomy ADR** + `errors.ts` HTTP mapping
2. **Merkezi error handler middleware**
3. **writeAudit() + AuditSanitizer impl** (ilk finansal endpoint'ten önce)

Önerilen (🟡 ilk hafta içinde):
4. Merkezi request validation middleware (`validateBody`)
5. Logger altyapısı (pino) — `console.error` borcunu kapatır
6. ESLint float yasağı kuralı (P-06 enforce)

Erteleme kabul (🟢 pilot öncesi):
- Genel API rate limiter
- Socket.IO (ilk realtime endpoint'le birlikte)
- Daily-closeout ADR (Phase 4 implementasyonu yakınında)
- KVKK veri haritası (prod öncesi şart, MVP'de değil)
- PITR ADR (Phase 4)

**Kapsam disiplini:** ✅ Sıfır sızma, charter ile tam uyumlu. Phase 1.5 sayesinde sessiz daraltma da telafi edildi.

**Liste şişmesi uyarısı:** Açık borçlar 14 kalem. Phase 2 sonunda yine audit gerekir; aksi halde "v3 hatası" gibi sürünen borçlar birikir.
