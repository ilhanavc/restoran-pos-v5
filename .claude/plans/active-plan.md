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

## Açık iş (2026-10-16 itibarıyla)

**Prod'daki kod = `412c34f`** (2026-10-16). `main` bundan ileride olabilir ama yalnız **doküman** commit'leriyle — kod farkı varsa deploy borcu var demektir, `git log 412c34f..main --oneline` ile bak. **Açık PR yok · deploy borcu YOK.**

**2026-10-16'da inen üç şey:** ADR-042 Faz 1'in kalan adımları (API guard + web + mobil OTA, tek seferde) · `#742` Yenile düğmesi görünür geri bildirim. Faz 1 **bitti**; tenant artık işletme kodundan çözülüyor.

| # | İş | Durum |
|---|---|---|
| 1 | ✅ **Ajan kimliği prod'da DOĞRULANDI** (2026-10-13 09:08 TR) | Dükkan PC'si açıldığında: `POST /api/print/v1/agent/register` → **200** (tam #727'nin değiştirdiği register Faz 3 yolu) · ardından üç kind için kesintisiz `GET /jobs/next` → **204** long-poll · üç ajanın da `last_seen_at`'i **12 sn** (bu alanı yalnız BAŞARILI kimlik doğrulamadan sonra `print-agent-auth` yazar → doğrudan kanıt) · API hata logunda yeni satır yok. Fail-closed riski **kapandı**, geri alma gerekmedi |
| 2 | ✅ **ADR-004 Amd14 K4 KAPANDI** (2026-10-13 09:31 TR) | `bootstrap-initial` satırı kilitlendi (`install_leftover`). Negatif kontrol: üç çalışan yazıcı kilitlemeden sonra da 21-22 sn tazelikte ve `204` long-poll'da. ⚠️ Elle SQL ile yapıldığı için `audit_logs`'ta karşılığı **yok** — gerekçesi ADR-004 Amd14 as-built notunda |
| 3 | **K8 izleme penceresi** — `/auth/*` 429 gözlemi | ✅ Sağlıklı koşuyor: timer canlı, sağlıklı günler **kaydediliyor**, ham access log'da gerçekten 0 adet 429 (akıl sağlığı kontrolü tuttu). **2026-10-18'de kapat:** `systemctl disable --now auth-429-watch.timer` + sonucu `docs/ops/deploy.md` §10.1'e yaz |
| 4 | **[USER] Play Store** | Üretim sayfası 404, kapalı test açık, *"Üretime başvur"* bekliyor. Claude Google hesabına giremez |

**Chip kuyruğu (4):** yazıcı kayıt anahtarı rotasyonu (ADR-004 Amd14 **K3** — ortak sır hâlâ tek hash, asıl zorluk cutover) · kilit ekranına yetim-iş sayısı + kilit gerekçesi (yeni DTO alanı `pinnedPendingJobs` gerekiyor; ⚠️ `queueDepths` o sayı **değildir**) · 27 Eylül'deki 4 adet `23514` · **Yenile refetch HATASINDA geri bildirim yok** (#742 kapsam dışı — saatin sabit kalması dolaylı ipucu, yeterli değil; toast önerildi ama #709'da teslimat toast'ı ürün sahibince kaldırılmıştı → ayrı ürün kararı).

## Sıradaki program — çoklu şubeye geçiş

**Yol planı:** [`docs/roadmap-v51-coklu-sube.md`](../../docs/roadmap-v51-coklu-sube.md) — DD'nin kalan maddeleri + çoklu-şube ön-koşulları, bağımlılık sırasına göre 5 faz.

**✅ BİTTİ: Faz 1 — tenant çözümü (MIM-7 gövdesi), ADR-042 (Accepted).** Sunucu tarafı (adım 1-2) yazıldı: mig 068 + `auth/tenantResolution.ts` + login/logout/refresh/rate-limit bağlandı. Kapılar koştu — `security-reviewer` BLOCKER buldu (düzeltildi, negatif kontrollü), `db-migration-guard` GO verdi (3 düzeltmeyle). ✅ **Adım 1-2-3 TAMAM — 2026-10-14 10:08 TR prod'da, canlı veriyle doğrulandı.** 45 dakikada: **8 token üretildi, 7'si rotasyonla** (`parent_id` dolu), **7 `rotated` iptali**, **1 `logout`**, **`reuse_detected` = 0** → RTR zinciri yeni token biçimiyle sağlam; önek işleme yanlış olsaydı sahte reuse alarmı aileleri topluca iptal ederdi. `auth.refresh.legacy_unprefixed` = 2 → **geriye uyumluluk prod'da kanıtlandı** (deploy öncesi oturumlar ilk yenilemede öneksiz yoldan geçti). Deploy sonrası **yeni hata yok** (son hata-seviyesi kayıt 27 Eylül'den, ayrı küme → `task_0c9d7d95`). Baskı etkilenmedi: 3 yazıcı bağlı, 45 dk'da 2 iş.

✅ **Adım 4 TAMAM** (#738 web · #739 mobil) · ✅ **Adım 5 TAMAM** (guard dönüştürüldü; rate-limit 2× bütçe artığı kapandı).

✅ **TEK SEFERDE DEPLOY TAMAM (2026-10-16).** API `f4a7cc2` (pm2 restart #221; açılışta `tenant-resolution guard OK`, `tenantCount:1`, restart sonrası hata yok) · web yeni bundle (yayındaki dosyada `İşletme kodu (isteğe bağlı)` string'i doğrulandı) · mobil **EAS OTA** grup `5553f693`, runtime 1.0.0, kanal↔branch teyitli. [USER] duman testi DB'de sayıldı: `rotated` 5 · `logout` 2 · **`reuse_detected` 0**. Deploy öncesi `TENANT_ID` fail-fast koşulu da doğrulandı (env → `dilan-pide`, aktif).

⏳ **Açık [USER] cihaz testi:** panel açıldığında işletme kodu alanı klavyenin altında kalıyor mu (RN `KeyboardAvoidingView` tuzağı, Android + iOS ayrı). **İddia edilmedi, kodda doğrulanamaz.**

✅ **Faz 2 — izole demo tenant (ADR-043) PROD'DA CANLI (2026-10-17).** `demo` / `d8f1ef71-6e1a-432c-9f75-a34d010cbfec` · 2 bölge · 10 masa (bölge içi 1-6 / 1-4) · 4 kategori · 15 ürün · 1 admin + 1 garson · **0 sipariş, 0 müşteri**. Canlı katalog bit-bit aynı (2/60/10/98/6), API **hiç yeniden başlamadı** (restart 221), hata yok.

**İzolasyon ölçülerek kanıtlandı:** `app_tenant` rolü altında, `tenant_id` yüklemi **olmadan** → demo context'i 15 ürün / 0 sipariş / 0 müşteri; canlı context'i aynı bağlantıda 98 ürün / 4139 sipariş. Yani sıfırlar "sessiz sıfır" değil, süzmeyi RLS yapıyor.

**K5 bariyeri prod'da, gerçek canlı tenant'a karşı denendi** (iki emniyetle: `--dry-run` + şifresiz): `TENANT_ID` yokken `exit 2`; varken canlı tenant'ı adıyla tanıyıp reddetti, hiçbir şey yazmadı.

🔴 **Açık [USER] maddeleri — sırası BAĞLAYICI (K6):** ① cihaz duman testi (işletme kodu `demo`, gerçek telefon; ayrıca klavye/alan sorusu Faz 1'den devrediyor) → ② mağaza konsolları (kimlikler sunucuda `/root/demo-tenant-credentials.txt`, chmod 600) → ③ **ancak sonra** canlı tenant'taki eski demo hesabı kapat.

⚠️ İkinci şube ayrıca **Faz 3'ü** bekler (print-agent kaydolamaz, `MIM-7b`). ⚠️ `bootstrap-prod.ts`'in çıktısındaki *"TENANT_ID=… api.env'e ekle + pm2 restart"* talimatı **ikinci tenant'ta uygulanmaz** — uygulanırsa canlının varsayılan tenant'ı demo olur.


## Backlog (aciliyeti ölçülmüş, bekliyor)

- **İstemci refresh backoff'u** — ADR-002 Amd8 C-2'nin asıl çaresi. `/refresh` fırtınası taban kovayı tüketip girişi de kilitleyebilir; kurtarma tek komut olduğu için kabul edildi. Aynı aile: Amd7 C-1 (ağ hatasından sonra proaktif retry) — **ölçüldü, gerçekleşmemiş**: `reuse_detected` prod'da 10'da sabit, sonuncusu 2026-09-26. İkisi tek ADR'de ele alınmalı.
- **v5.1'e ertelenenler (ADR-002 §14.9):** WAF/fail2ban/Nginx `limit_req`, Redis rate-limit store, account lockout/CAPTCHA/2FA, limiter bypass guard'ının paylaşımlı modüle çıkarılması.
- **Eski v5.1 kuyruğu:** `docs/audit/low-nit-devir.md`, unused-exported-types temizliği, ADR-032 Dilim C/D/E, kişi-bazlı `cashier` rolü.

## Değişmeyen kurallar

- **Deploy GitHub merge ile OLMAZ** — `git push prod main` + sunucuda pull/build/`pm2 restart` (`docs/ops/deploy.md` §4). Atlanırsa sunucu eski commit'te kalır.
- **main'e doğrudan push yasak** — PR + `ci` + `Playwright Smoke`.
- **Prod'a YAZMA Auto kipinde reddedilir** — kullanıcı kipi değiştirmeli (okuma serbest).
- **Migration'lı deploy:** önce yedek; canlı-veri index'leri restoran kapalıyken.
