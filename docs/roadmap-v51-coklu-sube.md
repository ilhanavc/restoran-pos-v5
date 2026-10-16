# v5.1 Yol Planı — Çoklu Şubeye Geçiş ve Kalan Denetim Borçları

> **Durum:** 2026-10-13 (S142) · Kaynak: `docs/audit/dd-scope-triage.md` (satın-alma DD raporu) + B-planı kararı (S124, ürün sahibi)
> **Bu dosya ne DEĞİL:** mimari karar. Her faz **kendi ADR'siyle** açılır (Core Directive #2). Bu dosya yalnız **sıra** ve **gerekçe**.
> **Tek giriş kapısı:** o an üzerinde çalışılan faz `.claude/plans/active-plan.md`'de görünür.

## Neden bu sıra

Üç kısıt sıralamayı belirledi:

1. **Bağımlılık.** İzole demo tenant, tenant çözümü düzelmeden açılamaz. Ajan oto-güncelleme ile anahtar rotasyonu aynı kurulu `exe`'ye dokunuyor → tek cutover'da yapılmalı, yoksa dükkan iki kez kapanır.
2. **Canlı risk.** Auth ve agent-auth yolları **fail-closed**: yanlış değişiklik girişi ya da baskıyı **sessizce** durdurur. Bu yüzden ikisi de ayrı fazlarda, negatif kontrolle ve **restoran kapalıyken** iner.
3. **Değer.** İkinci şube **Faz 1 + Faz 3** bitmeden çalışamaz (giriş Faz 1'de, fiş baskısı Faz 3'te açılır); gerisi şube sayısı arttıkça acıyan kalemler.

## Kalemlerin bugünkü doğrulanmış durumu

S142'de koda karşı tarandı — dosya okumakla yetinilmedi (`dd-scope-triage.md`'nin kendi uyarısı). **2026-10-16'da tazelendi:** Faz 1 prod'a indi, ilk iki satır buna göre düzeltildi; sayılar prod'dan yeniden sayıldı (26 tablo `tenant_id`, 26'sı force-RLS).

| Kalem | Durum | Kanıt |
|---|---|---|
| DD **Kova A** (canlıyı ısıranlar) | ✅ 25/25 kapalı | triyaj dosyası |
| **MIM-1 · MIM-2 · VERI-1** (tenant izolasyon + RLS) | ✅ kapalı, prod'da | ADR-041, 26 tablo force-RLS, mig 054→065 |
| **MIM-7 gövdesi** (tenant çözümü, **insan-auth yarısı**) | ✅ **KAPALI, prod'da** (2026-10-16) | Faz 1'in beş adımı da indi. Dört pre-context noktası (`auth.ts` login + logout · `auth/refresh.ts` · rate-limit) artık tek `auth/tenantResolution.ts` modülünden çözülüyor. Canlı ölçüm: 45 dk'da 8 token, 7'si rotasyonla, **`reuse_detected` = 0** |
| İkinci şubenin **ajan kaydı** | 🔴 **AÇIK** (MIM-7'den ayrıldı) | `print-jobs.ts:657-680` öneki sunucu sabitiyle **karşılaştırıyor** → 2. şube ajanı 401 alır, fiş basamaz. Gövdesi **Faz 3** |
| **OPS-2** (ajan oto-güncelleme) | 🔴 **AÇIK** — kalan tek DD Kritik'i | `agent_version` / auto-update için kod tabanında **sıfır** eşleşme |
| **ADR-004 Amd14 K3** (kayıt anahtarı rotasyonu) | 🔴 AÇIK | prod: 4 ajan, `COUNT(DISTINCT api_key_hash) = 1` |
| İzole demo/test tenant | 🟠 **AKTİF** (Faz 2, ADR-043) | Play Store inceleyicisine giriş verilemiyor; sebep tek-tenant. Ön koşul (Faz 1 adım 4) **2026-10-16'da sağlandı** |
| SPOF · CD · Redis · down-migration | 🟡 bilinçli ertelenmiş | charter + DD Kova B/C |

---

## Faz 1 — Tenant çözümü (MIM-7 gövdesi) · **ADR-042 (Accepted, 2026-10-13)** · ✅ **BİTTİ, prod'da (2026-10-16)**

> **Karar:** giriş ekranında **işletme kodu** = `tenants.slug`. Prod slug'ı **`dilan-pide`** — zaten var, değişmiyor. Aynı e-posta iki şubede serbest (tenant-başı tekillik korunur). Faz sırası **1 → 2 → 3** değişmedi: Faz 2'nin demo tenant'ı Faz 3'ün **test yatağı** olacak, yani ikinci-tenant ajan kaydı canlı baskı yoluna dokunmadan kanıtlanabilir.

**Sorun.** Giriş akışı tenant'ı **sunucu sabitinden** alıyor (`deps.tenantId`). İkinci şube açıldığı an o şubenin personeli, kendi kaydı başka tenant'ta olduğu için **giriş yapamaz**.

⚠️ **DÜZELTME (ADR-042, 2026-10-13).** Bu dosyanın ilk hâli *"üç çağrı noktasından biri zaten çözülü"* diyordu. **Yanlıştı**, kodda doğrulandı:

- Pre-context nokta sayısı **üç değil DÖRT**: `POST /auth/logout` da (`routes/auth.ts:426`) tenant'ı sunucu sabitinden alıyor.
- Ajan kaydı tenant'ı **türetmiyor, KARŞILAŞTIRIYOR**: `routes/print-jobs.ts:657-680` istemcinin `pk_<8hex>_` önekini sunucunun kendi tenant önekiyle kıyaslıyor, eşleşmezse 401 (ADR-041 Amd7 K4(2) bunu bilinçle böyle yaptı). → **İkinci şubenin print-agent'ı bugünkü kodla kaydolamaz, o şubede fiş basılamaz.**

Dolayısıyla **"ikinci şubenin kapısı" fiilen Faz 1 + Faz 3'tür.** Faz 1 personelin giriş yapmasını sağlar; şubenin fiş basabilmesi Faz 3'ü bekler. Faz 1+2 kendi değerini (Play Store / demo tenant) tam üretir, çünkü demo tenant baskı gerektirmez.

Faz 1 kapsamındaki dört nokta:
- `routes/auth.ts` — login
- `routes/auth.ts:426` — logout (refresh token iptali)
- `auth/refresh.ts` — refresh rotasyonu
- `routes/print-jobs.ts` — ajan kaydı: bu fazda yalnız **ilke** kilitlenir (önek kapsam seçer, güven vermez); gövdesi Faz 3

**Emniyet zaten var:** `tenants` tablosunda birden fazla satır olunca boot'ta `logger.error` + Sentry (**M6 sunset guard**, ADR-041 Amd7 K4). Yani ikinci tenant eklenince sistem **sessizce yanlış çalışmaz**, gürültü çıkarır.

**ADR'de karara bağlanacaklar:**
1. Tenant **neyden** türetilir? (e-postadan mı, giriş ekranında işletme seçiminden mi, alt-alan adından mı)
2. Kullanıcı tekilliği: aynı e-posta iki şubede olabilir mi? `users` üzerindeki UNIQUE kısıtı buna göre.
3. Refresh token ailesi tenant'a nasıl bağlanır (ADR-002 RTR'ı bozmadan).
4. M6 guard'ı ne zaman ve neye dönüşür.

**Zorunlu kapılar:** `architect` (ADR) · `security-reviewer` (**auth kontratı — zorunlu**) · `db-migration-guard` (şema değişirse) · `qa-engineer` (çapraz-tenant izolasyon testi).

**Riskler:** 🔴 fail-closed — hatalı değişiklik **tüm girişleri** kapatır. Negatif kontrol testi zorunlu; deploy **restoran kapalıyken**. 🔴 RLS: her yeni sorgu `withTenant` ister, yoksa **sessiz `rowCount=0`**.

---

## Faz 2 — İzole demo / test tenant · 🟠 **AKTİF** · ADR-043 (2026-10-16)

Faz 1'in **üstüne** oturur; ondan önce yapılamaz. **Ön koşul 2026-10-16'da sağlandı** (ADR-042 K3 adım 4 — web + mobil işletme kodu alanı prod'da).

**Neden gerekli — iki ayrı sebep tek çözümde buluşuyor:**
- **Play Store:** Google'ın kendi yanıtı (S142, destek asistanı): *"Uygulamanız giriş gerektiriyorsa, inceleyenlerin test edebilmesi için **App access** bölümüne çalışan giriş bilgisi girmelisiniz."* Şu an giremiyoruz, çünkü çalışan her giriş **gerçek müşteri ve sipariş verisini** açar (KVKK).
- **Satış/demo:** ikinci işletmeye ürünü göstermenin yolu.

**Kapsam:** gerçek veriye dokunmayan, tohumlanmış bir tenant + o tenant'a bağlı demo hesap. RLS zaten canlı olduğu için izolasyonun **mekanizması hazır** — eksik olan tenant'ın kendisi ve tohum verisi.

**Çıktı:** Play Console → *Policy and programs > App content > App access* alanına girilecek çalışan kimlik bilgisi.

---

## Faz 3 — Ajan tenant çözümü (MIM-7b) **+** oto-güncelleme (OPS-2) **+** kayıt anahtarı rotasyonu (ADR-004 Amd14 K3)

**Bilerek tek faz.** Üçü de dükkandaki kurulu `exe`'ye dokunuyor. Ayrı yapılırsa restoran birkaç kez kapatılır ve ayrı ayrı cutover riski alınır.

> 🔧 **Kapsam düzeltmesi (2026-10-16).** Bu başlık MIM-7b'yi atlıyordu; oysa `docs/audit/dd-scope-triage.md:105` ve ADR-042 K5 (`decisions.md:19675`) onu **Faz 3'e** koyuyor. Üç belge arasında sapma vardı, burası eksik olandı.

**MIM-7b — ikinci şubenin print-agent'ı kaydolamaz.** `routes/print-jobs.ts` agent register tenant'ı **türetmiyor**, istemcinin `pk_<8hex>_` önekini **sunucu sabitiyle karşılaştırıyor** (ADR-041 Amd7 K4(2), bilinçli) → ikinci şubenin ajanı 401 alır, o şubede fiş basılamaz. İlkesi ADR-042 K5'te kilitli: *önek tenant'ı **çözer**, güven **vermez**; yetki anahtarın bcrypt doğrulamasından gelir; çözüm pre-context `tenants` okumasıyla yapılır, yeni BYPASSRLS pool ile **değil**; başarısızlık hep aynı `401`*.
**Test yatağı Faz 2'dir** (ADR-042 S3): ikinci-tenant ajan kaydı demo tenant üzerinde, canlı restoranın baskı yoluna hiç dokunmadan kanıtlanır.

> ⚠️ **Faz 3'e devredilen not (security kapısı, 2026-10-16).** ADR-043 K5 bariyeri `TENANT_ID`'deki **tek** canlı tenant'ı tanır. İkinci gerçek şube açıldığında o tenant bariyerin kapsamında **olmaz** — demo tohumlaması ona karşı korumasız kalır. Faz 2 için kapsam dışı (bugün tek canlı tenant var); ikinci şube açılmadan önce bariyer yapısal hâle getirilmeli (ör. yalnız `demo` önekli slug'lara izin veren allowlist, "canlı olmayanı hedefle" yerine "yalnız demo'yu hedefle").

**OPS-2 — DD'nin kalan tek Kritik'i.** Bugün kodda sıfır iz var. Tek işletmede elle cutover kabul edilmişti; 2-3 işletmede her restoranın print-agent'ını elle güncellemek sürdürülemez.
Gerekenler: `agent_version` heartbeat · sürüm kanalı · güvenli güncelleme (yarıda kalırsa eski sürüm çalışmaya devam etmeli) · geri alma.

**K3 — rotasyon.** Şu an tüm yazıcılar **tek ortak kayıt sırrı** paylaşıyor. ADR-004 Amd14 K2 (iptal edilmiş parmak izi yeniden kaydolamaz) **mutlak bariyer değil** — `device_fingerprint`'i istemci üretiyor. Gerçek kilit yalnız rotasyonla gelir.
Karar noktaları: grace penceresi · yeni anahtarın operatöre gösterimi · `api_key_hash`'in çoklu anahtarı nasıl taşıyacağı · audit (anahtarın kendisi **asla** yazılmaz).

**Risk:** 🔴 fail-closed — yanlış giderse **baskı sessizce durur**. Günlük ~1450 iş. Negatif kontrol + restoran kapalıyken deploy.

---

## Faz 4 — Dayanıklılık (şube sayısı arttıkça acır)

- **OPS-3** — prod dist build + versiyonlu release + **rollback** + CD. Bugün deploy elle; iki şubede hata geri alma süresi kritikleşir.
- **OPS-1 / MIM-4** — tek Hetzner box SPOF. Charter'da **bilinçli** tercihti; ikinci işletme geldiğinde "benim restoranım durur" değil "müşterimin restoranı durur" olur → hot-standby.
- **VERI-2** — riskli DDL'ler için down migration + runbook.

## Faz 5 — Ölçek (yalnız gerekirse)

- **MIM-3** — in-memory realtime → Redis adapter. **Yalnız çok-node gerektiğinde.** 2-3 şube tek node'da rahat çalışır; şimdi yapmak erken optimizasyon.

## Sürekli / fırsatçı (ayrı faz açılmaz)

Dokunulan modülde kademeli: **KOD-2** tanrı-dosyalar · **KOD-6** API zarf sözleşmesi · **KOD-8** SplitPaymentModal · **TEST-1** web UI test derinliği · **GUV-5** argon2id · **OPS-9** MSI imzalama (EV sertifika, büyümede) · **OPS-12** sıfır-kesinti + secret rotasyon runbook.

---

## Şu anda beklemede (faz değil, takip)

| Kalem | Ne bekleniyor |
|---|---|
| Play Store üretim başvurusu | Google kararı (~7 gün, 2026-10-13'te gönderildi) |
| Play Console destek kaydı | Başvurudaki yanlış cevabın düzeltmesi (~15 gün) |
| K8 `/auth/*` 429 izleme penceresi | **2026-10-18** → `systemctl disable --now auth-429-watch.timer` + sonucu `docs/ops/deploy.md` §10.1'e yaz |

## Bu dosya nasıl güncellenir

Faz açılırken: ADR yaz → `active-plan.md`'yi o faza çevir → burada fazın başına ADR numarasını yaz. Faz kapanınca: ✅ + PR numarası. Yeni bir DD maddesi gerçeğe karşı çürürse `dd-scope-triage.md`'de **ve burada** düzelt — kardeş-artefakt sapması bu projede tekrarlayan bir hata.
