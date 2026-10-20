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

## Açık iş (2026-10-17 itibarıyla)

**Prod'daki kod = `4b921b0`** (2026-10-17). `main` bundan ileride olabilir ama yalnız **doküman** commit'leriyle — kod farkı varsa deploy borcu var demektir, `git log 4b921b0..main --oneline` ile bak.

✅ **Prod = `acdf5df`, deploy borcu YOK** (2026-10-17 10:47 TR, `#746` indi — pm2 restart **222**).

**`#746` deploy kaydı:** API-only (migration yok, web/mobil değişmedi, ADR-006 yanıt kontratı değişmedi). Akış: `git push prod main` → sunucuda `git pull origin main` → `pnpm install --frozen-lockfile` → `pnpm --filter @restoran-pos/shared-types build` (runbook ŞART'ı; bu PR'da shared-types değişmedi ama adım atlanmaz) → `pm2 restart pos-api`. Smoke: `/api/health` ok · web 200 · socket.io `0{"sid":…}` · diskteki kodda `describePgError` ×3 + `KEY_DETAIL_CODES` ×2 (**string'le doğrulandı**) · restart'tan sonra `level:50` kaydı **0**. `packages/db` dist üretmez (`main: ./src/index.ts`, build = `tsc --noEmit`) → ek build gerekmedi.

⚠️ **Pre-flight bulgusu:** prod çalışma ağacında `apps/api/scripts/ops/auth-429-watch.sh` **modified** görünüyor — tek fark `chmod +x` (mod 100644→100755), içerik aynı. Pull'u engellemedi. Repo'da da executable olması gerekir; ayrı küçük iş.

⚠️ **Açılışta yeni bir WARN (level:40) — `#746` ile ilgisi YOK:** `[api] tenant-resolution guard: çok tenant + varsayılan-tenant fallback açık — istemciler işletme kodu göndermiyorsa yanıltıcı 401 doğar`, `tenantCount: 2`. Sebep: demo tenant 2026-10-17'de açıldı ama API o gün **hiç yeniden başlamamıştı**; bu, iki tenant'ı gören **ilk açılış**. ADR-042 Faz 1 adım 5'in tasarlanmış uyarısı, hata değil. Yine de [USER] cihaz testini doğrudan ilgilendirir: işletme kodu **göndermeyen** bir istemci yanıltıcı 401 alabilir.

**Prod'a inenler:** 2026-10-16 — ADR-042 Faz 1'in kalan adımları (API guard + web + mobil OTA, tek seferde) · `#742` Yenile düğmesi görünür geri bildirim. 2026-10-17 — `#743` ADR-043 + demo tenant tohumlama script'i; demo tenant prod'da **açıldı ve tohumlandı** (API restart'ı gerekmedi). Faz 1 **bitti**, Faz 2 **bitti**.

| # | İş | Durum |
|---|---|---|
| 1 | ✅ **Ajan kimliği prod'da DOĞRULANDI** (2026-10-13 09:08 TR) | Dükkan PC'si açıldığında: `POST /api/print/v1/agent/register` → **200** (tam #727'nin değiştirdiği register Faz 3 yolu) · ardından üç kind için kesintisiz `GET /jobs/next` → **204** long-poll · üç ajanın da `last_seen_at`'i **12 sn** (bu alanı yalnız BAŞARILI kimlik doğrulamadan sonra `print-agent-auth` yazar → doğrudan kanıt) · API hata logunda yeni satır yok. Fail-closed riski **kapandı**, geri alma gerekmedi |
| 2 | ✅ **ADR-004 Amd14 K4 KAPANDI** (2026-10-13 09:31 TR) | `bootstrap-initial` satırı kilitlendi (`install_leftover`). Negatif kontrol: üç çalışan yazıcı kilitlemeden sonra da 21-22 sn tazelikte ve `204` long-poll'da. ⚠️ Elle SQL ile yapıldığı için `audit_logs`'ta karşılığı **yok** — gerekçesi ADR-004 Amd14 as-built notunda |
| 3 | ✅ **K8 izleme penceresi KAPANDI** (2026-10-19 07:49 UTC) | 10-11 → 10-19 arası **10 ölçüm, hepsi `PASS`**, her birinde `restoran=0 diger=0 toplam=0` → ölçüt "7 günde ≥2 olay"dı, gerçekleşen **0**, rollback gerekmedi. Kapanıştan önce script elle koşuldu (exit 0). `systemctl disable --now auth-429-watch.timer` → `inactive` + `disabled` doğrulandı. ⚠️ **`.service` birimi silinmedi** — şüphede elle koşulabilir. Kayıt: `docs/ops/deploy.md` §10.1 |
| 4 | ✅ **27 Eylül'deki 4 adet `23514` TEŞHİS EDİLDİ** (2026-10-17) | Dördü de `#674` ile kapatılan müşteri silme bug'ı — kısıt `orders_takeaway_customer_when_takeaway` (mig 031). Kanıt: hepsi `pid 1569964` penceresinde (09:31 RLS deploy'u → 12:26 düzeltme deploy'u arası), log'un **tüm geçmişinde** tam 4 adet, 12:26'dan sonra sıfır. **Yeni iş çıkmadı**, düzeltme yapısal. ⚠️ Route düzeyinde doğrudan kanıt **yok** (nginx log'u 3 Ekim'e kadar gidiyor) → `docs/audit/23514-teshis-2026-09-27.md` |
| 5 | ✅ **F1 KAPANDI — 5xx log'u teşhis edilebilir** (`#746`, 2026-10-17) | `errorHandler` artık `method` + `route` (path şablonu, ham URL değil) + `tenantId`/`userId` + `pg.{code,constraint,table}` basıyor. Güvenlik kapısı **gerçek bir HIGH** buldu: `23514`/`23502`'de PG `detail`'i `Failing row contains (3, 05551234567, Ahmet Yılmaz, …)` — satırın tamamını — gönderiyor; eski kod bunu yalnız regex eşleşmediği için basmıyordu (**negatif güvence**). Artık `KEY_DETAIL_CODES` pozitif allowlist (`detail` yalnız 23505/23503/23P01'de okunur), negatif kontrollü. Testler 6/6. ✅ **Prod'da** (2026-10-17 10:47 TR, restart 222) |
| 7 | ✅ **ÇÖZÜLDÜ (2026-10-20) — Android telefon güncel sürüme alındı.** Yeni APK build'i alındı (`ede3a4bb`, commit `269b0e7`, **runtime 1.0.0**), telefona kuruldu, garson hesabıyla giriş **sorunsuz**. Artık OTA akışında → bir daha donmaz. ⚠️ Kurulumla birlikte **yeni bir UI sorunu görüldü** — aşağıdaki chip'e bakın. Aşağıdaki satır bulgunun kaydıdır |
| 7b | 🔴 **BULGUNUN KAYDI — telefon 2 AYDIR DONMUŞTU** (2026-10-20) | Telefondaki APK **runtime `0.0.1`** (ürün sahibi uygulamadan okudu: *"sürüm 0.0.1, güncelleme 55e1b8f3"*). Tüm OTA'lar **`1.0.0`**'a yayınlanıyor → **runtime uyuşmadığı için o cihaz hiçbir güncellemeyi almıyor**, 20 Ağustos'tan beri. EAS kanıtı: 20.08 `production` profili APK = runtime 0.0.1 · 03.09 `store` profili = runtime 1.0.0. **14 mobil değişiklik kaçtı**, ikisi ürün sahibinin fark ettiği şeyler: **paket sipariş oluşturma** (24 Ağu, ADR-039 — APK'dan 4 gün sonra) ve **"Ara" butonu** (27 Eyl, `#672`). ⚠️ Ayrıca o telefonda **çıkış token'ı iptal etmiyor** (`#698` yok) ve **işletme kodu alanı yok** (`#739` yok → iki tenant varken yalnız ana işletmeye girebilir). **Çözüm:** telefonu Play kapalı testine al (`https://play.google.com/apps/testing/com.restoranpos.garson`) → oradaki sürüm 1.0.0, kurulunca bekleyen tüm OTA'ları ilk açılışta çeker (iOS'ta S117'de aynı yöntemle çözüldü). Alternatif: yeni APK build + elle kurulum, ama Play yolu kalıcı |
| 6 | ✅ **PLAY ÜRETİM SÜRÜMÜ İNCELEMEYE GÖNDERİLDİ** (2026-10-20) | Alpha'daki `1 (1.0.0)` üretime yükseltildi, **tam kullanıma sunma**. Gönderilen üç değişiklik: sürüm + *"177 ülke/bölge ekle"* + *"Dünyanın geri kalanını ekle"*. İnceleme **genellikle ≤7 gün**. ⚠️ **Ülke kararı ürün sahibinin:** tüm ülkeler seçildi (**178**). Claude yalnız-Türkiye önermişti (App Store'da DSA beyanı yüzünden Türkiye'ye kısıtlanmıştı — `project_app_store_live`); ürün sahibi tüm dünyayı seçti, karar kaydedildi. Play'in kendisi de AB uyarısını gösterdi: *"AB'de uygulama dağıtıyorsanız (AB) 2018/302 Coğrafi Engelleme Yönetmeliği'ne göz atın"*. ⚠️ İleride Google **DSA tüccar bilgisi** (ad/adres/telefon) isteyebilir. Zararsız uyarı: ProGuard eşleme dosyası yok (yalnız çökme okunabilirliği). Ayrıca inceleme notuna *"Oturum açma bilgileri talimatları güncellenecek"* maddesi eklendi (10-19'daki demo kimliği değişikliği) |
| 6b | **[USER] Play — yayın sonrası** | İnceleme bitince telefon **Play'den güncellenmeye** başlar; elle APK kurma ve runtime donması sınıfı tamamen kapanır (bkz. 7b) | ✅ **Üretim erişimi onaylandı** (başvuru yapıldı, Google onayladı — kontrol panelindeki onay kutusu). ❌ Uygulama **üretimde yayında değil**: kanal "Etkin değil", durum "Kapalı test". Kalan iş: *"Ülke ve bölge seçin"* → *"Yeni sürüm oluşturun"* → *"Sürümü inceleyin ve onaylayın"*; o sürüm normal incelemeye girer ve incelemeci **"Oturum açma bilgileri"** alanındaki kimlikle girer (2026-10-19'da demo hesabına çevrildi). ⚠️ Detay ve düzeltme notu aşağıda "Play Store gerçeği" paragrafında |

**Mağaza kimlikleriyle ilgili üç yeni chip (2026-10-19):**

- ✅ **ÇÖZÜLDÜ (2026-10-19) — ASC Notes metni yenilendi ve CANLI.** Eski metin Apple'a *"düşük yetkili bir **'garson'** rolünde demo hesap"* diyordu; kimlik admin'e geçince bu **yanlış beyana** dönüşmüştü. Yeni metin ASC'ye uygulandı, sayfa yeniden yüklenerek doğrulandı (sayaç 3.498 → **3.163**, *"garson"* ibaresi yok, Sign-İn alanlarına dokunulmadı). Metnin kendisi `docs/mobile/store-listing-draft.md` §7'de. İki bilinçli karar: **rol adı hiç geçmiyor** (rol yazılırsa hesap her değiştiğinde metin bayatlar) ve demo tenant'ın **boş** olduğu açıkça söyleniyor (incelemeci boş sipariş listesini "çalışmıyor" sanmasın — Guideline 4.2).
- ✅ **ÇÖZÜLDÜ (2026-10-19) — Play "Oturum açma bilgileri".** Korku doğruydu: alanda gerçekten **canlı tenant'ın** `demo.garson@restoranpos.org` hesabı duruyordu. `demo-admin@demo.local` ile değiştirildi ve teyit edildi. Sayfanın yeri + ad değişikliği yukarıdaki ② maddesinde kayıtlı.
- ⚠️ **Print-agent API anahtarı sohbete düştü (2026-10-18).** Kimlik dosyası ekrana basılırken parolalar maskelendi ama **demo tenant'ının** print-agent anahtarı maskesiz geçti. Canlı baskıyı etkilemez (demo tenant'ın anahtarı). Ürün sahibi *"sonra bakarız"* dedi. Yenileme reçetesi: demo tenant'ın `agents` satırını revoke et → bootstrap script'ini yeniden koş → yeni anahtarı dükkân PC'sindeki `print-agent.json`'a gir. ⚠️ Demo tenant'ın `agents` satırını **kalıcı iptal etme** — kayıt akışı `revoked_at IS NULL` süzüyor, iptal kalırsa o tenant'ta bir daha ajan kaydolamaz (Faz 3 test yatağı ölür).

🔴 **YENİ CHIP (2026-10-20) — Android'de kategori ve yazı boyutları bozuk.** Ürün sahibi güncel APK'yı kurar kurmaz gördü: *"kategori ve yazı boyutları kötü ve arızalı"*. İş ertelendi ("daha sonra çözeceğiz") ama başlangıç noktası net:

- **Nereye bakılacak:** `apps/mobile/src/features/orders/components/CategoryGrid.tsx` → `IS_ANDROID` dalı (`minHeight` 52 vs iOS 64, `paddingHorizontal/Vertical`, `numberOfLines={2}`, `fontSize` hesabı).
- **Neden bozuldu — kök sebep muhtemelen bu:** o dal **5-6 Ağustos 2026'da** dört ayrı denemeyle kalibre edildi (`#526`, `#528`, `#53x` — "gerçek Android font metriğine göre yeniden kalibrasyon", "dikey yüksekliği küçült"). Ardından **20 Ağustos'ta tek Android cihaz dondu** (7b). Eylül'deki görsel revamp (`#672` Mutfak iki sekme + revamp, `#675` kart yerleşimi) Android'de **hiç görülmedi** — kalibrasyon revamp öncesi UI'a göre ayarlı kaldı. iOS'ta sorun çıkmadı çünkü iOS dalı cutover-orijinal değerlerde.
- ⚠️ **Düzeltirken uyulacaklar:** ölçüyü **gerçek kutucuktan** kalibre et, tahminle değil ([[feedback_rn_text_fit_calibrate_from_tile]]) · ergonomik sabitleri değiştirmeden **önce görünümü ürün sahibine göster** — dokunma hedefi büyütme ölçüleri doğru olduğu hâlde görsel olarak reddedilmişti ([[feedback_touch_target_is_ergonomic_constant]]) · UI PR'ı → `hci-reviewer` + `turkish-ux-reviewer` kapısı zorunlu.
- **Eksik girdi:** ekran görüntüsü. Düzeltmeye başlamadan önce ürün sahibinden Android'deki görünüm istenmeli; kod okuyarak "kötü duruyor" doğrulanamaz.

**Chip kuyruğu (6, yukarıdaki üçü hariç):** yazıcı kayıt anahtarı rotasyonu (ADR-004 Amd14 **K3** — ortak sır hâlâ tek hash, asıl zorluk cutover) · kilit ekranına yetim-iş sayısı + kilit gerekçesi (yeni DTO alanı `pinnedPendingJobs` gerekiyor; ⚠️ `queueDepths` o sayı **değildir**) · **5xx log'unda route mount öneki YOK** (`#746` bilinen sınırı: app seviyesi error middleware'inde `req.baseUrl` boş → `/:id/items` basar, `/orders` öneki yok. **Gerçek Express 5.2.1 ile ölçüldü**, varsayım değil. Tam öneki basmak route-match anında yakalayan ayrı middleware gerektirir; `req.originalUrl` PII taşıdığı için ham basılamaz) · **PM2 log retention — ÖLÇÜLDÜ + BELGELENDİ, politika [USER] kararı bekliyor** (`deploy.md` **§9.1**; `#746` kapısının H-2 bulgusu. Ölçüm: `pm2-logrotate` **kurulu değil**, sistem logrotate kuralı **yok** → log'lar 4 Tem'den beri hiç dönmüyor. ⚠️ Risk **disk değil** — 107 günde 812 KB, disk %17 — **veri saklama**: `#746`'dan beri 5xx satırında `tenantId`/`userId` var. Öneri komutları runbook'ta, **üretimde uygulanmadı**. ⚠️ Pencereyi kısaltmak **teşhis gücünü de kısaltır**: S145'teki `23514` teşhisi log'un Temmuz'a kadar gitmesi sayesinde kapanmıştı; nginx tarafında (14 gün) tam tersi yaşandı, route atfı imkânsızdı) · **`unattended-upgrades` gün içinde Postgres'i yeniden başlatabiliyor** (`docs/audit/23514-teshis-2026-09-27.md` F3; pencereyi yoğun saat dışına sabitle — ürün sahibi kararı) · **Yenile refetch HATASINDA geri bildirim yok** (#742 kapsam dışı — saatin sabit kalması dolaylı ipucu, yeterli değil; toast önerildi ama #709'da teslimat toast'ı ürün sahibince kaldırılmıştı → ayrı ürün kararı).

## Sıradaki program — çoklu şubeye geçiş

**Yol planı:** [`docs/roadmap-v51-coklu-sube.md`](../../docs/roadmap-v51-coklu-sube.md) — DD'nin kalan maddeleri + çoklu-şube ön-koşulları, bağımlılık sırasına göre 5 faz.

**✅ BİTTİ: Faz 1 — tenant çözümü (MIM-7 gövdesi), ADR-042 (Accepted).** Sunucu tarafı (adım 1-2) yazıldı: mig 068 + `auth/tenantResolution.ts` + login/logout/refresh/rate-limit bağlandı. Kapılar koştu — `security-reviewer` BLOCKER buldu (düzeltildi, negatif kontrollü), `db-migration-guard` GO verdi (3 düzeltmeyle). ✅ **Adım 1-2-3 TAMAM — 2026-10-14 10:08 TR prod'da, canlı veriyle doğrulandı.** 45 dakikada: **8 token üretildi, 7'si rotasyonla** (`parent_id` dolu), **7 `rotated` iptali**, **1 `logout`**, **`reuse_detected` = 0** → RTR zinciri yeni token biçimiyle sağlam; önek işleme yanlış olsaydı sahte reuse alarmı aileleri topluca iptal ederdi. `auth.refresh.legacy_unprefixed` = 2 → **geriye uyumluluk prod'da kanıtlandı** (deploy öncesi oturumlar ilk yenilemede öneksiz yoldan geçti). Deploy sonrası **yeni hata yok** (son hata-seviyesi kayıt 27 Eylül'den, ayrı küme → `task_0c9d7d95`). Baskı etkilenmedi: 3 yazıcı bağlı, 45 dk'da 2 iş.

✅ **Adım 4 TAMAM** (#738 web · #739 mobil) · ✅ **Adım 5 TAMAM** (guard dönüştürüldü; rate-limit 2× bütçe artığı kapandı).

✅ **TEK SEFERDE DEPLOY TAMAM (2026-10-16).** API `f4a7cc2` (pm2 restart #221; açılışta `tenant-resolution guard OK`, `tenantCount:1`, restart sonrası hata yok) · web yeni bundle (yayındaki dosyada `İşletme kodu (isteğe bağlı)` string'i doğrulandı) · mobil **EAS OTA** grup `5553f693`, runtime 1.0.0, kanal↔branch teyitli. [USER] duman testi DB'de sayıldı: `rotated` 5 · `logout` 2 · **`reuse_detected` 0**. Deploy öncesi `TENANT_ID` fail-fast koşulu da doğrulandı (env → `dilan-pide`, aktif).

⏳ **Açık [USER] cihaz testi:** panel açıldığında işletme kodu alanı klavyenin altında kalıyor mu (RN `KeyboardAvoidingView` tuzağı, Android + iOS ayrı). **İddia edilmedi, kodda doğrulanamaz.**

✅ **Faz 2 — izole demo tenant (ADR-043) PROD'DA CANLI (2026-10-17).** `demo` / `d8f1ef71-6e1a-432c-9f75-a34d010cbfec` · 2 bölge · 10 masa (bölge içi 1-6 / 1-4) · 4 kategori · 15 ürün · 1 admin + 1 garson · **0 sipariş, 0 müşteri**. Canlı katalog bit-bit aynı (2/60/10/98/6), API **hiç yeniden başlamadı** (restart 221), hata yok.

**İzolasyon ölçülerek kanıtlandı:** `app_tenant` rolü altında, `tenant_id` yüklemi **olmadan** → demo context'i 15 ürün / 0 sipariş / 0 müşteri; canlı context'i aynı bağlantıda 98 ürün / 4139 sipariş. Yani sıfırlar "sessiz sıfır" değil, süzmeyi RLS yapıyor.

**K5 bariyeri prod'da, gerçek canlı tenant'a karşı denendi** (iki emniyetle: `--dry-run` + şifresiz): `TENANT_ID` yokken `exit 2`; varken canlı tenant'ı adıyla tanıyıp reddetti, hiçbir şey yazmadı.

✅ **ADR-043 K6 ZİNCİRİ TAMAMLANDI (2026-10-19).** ① cihaz girişi → ② iki mağaza konsolu → ③ eski hesap kapatıldı. Sıra bozulmadı.

**① Cihaz girişi** — demo tenant'ına gerçek istemciden giriş `refresh_tokens`'ta kanıtlı (garson 10-17 ×2, 10-18; admin 10-18 API probe'u). ⚠️ **Ekran teyidi ve klavye sorusu hâlâ cevapsız** — 10 masa mı 60 mı görüldüğü, ve kod alanının klavye altında kalıp kalmadığı [USER]'dan gelmedi. İkisi de kod okunarak doğrulanamaz.

**② İki mağaza konsolu da demo kimliğine geçti.** Her ikisinde de **`demo-admin@demo.local`** yazıyor (ürün sahibinin kararı: iki konsolda aynı hesap = tek şifre, tek yerden döndürülür). Doğrulandı: ASC → App Review Information → Sign-In Information; Play → aşağıdaki yol.

> 📍 **Play'de bu alanın yeri (bulmak 10+ deneme sürdü, kaydediliyor):** sol menü **İzleyin ve geliştirin → Politika ve programlar → Uygulama içeriği** → listede **"Oturum açma bilgileri"** → **Yönet**. URL: `/app-content/testing-credentials`. ⚠️ Adı **değişmiş** — sayfanın kendisi *"Bu beyanın önceki adı 'Uygulama erişimi' idi"* diyor, bu yüzden "App access" diye aramak sonuç vermiyor. `/app-content`, `/policy/app-content`, `/app-content/access-and-restrictions` **hepsi uygulama listesine düşüyor**; çalışan tek giriş `/app-content/overview`.
>
> 🔴 **Bulunduğunda içinde ESKİ hesap yazıyordu:** `demo.garson@restoranpos.org` — yani canlı tenant'ın hesabı. Üretim incelemesi o anda yapılsaydı Google **gerçek restoranı** görecekti.

**③ Eski hesap kapatıldı — SİLİNMEDİ** (2026-10-19 11:57 UTC). `demo.garson@restoranpos.org` (`b5c81767…`, `waiter`, `dilan-pide`, 2026-08-25'te açılmış).

- ⚠️ **Neden silinmedi:** bu hesap canlıda **6 gerçek siparişin garsonu** (`orders.waiter_user_id`). Satır silinseydi o altı siparişin kim-aldı bilgisi bozulurdu.
- **Yapılan:** `password_hash` **kimsenin bilmediği** rastgele bir değerle değiştirildi (48 bayt rastgele → bcrypt cost 12; üretildiği süreçte kullanıldı, **hiçbir yere yazılmadı/basılmadı**) + açık `refresh_tokens` satırları `revoked_at` ile iptal edildi.
- **Doğrulama:** hash değişti (`$2a$12$K9e…` → `$2a$12$cEC…`, `updated_at` 2026-09-03 → 2026-10-19) · hesap satırı **duruyor** · 6 siparişin atfı **korundu** · oturumlar **0 açık / 2 iptal** · demo tenant hesapları **etkilenmedi** · api/web 200.
- **Geri alma:** gerekirse hesaba yeni bir parola atanır (eski parola kurtarılamaz, kasten).
- ⚠️ **Elle SQL ile yapıldı → `audit_logs`'ta karşılığı YOK** (ADR-004 Amd14 K4'teki aynı durum). Gerekçesi bu paragraf.
- ℹ️ Kapatmadan önce ölçüldü: hesabın iki oturumu da **2026-10-03'te zaten süresi dolmuştu**, yani kapatma anında açık oturum yoktu — acil bir sızıntı penceresi oluşmamıştı.

⚠️ **Kalan küçük tutarsızlık:** ASC'deki Notes metni Apple'a hâlâ *"düşük yetkili **garson** rolünde demo hesap"* diyor, oysa iki konsolda da **admin** hesabı var. Demo tenant izole (0 sipariş, 0 müşteri) olduğu için risk dar; metin düzeltmesi ayrı iş.

✅ **① EKRAN TEYİDİ GELDİ (2026-10-20).** Ürün sahibi demo kimliğiyle gerçek telefondan girdi ve **toplam 10 masa** gördü — demo işletmenin tam sayısı (İç Salon 6 + Bahçe 4). Canlı tenant'ta 60 masa var; 60 görülseydi izolasyon kırık demekti. **Böylece izolasyon yalnız sunucuda (RLS + `refresh_tokens`) değil, gerçek istemci ekranında da kanıtlandı** — ADR-043'ün asıl iddiası buydu. ✅ **Klavye/alan sorusu da KAPANDI (2026-10-20):** ürün sahibi kontrol etti, **sorun yok** — işletme kodu alanı açılınca klavyenin altında kalmıyor. Bu, ADR-042 Faz 1'den beri açık duran ve **kodla doğrulanamayan** son maddeydi; `KeyboardAvoidingView`'ın bu ekranda doğru çalıştığı artık cihazda görülmüş sayılır. ⚠️ **Sınır:** teyit ürün sahibinin kendi telefonunda yapıldı; **iki platform ayrı ayrı denenmedi**. Projenin kayıtlı dersi (`feedback_rn_modal_layout_traps`) iOS'ta çalışanın Android'de çalışmayabileceğini söylüyor — diğer platformda bir şikâyet gelirse önce burası bakılır.

**① giriş tarafı (2026-10-19) — kanıt zinciri.** Demo tenant'ına gerçek istemciden yapılan girişler `refresh_tokens`'ta duruyor: `demo-garson@demo.local` (waiter) 10-17 13:22 · 10-17 14:34 · 10-18 06:20; `demo-admin@demo.local` (admin) 10-18 06:42 (Claude'un teşhis probe'u, hemen iptal edildi). Demo tenant hâlâ **0 sipariş**, 10 masa. ⚠️ **Eksik olan tek şey ekranda ne göründüğü** — 10 masa mı (İç Salon 6 + Bahçe 4) yoksa 60 mı; bunu kod okuyarak doğrulamak mümkün değil. Klavye/alan sorusu da hâlâ cevapsız.

**Admin girişinin "çalışmıyor" sanılması çözüldü:** sunucu tarafı sağlam — API'ye doğrudan istek atıldı, **HTTP 200**, demo tenant + `admin` rolü döndü. `bcryptjs` karşılaştırmasıyla **dosyadaki her iki parolanın da DB hash'leriyle eşleştiği** doğrulandı. Sebep yazım/kopyalama: dosya biçimi `admin_password=<24 karakter>` — `=` işaretinden **sonrası** kopyalanmalı, önek dahil edilmemeli.

**Play Store gerçeği (2026-10-19, kontrol panelinden okundu — DÜZELTİLDİ):**

✅ **ÜRETİM ERİŞİMİ ONAYLANDI.** Kontrol paneli → "Sürüm oluşturma ve yayınlama" kartında birebir şu yazıyor: *"Tebrikler! Uygulamanıza Google Play üretim erişimi verildi — Uygulamanız için Google Play üretim erişimine başvurmuştunuz. Başvurunuz onaylandı."* Yani kişisel-hesap kuralının **12 testçi × 14 gün** koşulu geçildi, *"Üretime başvur"* yapıldı ve Google onayladı. Ürün sahibinin aldığı *"onaylandı"* maili budur.

❌ **Ama uygulama üretimde YAYINDA DEĞİL.** Üretim kanalı hâlâ **"Etkin değil"**, uygulama durumu **"Kapalı test"**, Yayın özeti "Yayınlanmamış değişiklik yok", son yayınlanma 14 Eyl 2026. Kapı açıldı, içeri girilmedi.

**Kalan iş:** Üretim kanalına sürüm oluşturup kullanıma sunmak. Kontrol panelinin görev listesi üç adım veriyor: *"Ülke ve bölge seçin"* → *"Yeni sürüm oluşturun"* → *"Sürümü inceleyin ve onaylayın"*. Bu sürüm **normal uygulama incelemesinden** geçecek — ve incelemeci **App access** alanındaki kimlikle girecek (bkz. yukarıdaki chip; o alan hâlâ okunmadı).

> ⚠️ **Bu paragraf 2026-10-19'da düzeltildi.** `#750`'de yanlış yazılmıştı: *"üretim incelemesi henüz hiç olmadı ve Üretime başvur yapılmadı"*. Hata, yalnız kanal sayfalarına + uygulama durumuna bakıp **kontrol panelindeki onay kutusunu görmemekten** kaynaklandı. Ders: Play'de "uygulama durumu" alanı **yayın durumunu** söyler, **erişim/izin durumunu değil**; ikisi ayrı ayrı okunmalı.

iOS üretimde canlı (2026-08-31).

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
