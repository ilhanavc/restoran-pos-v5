# Aktif Plan — Canlı Üretim: Bakım, Sertleştirme ve Canlı Bug Akışı

> Bu dosya o an üzerinde çalıştığımız işin tek kaynağıdır. Faz/sprint değişince **tamamen yenilenir**.
> Tüm faz roadmap'i: `docs/project-charter.md` → "Faz Roadmap". **Oturum geçmişi ve detay: `docs/context-anchor.md` §2** (tek giriş kapısı).
> Mimari kararlar: `.claude/memory/decisions.md`.

**Son güncelleme:** 2026-10-13 (Session 142 kapanışı).

> ⚠️ **Bu dosya S104'ten S139'a kadar güncellenmeden kaldı** (35 oturum) ve "SIRADAKİ (S105)" diyordu. S139'un bayatlık denetiminde yakalandı ve gerçeğe oturtuldu. Eski içerik git history'de; o dönemin anlatımı çapa §2'de.

## Neredeyiz

**Sprint yok.** Proje 2026-07-24'te GO-LIVE oldu; restoran tamamen v5 kullanıyor (Adisyo düştü). Postür o günden beri aynı: **canlı üretim bakımı**. İş kalemleri sprint'ten değil üç kaynaktan gelir:

1. **Ürün sahibinin canlıda bulduğu şeyler** (en yüksek öncelik — gerçek kullanım).
2. **Denetim/kapı bulguları** (security-reviewer, migration-guard, hci, qa).
3. **Kayıtlı chip'ler / backlog.**

**Çalışma deseni:** küçük, cerrahi PR + test + negatif kontrol + ilgili kapı + yoğun-saat dışı deploy. Her değişiklik gerçek sipariş akan bir işletmeye iner.

## Açık iş (2026-10-13 itibarıyla)

`main` = prod = `cea127d` · **açık PR yok.**

| # | İş | Durum |
|---|---|---|
| 1 | 🔴 **Ajan kimliğinin ilk gerçek baskıyla doğrulanması** | #727 **fail-closed**: yanlış giderse baskı **sessizce** durur. Deploy anında üç yazıcının `last_seen_at`'i ~12 saat öncesiydi (dükkan kapalı) → **geçerli** agent-JWT yolu prod'da sınanmadı, yalnız CI kanıtı var. **[USER] dükkan açılınca ilk fişi izle.** Geri alma: `git reset --hard e70564c` + web build + `pm2 restart pos-api` |
| 2 | **[USER] ADR-004 Amd14 K4** — 4 Temmuz'dan kalma ölü ajan satırını kilitle | Hiç bağlanmamış ama **geçerli apiKey hash'i taşıyor** — gerçek açık bu. Yazıcılar ekranından *"Eski kurulumdan kalan kayıt"* ile. UI'den yapılmalı: elle SQL **audit kaydı yazmaz**. Aynı tıklama özelliğin canlı smoke'u olur |
| 3 | **K8 izleme penceresi** — `/auth/*` 429 gözlemi | ✅ Sağlıklı koşuyor: timer canlı, sağlıklı günler **kaydediliyor**, ham access log'da gerçekten 0 adet 429 (akıl sağlığı kontrolü tuttu). **2026-10-18'de kapat:** `systemctl disable --now auth-429-watch.timer` + sonucu `docs/ops/deploy.md` §10.1'e yaz |
| 4 | **[USER] Play Store** | Üretim sayfası 404, kapalı test açık, *"Üretime başvur"* bekliyor. Claude Google hesabına giremez |

**Chip kuyruğu (2):** yazıcı kayıt anahtarı rotasyonu (ADR-004 Amd14 **K3** — ortak sır hâlâ tek hash, asıl zorluk cutover) · kilit ekranına yetim-iş sayısı + kilit gerekçesi (yeni DTO alanı `pinnedPendingJobs` gerekiyor; ⚠️ `queueDepths` o sayı **değildir**).

## Backlog (aciliyeti ölçülmüş, bekliyor)

- **İstemci refresh backoff'u** — ADR-002 Amd8 C-2'nin asıl çaresi. `/refresh` fırtınası taban kovayı tüketip girişi de kilitleyebilir; kurtarma tek komut olduğu için kabul edildi. Aynı aile: Amd7 C-1 (ağ hatasından sonra proaktif retry) — **ölçüldü, gerçekleşmemiş**: `reuse_detected` prod'da 10'da sabit, sonuncusu 2026-09-26. İkisi tek ADR'de ele alınmalı.
- **v5.1'e ertelenenler (ADR-002 §14.9):** WAF/fail2ban/Nginx `limit_req`, Redis rate-limit store, account lockout/CAPTCHA/2FA, limiter bypass guard'ının paylaşımlı modüle çıkarılması.
- **Eski v5.1 kuyruğu:** `docs/audit/low-nit-devir.md`, unused-exported-types temizliği, ADR-032 Dilim C/D/E, kişi-bazlı `cashier` rolü.

## Değişmeyen kurallar

- **Deploy GitHub merge ile OLMAZ** — `git push prod main` + sunucuda pull/build/`pm2 restart` (`docs/ops/deploy.md` §4). Atlanırsa sunucu eski commit'te kalır.
- **main'e doğrudan push yasak** — PR + `ci` + `Playwright Smoke`.
- **Prod'a YAZMA Auto kipinde reddedilir** — kullanıcı kipi değiştirmeli (okuma serbest).
- **Migration'lı deploy:** önce yedek; canlı-veri index'leri restoran kapalıyken.
