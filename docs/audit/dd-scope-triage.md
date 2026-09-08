# Satın-alma DD Raporu — Kapsam Triyajı (S122)

**Kaynak:** Red-team teknik due-diligence raporu (Artifact `ffa62d18-8985-4b62-aa86-580c4472b053`), main `4dee568`, 2026-09-06. 8 uzman ajan, 73 bulgu: **7 Kritik + 24 Yüksek + 29 Orta + 13 Düşük** (rapordaki sayılar yaklaşıktır).
**Triyaj tarihi:** 2026-09-07 (S122).
**Filtre (CLAUDE.md kapsam kilidi):** her bulgu üç sorudan geçer — (1) v3'te var mıydı? (2) v5.0 MVP'de mi? (3) kendi öz-kuralımız (DoD / Core Directive / ADR) zorunlu kılıyor mu? Üçü de hayırsa → v5.1 backlog ya da ADR-gerekçe. "Güzel olur" ile "canlı tek-tenant'ı ısırır" ayrımı esas.

> **Bağlam:** ürün MVP = **tek tenant (kendi restoranım), tek Hetzner box** (charter). Raporun en büyük "riskleri" (çok-tenant RLS/izolasyon, yatay ölçek, SPOF, ajan oto-güncelleme) tam da bu bilinçli tasarım tercihini "eksik" sayıyor. Alıcı gözüyle doğru; **ürün sahibi gözüyle çoğu tasarım gereği v5.1+**. Triyaj bunu ayıklar.

Kovalar:
- **A · ŞİMDİ** — canlı tek-tenant'ı fiilen ısırır, veya öz-kural ihlali, veya ucuz doğruluk/güvenlik/UX kazancı.
- **B · v5.1 / 2. tenant ön-koşulu** — gerçek ama MVP dışı; büyümede/ikinci işletmede gerekir. Çoğu zaten ADR ile ertelenmiş.
- **C · WONTFIX / bilinçli kabul** — charter tasarımı bunu seçti veya daha önce karar verildi. Tekrar flag'lenmesin.

Durum sütunu ileriki oturumlarda güncellenir (Açık / Kapandı #PR / WONTFIX).

---

## A · ŞİMDİ — canlı tek-tenant aday listesi

| ID | Bulgu | Sev | Efor | Gerekçe (neden şimdi) | Durum |
|----|-------|-----|------|------------------------|-------|
| HCI-1 | "Bölmeyi Sıfırla" onaysız + undo history'yi de siler | KRİTİK | S | Canlı ödeme ekranında kasiyer tüm split taslağını tek mis-tap'le kaybeder, Undo çalışmaz. Rush-hour. | ✅ **CANLI** #592 (deploy e8b784a, 2026-09-08) |
| KOD-1 | zod major çatallanması (web zod4 ↔ gerisi zod3) | KRİTİK | M | shared-types zod3 ile derlenip zod4 web'e giriyor → canlı web'de sessiz doğrulama sapması. | ✅ **CANLI** #593 (web→zod3.24, lockfile tek sürüm; deploy e8b784a, 2026-09-08) |
| OPS-5 | Yedek başarı alarmı yok (sessiz yedeksizlik) | YÜKSEK | S | Canlı para/sipariş. Timer/rclone bozulursa ilk fark ediliş = restore anı. Dead-man's-switch + son-yedek-yaşı alarmı. | ✅ **CANLI** #597 (ADR-040; pg-backup.sh healthchecks.io dead-man's-switch, fail-safe; deploy e8b784a. Aktivasyon [USER]: HEALTHCHECK_URL) |
| OPS-6 | Off-site restore drill test edilmemiş (yalnız lokal) | YÜKSEK | S-M | Şifreli off-site yedeğin açılabilirliği bilinmiyor → RTO teorik. Canlı DR. | ✅ Zaten karşılanmış — **DD bulgusu eskimişti**: off-site uçtan uca drill S85 (ilk sunucu, Storage Box) + S111 (aylık, off-site 15.3MB) yapılıp backup-strategy.md §8'e loglanmış. Aylık cadence zaten "ZORUNLU". Yeni kod gerekmez. |
| OPS-4 | Gözlemlenebilirlik yok (Sentry "sözde") | YÜKSEK | M | **DoD + code-style Sentry'yi ZORUNLU kılıyor ama yok** → öz-kural ihlali. Prod hataları görünmez. | ✅ **CANLI** #595 (ADR-040; api+web Sentry EU + KVKK scrub; deploy e8b784a. Kod no-op — aktivasyon [USER]: SENTRY_DSN/VITE_SENTRY_DSN) |
| KOD-4 | İş kuralı duplikasyonu web↔mobile (fiyat hesabı) | YÜKSEK | M | `effectiveUnitPriceCents`/subtotal 4 yerde → kuruş sapması riski, canlı para. shared-domain'e tekilleştir. | Açık |
| HCI-2 | Masa panosu "Yenile" = tam sayfa reload | YÜKSEK | S | Yoğun saatte 2-4sn beyaz ekran + modal kaybı; `invalidateTables()` zaten var. | Açık |
| HCI-3 | Split silme butonları 28px (Fitts) | YÜKSEK | S | Islak/hızlı parmakla yanlış payer/kalem silinir → yanlış tahsilat. 44px'e çıkar. | Açık |
| HCI-4 | Nakit input küçük + klavye kaçınma yok | YÜKSEK | M | Numeric klavye "Ödemeyi al"ı örter; POS numpad yok. QuickPayment deseni. | Açık |
| I18N-1 | PrivacyPolicyPage tümüyle hardcoded TR | YÜKSEK | M | **Core Directive #4 doğrudan ihlali** (i18n-key zorunlu). Hukuki metin kod PR'ıyla değişiyor. | Açık |
| I18N-2 | i18n guard dar + mobil guard yok | YÜKSEK | M | Yeni dosyada hardcoded girişini engellemiyor (PrivacyPolicy kanıtı). Enforcement. | Açık |
| OPS-7 | CI'da required-check yok | YÜKSEK | S-M | Kırmızı CI ile merge mümkün — kayıtlı kural "CI yeşil olmadan merge etme"nin enforcement'ı. | Açık |
| VERI-5 | Soft/hard-delete telefon yeniden kullanılamaz (23505) | ORTA | S | Canlı müşteri bug'ı: soft-silinen müşterinin telefonu UNIQUE'i işgal eder. | Açık |
| VERI-6 | audit_logs PII CHECK yalnız top-level tarar | ORTA | S | `payload.data.phone` iç-içe PII by-pass → KVKK. jsonb path taraması. | Açık |
| GUV-2 | `DATABASE_URL` prod fail-fast yok | ORTA | XS | Env unutulursa sessizce `pos_dev`'e düşer → veri tutarsızlığı. Ucuz emniyet. | Açık |
| GUV-3 | Bridge `/incoming` rate-limit yok | ORTA | S | Canlı Caller-ID; token sızarsa sınırsız PII enjeksiyon/DoS → KVKK. | Açık |
| OPS-11 | Deploy doküman drift'i (pull kaynağı çelişkisi) | ORTA | S | `deploy.md` "git pull origin main" ↔ pratik "push prod". Canlı olayda yanlış-kaynak riski. | Açık |
| OPS-8 | caller-bridge CI'da derlenmiyor + `bin/` commit'li | ORTA | S | .NET testi yalnız lokal; `bin/`+`obj/` gitignore + `dotnet build/test` job. | Açık |
| OPS-10 | Araç sürüm sabitleme (`turbo:"latest"`, node uyuşmazlığı) | ORTA | S | Yeniden-üretilemez build; Turbo major kırabilir. `node-version-file:.nvmrc`. | Açık |
| TEST-3 | db paketi 13 test env yokken sessizce SKIP | ORTA | S | CI/lokal sahte-yeşil. Env yoksa fail ya da CI'da zorunlu DB. | Açık |
| I18N-3 | Dinamik key riski (5 site) — statik guard göremez | ORTA | S | enum'a yeni değer + tr.json güncellenmezse ham key ekrana düşer. exhaustive `Record`. | Açık |
| I18N-4 | İsim tutarsızlığı (payment.errors: camelCase ↔ UPPER) | ORTA | S | Tek konvansiyon. | Açık |
| KOD-5 | `shared-ui` paketi tamamen ölü | YÜKSEK* | S | *Efor S ama **dead-code silme sorulur** (Core Directive #7). Öneri: kaldır veya doldur — karar gerek. | Açık |
| VERI-9 | age private key drill'de transkripte sızmış | DÜŞÜK | XS | Yedek şifreleme anahtarı sohbete yapışmış; **rotasyon yapıldı mı DOĞRULA** (güvenlik). | Açık |
| I18N-5 | Hardcoded "Yükleniyor" (key zaten var) | DÜŞÜK | XS | `common.loading` mevcut, `AuthBootstrapGate.tsx:21`. | Açık |
| I18N-6 | Kullanılmayan key `syncStub` | DÜŞÜK | XS | Kaldır (kendi ürettiğimiz değil → bildir/onayla). | Açık |
| KOD-9 | Küçük hijyen: 1 TODO, 3 console.*, web devDeps'te pg/kysely | DÜŞÜK | S | TODO'yu çöz/issue-aç (Core Directive), frontend'e sızmış DB paketlerini doğrula. | Açık |
| HCI-11 | Kritik bilgide çok küçük font (10-11px) | DÜŞÜK | S | Süre/split meta min 12-13px. | Açık |
| HCI-12 | QuickPaymentModal her açılışta varsayılana döner | DÜŞÜK | S | Son seçimi hatırla (localStorage). | Açık |

**A içinde önerilen başlangıç sırası (değer/efor):** HCI-1 → KOD-1 → OPS-5+OPS-6 → OPS-4 → HCI-2/HCI-3 → VERI-5 → I18N-1. (Ucuz hijyen — GUV-2, VERI-9, I18N-5/6, OPS-10 — bir "temizlik" PR'ında toplanabilir.)

---

## B · v5.1 / 2. tenant ön-koşulu — ertelenmiş (çoğu zaten ADR-kararlı)

| ID | Bulgu | Sev | Neden MVP dışı | Not |
|----|-------|-----|-----------------|-----|
| MIM-1 | Tenant-izolasyon mekanizması kodda yok (~2.600 elle WHERE) | KRİTİK | MVP = tek tenant. Sızıntı ancak 2. tenant CANLI olunca. | **2. tenant ön-koşulu — ADR gerekli** (repository/Kysely plugin). |
| MIM-2 / VERI-1 | RLS policy yok | KRİTİK×2 | **Zaten ADR-001 §6.4 ile v5.2'ye ertelenmiş.** | 2. tenant öncesi şart; karar mevcut. |
| MIM-7 | Sabit-kodlu default tenant UUID (bootstrap) | ORTA | Auth yolu JWT'den tenant alıyor; yalnız bootstrap tek-tenant varsayıyor. | 2. tenant öncesi kaldır. |
| OPS-2 | Restoran-PC ajanlarında oto-güncelleme yok | KRİTİK | MVP tek işletme; elle cutover dokümante + kabul (S88+ dersleri). | 2-3 işletmede şart; `agent_version` heartbeat. |
| OPS-1 / MIM-4 | Tek-box SPOF (kutunun kendisi, replica/failover yok) | KRİTİK/YÜKSEK | **Charter: tek Hetzner box bilinçli seçim.** | Hot-standby v5.1. *Ucuz parçalar (DB volume+snapshot+disk alarm) → C'de nota, düşük öncelik.* |
| MIM-3 | Yatay ölçek imkânsız (in-memory realtime) | YÜKSEK | Charter NOT: zincir/multi-region. Tek-node bilinçli tavan. | Redis adapter yalnız çok-node gerekince. |
| OPS-3 | Prod dist build + versiyonlu release + rollback + CD yok | YÜKSEK | Hardening. | shared-types dist zaten ŞART (kayıtlı); API `tsc` dist + `deploy.yml` v5.1. |
| VERI-3 | RPO ≤24h — PITR/WAL yok | YÜKSEK | **backup-strategy zaten v5.1'e ertelemiş.** | Canlı para → v5.1 içinde erken sıraya alınabilir. |
| VERI-2 | Down migration yok (rollback = restore) | YÜKSEK | 001 "forward-only" bilinçli karar. | Riskli DDL'lerde down + runbook v5.1. |
| KOD-3 | Bundle >350KB (biri 918KB) | YÜKSEK | Kasa tableti ilk-yük (canlı UX) ama tek-seferlik. | Sınırda; istenirse A'ya alınır. vendor split. |
| MIM-8 | Realtime replay yalnız Caller-ID | ORTA | Kopuk istemci sipariş/KDS olayını kaybeder (kayıtlı risk). | **Değerlendir:** canlı garson telefonu kopması gerçek; v5.1 erken. |
| TEST-1 | Web UI ince test (101 test) | YÜKSEK | Kalite borcu. | Kritik ekranlara (Split/Order) bileşen+E2E v5.1. |
| TEST-2 | Mobil Detox yok (stack iddiası asılsız) | YÜKSEK | Kalite borcu + doc drift. | Doc iddiasını düzelt (ucuz) + Maestro/Detox v5.1. |
| GUV-1 | ABAC dağınık, merkezi değil | ORTA | Somut exploit yok; hardening. | Yeni-route sahiplik unutma riski → merkezileştir+test v5.1. |
| KOD-2 | Tanrı-dosyalar (orders.ts 3021 vs) | YÜKSEK | Cerrahi-değişiklik kuralı: sebepsiz refactor yasak. | Dokunulan modül bölünürken kademeli. |
| KOD-6 | API yanıt-şekli tutarsızlığı | ORTA | Büyük, geniş kapsam. | Zarf sözleşmesi standardı v5.1. |
| KOD-7 | react sürüm ayrışması (mobile19 ↔ web18) | ORTA | shared-ui canlanmadıkça sorun yok. | shared-ui kararına bağlı. |
| KOD-8 | SplitPaymentModal karmaşıklığı (1276 satır) | ORTA | Refactor. | Alt-bileşen v5.1 (HCI-1/3/4 fix'leriyle fırsatçı). |
| OPS-9 | print-agent/MSI + caller-bridge imzasız | ORTA | **ADR-031 K13 ile v5.1'e ertelenmiş.** | Büyümede EV sertifika. |
| OPS-12 | Sıfır-kesinti + secret rotasyon runbook yok | DÜŞÜK | Kabul edilebilir. | Deploy'u kapanış saatine sabitle; yıllık rotasyon. |
| GUV-5 | bcryptjs (saf-JS) | DÜŞÜK | Cost 12 iyi. | argon2id geçiş yolu v5.1. |

---

## C · WONTFIX / bilinçli kabul (tekrar flag'lenmesin)

| ID | Bulgu | Karar dayanağı |
|----|-------|----------------|
| — (MIM-4/OPS-1 kutu) | Tek Hetzner box mimarisi | **Charter tasarım tercihi** (CX22→CX32, tek tenant). Ölçek/failover = v5.1 (B'de). Kutunun kendisi WONTFIX. |
| HCI-6 | Kaydedilmemiş sepet geri-tuşunda sessizce kaybolur | **S84 ürün-sahibi kararı = F3 WONTFIX** (yeni/İLAVE sepet bilerek uyarısız çıkar). Değiştirme. |
| GUV-4 | Garson rolü müşteri PII okuma | Meşru (paket servis); KVKK envanterinde gerekçeli. Kabul. |
| GUV-6 | Access token 30dk iptal edilemez | Kısa-TTL bilinçli; yalnız dokümante et (kod değişikliği yok). |
| TEST-4 | Donanım yolları (USB/ESC-POS/WMI) test dışı | Pilot go/no-go disipliniyle kabul (kayıtlı). |
| VERI-4 | FK'de otomatik index yok | Politika notu; 047 canlıda düzeltildi. İzleme (products.category_id) A/B'de değil — hijyen. |
| VERI-7 | Partial-index blacklist deseni | 041/042 zaten whitelist'e çevirdi (canlı). Çözülmüş. |
| VERI-8 | CONCURRENTLY policy-kod çelişkisi | Küçük tabloda kabul; büyük tablo index'inde uygulanır (politika, bulgu değil). |

---

## Özet sayım

| Kova | Kritik | Yüksek | Orta | Düşük | Toplam |
|------|:---:|:---:|:---:|:---:|:---:|
| **A · Şimdi** | 2 | 9 | 8 | 6 | ~25 |
| **B · v5.1 / 2.tenant** | 4 | 9 | 5 | 2 | ~20 |
| **C · WONTFIX/kabul** | 1 | 2 | 4 | 1 | ~8 |
| (Doğrulanan güçlü kontroller — bulgu değil) | | | | | 4 poz |

> **En kritik gözlem:** Raporun 7 Kritik'inin **4'ü çok-tenant/ölçek/SPOF/ajan** = charter'a göre bilinçli MVP-dışı (B/C). Yalnız **2 Kritik gerçekten canlı tek-tenant'ı ısırıyor** (HCI-1 ödeme veri kaybı, KOD-1 zod sessiz sapma) → A'da ilk sırada. Kalan 1 Kritik (RLS) zaten ADR ile v5.2.
