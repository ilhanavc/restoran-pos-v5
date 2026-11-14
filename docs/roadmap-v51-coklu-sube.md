# 🧭 PUSULA — v5.1 Yol Planı (Çoklu Şubeye Geçiş + Kalan Denetim Borçları)

> **Kod adı: `PUSULA`.** Ürün sahibi 2026-11-14'te bu yol haritasına bir ad istedi. Bundan sonra *"Pusula'da ne var?"* / *"Pusula'yı aç"* demek **bu dosyayı** kastetmektir. Sürüm: **PUSULA v1 (2026-11-14)**.
>
> **Durum:** 2026-11-14 · Kaynak: `docs/audit/dd-scope-triage.md` (satın-alma DD raporu) + B-planı kararı (S124, ürün sahibi)
> **Bu dosya ne DEĞİL:** mimari karar. Her faz **kendi ADR'siyle** açılır (Core Directive #2). Bu dosya yalnız **sıra** ve **gerekçe**.
> **Tek giriş kapısı:** o an üzerinde çalışılan faz `.claude/plans/active-plan.md`'de görünür.

## 🔴 HEDEF KARARI (2026-11-14) — "SATILAN ÜRÜN"

Ürün sahibi, *"2-3 işletme mi, satılan ürün mü?"* sorusuna **"satılan ürün"** cevabını verdi. Bu, PUSULA'nın en büyük çatalıydı ve **Katman 3 artık koşullu değil, aktif.**

### ⚠️ Bu karar ANAYASAYLA ÇELİŞİYOR — ADR olmadan ilerlenemez

`CLAUDE.md` → *Ürün sınırı (kapsam kilidi)* şu an **aynen** şunu diyor:

> **Hedef:** … Başta 1 tenant (kendi restoranım), ileride **2-3 işletme daha**.
> **Hedef değil:** **Adisyo'ya rakip olmak**, 5-20 şubeli zincirler, multi-region, **e-Fatura/yazarkasa**, **yemek platformu entegrasyonları**, …

"Satılan ürün" bu tek satırın **üç kalemiyle** birden çarpışıyor: rakip olmak · (abonelik faturalandırması tarafıyla) e-Fatura · platform entegrasyonları. `CLAUDE.md` her oturumda okunan dosyadır: düzeltilmezse **her gelecek oturum ve her kapı bu yönün tersine çalışır** ve "sessiz kapsam büyümesi yasak" kuralı sürekli ihlal edilmiş olur.

**Zorunlu ilk iş: anayasayı değiştiren bir ADR.** Kodla değil, bu satırla başlanır.

### 🔀 Cevaplanması gereken ALT ÇATAL — işin boyutunu ikiye katlıyor ya da yarıya indiriyor

"Satılan ürün" iki çok farklı şey olabilir:

| | **(a) Self-servis (SaaS)** | **(b) Satılan ama elle kurulan** |
|---|---|---|
| Müşteri nasıl başlar | Siteden kendi kaydolur | Sen/bayi kurar, hesabı sen açarsın |
| Ödeme | Uygulama içinde kartla, aylık, otomatik | Faturayı sen kesersin, havale/elden |
| Gereken yeni iş | Kayıt sayfası · kart altyapısı · deneme süresi · iptal akışı · şifre sıfırlama · 2FA · destek araçları | Yalnız faturalandırma takibi |
| Yazıcı kurulumu | Müşteri kendi yapar → **`OPS-9` imzalama + `OPS-2b` oto-güncelleme ŞART** | Sen kurarsın, ama 10 müşteride elle güncelleme sürdürülemez |

Türkiye'deki restoran POS satıcılarının çoğu **(b)** gibi çalışır. (b) seçilirse Katman 3'ün en pahalı iki kalemi (self-servis kayıt + kart altyapısı) **düşer**.

### Alt çataldan BAĞIMSIZ olarak kesinleşenler

Hangi şık seçilirse seçilsin bunlar artık **yukarı taşındı**:

| İş | Neden yükseldi |
|---|---|
| **Dalga D** (anahtar rotasyonu) | Yabancı müşterilerin yazıcıları **tek ortak şifreyi paylaşamaz.** Artık "iyi olur" değil, satışın ön koşulu |
| **`OPS-9` imzalama → `OPS-2b` oto-güncelleme** | 10 müşterinin yazıcı programını elle güncellemek **imkânsız.** En çok yükselen kalem bu |
| **`OPS-3`** rollback + versiyonlu release | Bozuk bir deploy artık **ödeme yapan müşterileri** etkiliyor |
| **`OPS-1`/`MIM-4`** tek sunucu SPOF | *"Benim restoranım durur"* → *"müşterimin restoranı durur"* |
| **Yazıcı kuralları** | Her müşteri farklı basıyor; her birini senin ayarlaman ölçeklenmez |
| **İndirim + iade** | Her iki şıkta da şart; platformların da ön koşulu |

### Kod dışı kalemler — unutulmasın

Satılan ürün olmak yalnız yazılım işi değil: **destek** (kim, hangi saatlerde) · **sözleşme/KVKK veri işleyici metinleri** · **faturalandırma yükümlülükleri**. ⚠️ Son ikisi **hukuki/mali danışman işi** — bu depodaki kod okunarak karara bağlanamaz, yalnız not düşülüyor.

### Durum

🔜 **Sıradaki iki adım:** ① alt çatalın cevabı ② anayasa ADR'si. İkisi bitmeden Katman 3'ten kod yazılmaz. Dalga B·C·D sırası **değişmedi** — hâlâ en önde, artık daha güçlü gerekçeyle.

## ⚠️ Kavram karışıklığı — "A-B-C-D" NE DEĞİLDİR

2026-11-14'te soruldu, kayda geçiyor: **A·B·C·D, bu yol haritasının tamamı değildir.** Onlar yalnızca **Faz 3'ün (ADR-044) deploy dalgalarıdır** ve üç kalemi kapatırlar: MIM-7b (ikinci şubenin yazıcı kaydı) · OPS-2'nin görünürlük yarısı · ADR-004 Amd14 K3 (kayıt anahtarı rotasyonu).

| A-B-C-D neyi kapatır | neyi KAPATMAZ |
|---|---|
| Denetimin **kalan son kritiği** (OPS-2 görünürlük) | Bilinçli ertelenen beşli: `OPS-3` otomatik deploy · `VERI-2` geri alınabilir migration · `GUV-5` bcryptjs · `MIM-3` Redis · `OPS-1/MIM-4` tek sunucu |
| İkinci şubenin **fiş basmasının** önündeki son engel | Denetimin hiç bakmadığı dört ticari boşluk: abonelik/tahsilat · self-servis kayıt · indirim · iade |
| | `OPS-2b` gerçek oto-güncelleme (ön koşulu `OPS-9` imzalama) |

Denetim raporu 73 bulgu getirdi; Kova A **25/25** kapandı, Kova B'nin 4 kritiğinden **3'ü** RLS ile kapandı. A-B-C-D dördüncüyü kapatır — **listeyi değil.**

## 🧭 PUSULA sırası — BİRLEŞİK (2026-11-14)

> Bu bölüm **üç ayrı listeyi tek sıraya** döküyor: ① kalan deploy dalgaları ② satın-alma denetiminin **bilinçli ertelenmiş** kalemleri + denetimin **hiç bakmadığı** ticari boşluklar ③ ürün sahibinin 2026-11-14'te saydığı dört yeni iş. Ayrı tutulduklarında bağımlılıklar görünmüyordu; birleşik hâlin asıl değeri **neyin neyi beklediği**.
>
> **Sıralama ilkesi:** katmanlar **gerekliliğe** göre dizildi, arzuya göre değil. Her katman bir eşiğe karşılık geliyor: "bugün", "ikinci şube açılırken", "ikinci şube canlıyken", "ticari ürün kararı verilirse".

### Katman 0 — ŞİMDİ (yarım kalmış kampanyayı kapat)

| İş | Durum | Not |
|---|---|---|
| **Dalga B** ajan `0.0.5` | 🔜 **SIRADAKİ** — dükkan PC'si | Yönetici PowerShell, `update-agents.ps1` (otomatik geri alma var) |
| **Dalga C** MIM-7b canlı kanıtı | B'den sonra | Demo tenant'ta curl; canlı baskı yoluna dokunmaz, gündüz olur |
| **Dalga D** canlı anahtar rotasyonu | C'den sonra, **restoran kapalı** | ⚠️ Koşul **esnetilemez** — rotasyon fail-closed |

**Neden önce:** ① Katman 1'in yazıcı işi **B'ye bağımlı** (sürüm satırı + bayat rozeti prod'da ama `agent_version` **NULL**; ajan 0.0.5 olmadan öyle kalır → hiç çalıştığı görülmemiş bir özelliğin etrafında tasarım yapılır). ② **D, parası ödenmiş bir güvenlik düzeltmesini aktive ediyor** — üç yazıcı tek kayıt sırrı paylaşıyor (prod: 5 satır / **2 hash**), çözüm 14 Kas'ta prod'a indi ama devrede değil. ③ B+C+D ≈ bir akşam; diğer katmanlar haftalar. ④ Yarım kampanya, dokümanların saptığı yerdir. ⚠️ **Teknik aciliyet YOK:** Dalga A kararlı bir duraktır (legacy yol bit-bit korundu, `pk2_` anahtarı yok) — gerekçe verimlilik, risk değil.

### Katman 1 — İKİNCİ ŞUBEYİ FİİLEN AÇAN işler

| İş | Kaynak | Bağımlılık | Not |
|---|---|---|---|
| **Yazıcı kuralları** (işletmeye özel baskı) | ürün sahibi, 14 Kas | 🔗 **Dalga B** | Charter hedefini (*"2-3 işletme daha"*) doğrudan açan kalem: her restoran farklı basıyor. Ölçüm: `tenant_settings` **4 kolon** · fiş şablonları **kod**, yalnız `tenant_header` parametre → UI rötuşu değil, **yeni bir işletme-ayarları katmanı** (şema + uç + ekran). ADR gerekli |
| **`OPS-3`** dist build + versiyonlu release + **rollback** | DD (Yüksek) | — | Bugün deploy elle, `apps/api build` = `tsc --noEmit` (dist üretmiyor). Tek işletmede kabul edilebilirdi; **ikinci şubede hata geri alma süresi kritikleşir** |

### Katman 2 — İKİNCİ ŞUBE CANLI OLDUĞUNDA ACIYANLAR

| İş | Kaynak | Not |
|---|---|---|
| **`OPS-1` / `MIM-4`** tek sunucu SPOF → hot-standby | DD (Kritik/Yüksek) | Charter'da **bilinçli** tercihti. İkinci işletmede anlamı değişir: *"benim restoranım durur"* → *"müşterimin restoranı durur"* |
| **`VERI-2`** riskli DDL'ler için down migration + runbook | DD (Yüksek) | Ölçüm: **69 migration'ın 0'ı** geri alınabilir (forward-only bilinçli karardı) |
| **`OPS-12`** sıfır-kesinti + secret rotasyon runbook | DD (Düşük) | Bugün deploy kapanış saatine sabitli |
| **`OPS-9`** MSI/binary imzalama | DD (Orta) | 🔑 **`OPS-2b`'nin ön koşulu** — imzasız binary indirip çalıştırmak dükkan ağına uzaktan kod çalıştırma yolu açar |
| **`OPS-2b`** gerçek ajan oto-güncelleme | DD (Kritik, taşındı) | 🔗 `OPS-9`. Ölçüm: `autoUpdate`/`self-update` → **0 eşleşme**. 2-3 işletmede her PC'yi elle güncellemek sürdürülemez |

### Katman 3 — TİCARİ ÜRÜN KARARI verilirse (hepsi birbirine bağlı)

> ⚠️ **Bu katmanın tamamı tek bir soruya bağlı: "2-3 işletme mi, satılan ürün mü?"** Cevap *"2-3 işletme"* ise bu katman **açılmaz** ve giriş/kayıt işi Katman 1'in arkasına, çok küçük bir kapsamla düşer.

| İş | Kaynak | Bağımlılık | Ölçüm (14 Kas) |
|---|---|---|---|
| **Abonelik / tahsilat** | DD'nin bakmadığı boşluk | — | `plan_id` · `trial_ends` · `subscription_status` → **hepsi 0 eşleşme** |
| **Self-servis kayıt** (işletme açma) | DD'nin bakmadığı + ürün sahibi | 🔗 abonelik (yoksa bedava kayıt) · 🔗 Dalga C/D'nin anahtar makinesi (yeni şubeye yazıcı anahtarı üretilmeli) | Yeni işletme yalnız **root SSH** + `bootstrap-prod.ts` |
| **Giriş/kayıt gövdesi** (şifre sıfırlama · e-posta doğrulama · 2FA) | ürün sahibi, 14 Kas | 🔗 self-servis kayıt | Kayıt ucu **yok** · `ForgotPasswordModal` **47 satır ve hiçbir API çağırmıyor** (*"müdürü ara"* bilgi kutusu) · 2FA yok · hesabı yalnız admin açar. ⚠️ **"İlkel" yargısı koşullu:** bugün 6 tanıdık kullanıcıda admin'in hesap açması self-servisten **daha güvenli**; yargı, tanımadığın biri kaydolduğu gün doğru olur |
| **İndirim** (`discount_cents`) | DD'nin bakmadığı boşluk | — | **0 eşleşme** (saf domain fonksiyonu + 6 test var; kolon/uç/UI yok) |
| **İade ucu** | DD'nin bakmadığı boşluk | — | `payments.ts`'te "refund" yalnız bir **yorum** satırı; izin tanımlı, uç yok |

### Katman 4 — PLATFORM ENTEGRASYONLARI (Trendyol · Uber Eats · Getir · Yemeksepeti)

🔴 **Kapsam kilidinin dışında** → Faz 6 adayı (aşağıda, ayrıntılı). 🔗 **Katman 3'ün indirimi ve iadesine bağlı** (platform siparişi kampanyalı gelir, iptali iade ister) + sipariş kanalı alanı yok + `OPS-3` açık. Ürün sahibinin kendi sırası da en son.

### Paralel kulvar — hiçbir katmanı beklemeyenler

| İş | Not |
|---|---|
| **Tanıtım sitesi + rakip incelemesi** | 🟢 **Bugünden başlayabilir.** POS deposunda kodu yok, şemaya dokunmuyor, deploy'a girmiyor → sıraya koymanın gerekçesi yok. ⚠️ **POS deposuna GİRMEMELİ** (ayrı yayın döngüsü, ayrı proje) |
| **`TEST-1`** web UI test derinliği · **`TEST-2`** mobil E2E harness | Kalite borcu; kapasite boşluğunda |
| **`GUV-5`** argon2id · **`MIM-3`** Redis adapter | `MIM-3` **yalnız çok-node gerekirse** — 2-3 şube tek node'da rahat çalışır, şimdi yapmak erken optimizasyon |
| **`KOD-2`** tanrı-dosyalar · **`KOD-6`** API zarf sözleşmesi · **`KOD-8`** SplitPaymentModal | Fırsatçı: yalnız o modüle zaten dokunulurken |

### Bağımlılık zinciri — tek bakışta

```
Dalga B ──► Yazıcı kuralları
   └──► Dalga C ──► Dalga D ──┐
                              ├──► Self-servis kayıt ──► Giriş/kayıt gövdesi
            Abonelik/tahsilat ─┘

OPS-9 (imzalama) ──► OPS-2b (oto-güncelleme)

İndirim + İade + sipariş kanalı ──► Platform entegrasyonları

Tanıtım sitesi ──► (bağımsız, bugünden)
```

> **Katman 1-4'ün tamamı kapsam kilidinin dışındadır** → her biri kendi ADR'siyle açılır, yoksa sessiz kapsam büyümesi olur (CLAUDE.md). Platformlar Faz 6 adayı olarak kayıtlı; **yazıcı kuralları** ve **giriş/kayıt** da aynı disiplinle buraya yazıldı.

## Neden bu sıra

Üç kısıt sıralamayı belirledi:

1. **Bağımlılık.** İzole demo tenant, tenant çözümü düzelmeden açılamaz. Ajan oto-güncelleme ile anahtar rotasyonu aynı kurulu `exe`'ye dokunuyor → tek cutover'da yapılmalı, yoksa dükkan iki kez kapanır.
2. **Canlı risk.** Auth ve agent-auth yolları **fail-closed**: yanlış değişiklik girişi ya da baskıyı **sessizce** durdurur. Bu yüzden ikisi de ayrı fazlarda, negatif kontrolle ve **restoran kapalıyken** iner.
3. **Değer.** İkinci şube **Faz 1 + Faz 3** bitmeden çalışamaz (giriş Faz 1'de, fiş baskısı Faz 3'te açılır); gerisi şube sayısı arttıkça acıyan kalemler.

## Kalemlerin bugünkü doğrulanmış durumu

> 🔄 **2026-11-14 taraması.** Kalemler yine koda ve prod'a karşı ölçüldü. **Bayat çıkan tek şey OPS-2 satırıydı** (*"sıfır eşleşme"* — #785 onu 11-07'de kapatmıştı); düzeltildi. Değişmeyenler, bugün yeniden ölçülerek: `OPS-2b` oto-güncelleme **0 eşleşme** · `OPS-3` deploy workflow **yok**, `apps/api` build hâlâ `tsc --noEmit` (dist üretmiyor) · `VERI-2` **69 migration'ın 0'ı** down · `GUV-5` hâlâ `bcryptjs` · `MIM-3` Redis adapter **yok** · ticari boşluklar (`plan_id` · `trial_ends` · `discount_cents` · `subscription_status`) **hepsi 0 eşleşme**, iade ucu yalnız bir yorum satırı. Prod: **2 tenant** (`dilan-pide` 6 kullanıcı / 4623 sipariş / 1131 baskı · `demo` 2 kullanıcı / **0 sipariş / 0 baskı**) → izolasyon korunuyor, MIM-7b pratikte hâlâ denenmemiş.

S142'de koda karşı tarandı — dosya okumakla yetinilmedi (`dd-scope-triage.md`'nin kendi uyarısı). **2026-10-16'da tazelendi:** Faz 1 prod'a indi, ilk iki satır buna göre düzeltildi; sayılar prod'dan yeniden sayıldı (26 tablo `tenant_id`, 26'sı force-RLS). **2026-11-05'te yeniden tarandı** — bu kez bayat olan **bu dosyaydı**: Faz 2 çoktan bitmişti ama "AKTİF" yazıyordu, "beklemede" tablosunun üç satırının üçü de kapanmıştı, K3 ölçümü eskimişti. Aşağıdaki Faz 3 satırları prod'dan **yeniden** okundu.

| Kalem | Durum | Kanıt |
|---|---|---|
| DD **Kova A** (canlıyı ısıranlar) | ✅ 25/25 kapalı | triyaj dosyası |
| **MIM-1 · MIM-2 · VERI-1** (tenant izolasyon + RLS) | ✅ kapalı, prod'da | ADR-041, 26 tablo force-RLS, mig 054→065 |
| **MIM-7 gövdesi** (tenant çözümü, **insan-auth yarısı**) | ✅ **KAPALI, prod'da** (2026-10-16) | Faz 1'in beş adımı da indi. Dört pre-context noktası (`auth.ts` login + logout · `auth/refresh.ts` · rate-limit) artık tek `auth/tenantResolution.ts` modülünden çözülüyor. Canlı ölçüm: 45 dk'da 8 token, 7'si rotasyonla, **`reuse_detected` = 0** |
| İkinci şubenin **ajan kaydı** | 🟢 **KODDA KAPANDI** (#786, 2026-11-07) — prod'a inmedi | `print-jobs.ts:664-682` öneki sunucu sabitiyle **karşılaştırıyor** → 2. şube ajanı 401 alır, fiş basamaz. Gövdesi **Faz 3**. 🔬 **Prod kanıtı (2026-11-05):** demo tenant'ın bir `agents` satırı **var** (17 Eki, kendi ayrı anahtarıyla) ama `last_seen_at` = **hiç** ve demo tenant'ta **0 `print_jobs`** → ikinci bir tenant bugüne dek **tek fiş bile basmadı**; kısıt teoride değil pratikte de kapalı |
| **OPS-2** → görünürlük (Faz 3) + **`OPS-2b`** oto-güncelleme (ADR-044 K10-2) | 🟢 **Görünürlük KODDA KAPANDI** (#785, 2026-11-07) — prod'a inmedi · 🔴 **`OPS-2b` AÇIK**, ön koşulu **OPS-9** | ⚠️ **Bu satır 2026-11-14'te düzeltildi:** *"sıfır eşleşme"* ifadesi **artık yanlıştı** — `agent_version`/`agentVersion` bugün **12 dosyada** (API route'ları + `print-agent/src/agent-request.ts` + web sürüm rozeti + mig 069/070/071 + testler). Buna karşılık `autoUpdate`/`auto-update`/`self-update` → hâlâ **sıfır** eşleşme, yani `OPS-2b` gerçekten açık. Prod (2026-11-14): `agent_registration_keys` tablosu **YOK**, `agents`'ta yeni kolon **0** → Dalga A inmedi |
| **ADR-004 Amd14 K3** (kayıt anahtarı rotasyonu) | 🟢 **KODDA KAPANDI** (#786 + `scripts/rotate-agent-key.ts`) — 🔴 **prod'da AÇIK**, Dalga D bekliyor | **prod ölçümü 2026-11-14'te tekrarlandı, DEĞİŞMEDİ:** 5 ajan / `COUNT(DISTINCT api_key_hash) = 2` / 1 iptalli / **3'ü son 5 dk'da canlı**. Dört satır **birebir aynı** hash'i paylaşıyor: üç canlı yazıcı (FIRIN · KASA · IZGARA) **artı 4 Tem'de iptal edilmiş `install_leftover`** → **iptal edilen satır hâlâ aynı anahtarı taşıyor**, yani satırı iptal etmek anahtarı geçersiz kılmıyor. İkinci hash demo tenant'ın ajanı (sohbete düşen anahtar, chip) |
| İzole demo/test tenant | ✅ **BİTTİ, prod'da** (Faz 2, ADR-043) | Prod'da **2 tenant** (`dilan-pide` · `demo`), demo'da **2 kullanıcı / 0 sipariş / 0 baskı** (2026-11-05'te sayıldı) → izolasyon korunuyor. Play üretim erişimi onaylandı, uygulama **22 Eki 2026**'dan beri yayında |
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

## Faz 2 — İzole demo / test tenant · ✅ **BİTTİ** · ADR-043 (2026-10-16)

> **Kapanış:** ADR-043 prod'a **2026-10-17**'de indi (#743 + #744), K6 **2026-10-20**'de kapandı, Play üretim sürümü **2026-10-22**'de yayına girdi (1.0.0, %100, 178 ülke). Faz 3'ün test yatağı böylece hazır — ama **henüz kullanılmadı** (demo tenant'ın ajanı hiç bağlanmadı, 0 baskı).

Faz 1'in **üstüne** oturur; ondan önce yapılamaz. **Ön koşul 2026-10-16'da sağlandı** (ADR-042 K3 adım 4 — web + mobil işletme kodu alanı prod'da).

**Neden gerekli — iki ayrı sebep tek çözümde buluşuyor:**
- **Play Store:** Google'ın kendi yanıtı (S142, destek asistanı): *"Uygulamanız giriş gerektiriyorsa, inceleyenlerin test edebilmesi için **App access** bölümüne çalışan giriş bilgisi girmelisiniz."* Şu an giremiyoruz, çünkü çalışan her giriş **gerçek müşteri ve sipariş verisini** açar (KVKK).
- **Satış/demo:** ikinci işletmeye ürünü göstermenin yolu.

**Kapsam:** gerçek veriye dokunmayan, tohumlanmış bir tenant + o tenant'a bağlı demo hesap. RLS zaten canlı olduğu için izolasyonun **mekanizması hazır** — eksik olan tenant'ın kendisi ve tohum verisi.

**Çıktı:** Play Console → *Policy and programs > App content > App access* alanına girilecek çalışan kimlik bilgisi. ✅ **Girildi** — üretim erişimi onaylandı, inceleme 2 günde geçti, uygulama 22 Eki'den beri yayında.

---

## Faz 3 — Ajan tenant çözümü (MIM-7b) **+** oto-güncelleme (OPS-2) **+** kayıt anahtarı rotasyonu (ADR-004 Amd14 K3) · **ADR-044 (Accepted, 2026-11-06)** · 🟢 **KOD TARAFI BİTTİ (2026-11-07), dalgalar bekliyor**

> ✅ **ÜÇ PR DA `main`'DE (2026-11-07):** `#785` PR-1 (sürüm görünürlüğü + demo allowlist) · `#786` PR-2 (tenant çözümü + rotasyon, `security-reviewer` imzalı) · `#787` PR-3 (sıralı güncelleme script'i + cutover dokümanı). ✅ **DALGA A İNDİ — 2026-11-14 10:58 UTC:** prod `2c6045c`, migration head **`071`**, üç migration tek transaction'da. Kabul kanıtı alındı (üç yazıcı 8 sn'de taze, legacy dalda akmaya devam etti). Kanıt + ön koşul sapması kaydı: `docs/ops/deploy.md` §10.4. 🔴 **Kalan: B (ajan 0.0.5, dükkan PC'si) → C (demo tenant curl kanıtı, gündüz olur) → D (canlı rotasyon, restoran kapalı — bu koşul esnetilemez).**
>
> **ADR-044 `decisions.md`'de ve durum ACCEPTED** (2026-11-06; K10'daki 7 sorunun tamamı ürün sahibi tarafından cevaplandı). Dört dalga (A sunucu → B ajan 0.0.5 → C demo tenant'ta MIM-7b kanıtı → **D canlı rotasyon, bu fazda**), üç PR (K4+K6 · **K1+K2 — `security-reviewer` imzası şart** · K5).
>
> **Karara bağlananlar:** grace **7 gün** · rotasyonu **yalnız ops script** tetikler (müdür UI'ı ve anahtar-yaşı rozeti kapsam dışı) · beklenen sürüm **sunucu env'inden** (`PRINT_AGENT_EXPECTED_VERSION`), env boşsa uyarı yok · MIM-7b kanıtı **curl** (demo'ya ajan kurulmaz) · **OPS-2 İKİYE AYRILDI**: görünürlük bu fazda, oto-güncelleme **`OPS-2b`** (ön koşulu **OPS-9** imzalama) · ikinci şubenin anahtarı **uzaktan erişimle** ürün sahibinin elinden yazılır → o PC'ye **uzaktan erişim aracı kurulumu ön koşul** ve ⚠️ bozuk yapıştırma riski kayıtlı (kabul kanıtı DB'den okunur).

**Bilerek tek faz.** Üçü de dükkandaki kurulu `exe`'ye dokunuyor. Ayrı yapılırsa restoran birkaç kez kapatılır ve ayrı ayrı cutover riski alınır.

> 🔧 **Kapsam düzeltmesi (2026-10-16).** Bu başlık MIM-7b'yi atlıyordu; oysa `docs/audit/dd-scope-triage.md:105` ve ADR-042 K5 (`decisions.md:19675`) onu **Faz 3'e** koyuyor. Üç belge arasında sapma vardı, burası eksik olandı.

**MIM-7b — ikinci şubenin print-agent'ı kaydolamaz.** `routes/print-jobs.ts` agent register tenant'ı **türetmiyor**, istemcinin `pk_<8hex>_` önekini **sunucu sabitiyle karşılaştırıyor** (ADR-041 Amd7 K4(2), bilinçli) → ikinci şubenin ajanı 401 alır, o şubede fiş basılamaz. İlkesi ADR-042 K5'te kilitli: *önek tenant'ı **çözer**, güven **vermez**; yetki anahtarın bcrypt doğrulamasından gelir; çözüm pre-context `tenants` okumasıyla yapılır, yeni BYPASSRLS pool ile **değil**; başarısızlık hep aynı `401`*.
**Test yatağı Faz 2'dir** (ADR-042 S3): ikinci-tenant ajan kaydı demo tenant üzerinde, canlı restoranın baskı yoluna hiç dokunmadan kanıtlanır.

> ⚠️ **Faz 3'e devredilen not (security kapısı, 2026-10-16).** ADR-043 K5 bariyeri `TENANT_ID`'deki **tek** canlı tenant'ı tanır. İkinci gerçek şube açıldığında o tenant bariyerin kapsamında **olmaz** — demo tohumlaması ona karşı korumasız kalır. Faz 2 için kapsam dışı (bugün tek canlı tenant var); ikinci şube açılmadan önce bariyer yapısal hâle getirilmeli (ör. yalnız `demo` önekli slug'lara izin veren allowlist, "canlı olmayanı hedefle" yerine "yalnız demo'yu hedefle").

**OPS-2 — DD'nin kalan tek Kritik'i.** ⚠️ *"Bugün kodda sıfır iz var"* ifadesi **düzeltildi (2026-11-06, ADR-044 Bağlam (d)):** `apps/print-agent/src/version.ts` **var** — `VERSION` sabiti `package.json`'dan geliyor (bugün **0.0.4**), WiX `Package/@Version` ile senkron ve `version.test.ts` doğruluyor. Ama sürüm **yalnız boot log'una basılıyor**; sunucuya hiç gönderilmiyor ve sunucuda kolon yok. Yani eksik olan sürüm bilgisi değil, **taşıma + sunucu tarafı + güncelleme yolu**. Tek işletmede elle cutover kabul edilmişti; 2-3 işletmede her restoranın print-agent'ını elle güncellemek sürdürülemez.
Gerekenler: `agent_version` heartbeat · sürüm kanalı · güvenli güncelleme (yarıda kalırsa eski sürüm çalışmaya devam etmeli) · geri alma.

**K3 — rotasyon.** Şu an tüm yazıcılar **tek ortak kayıt sırrı** paylaşıyor. ADR-004 Amd14 K2 (iptal edilmiş parmak izi yeniden kaydolamaz) **mutlak bariyer değil** — `device_fingerprint`'i istemci üretiyor. Gerçek kilit yalnız rotasyonla gelir.
Karar noktaları: grace penceresi · yeni anahtarın operatöre gösterimi · `api_key_hash`'in çoklu anahtarı nasıl taşıyacağı · audit (anahtarın kendisi **asla** yazılmaz).

**Risk:** 🔴 fail-closed — yanlış giderse **baskı sessizce durur**. Günlük ~1450 iş. Negatif kontrol + restoran kapalıyken deploy.

---

## Faz 4 — Dayanıklılık (şube sayısı arttıkça acır)

- **OPS-3** — prod dist build + versiyonlu release + **rollback** + CD. Bugün deploy elle; iki şubede hata geri alma süresi kritikleşir.
- **OPS-1 / MIM-4** — tek Hetzner box SPOF. Charter'da **bilinçli** tercihti; ikinci işletme geldiğinde "benim restoranım durur" değil "müşterimin restoranı durur" olur → hot-standby.
- **VERI-2** — riskli DDL'ler için down migration + runbook.

## Faz 6 — ADAY: yemek platformu entegrasyonları (Yemeksepeti · Getir · Uber Eats)

> 📌 **Ürün sahibi 2026-11-14'te talep etti**, sırayı da kendisi verdi: *"bu dediklerimiz hallolduktan sonra"* → Dalga A-D + çoklu şube işleri bitince. Buraya **kapsam kilidi gereği** yazıldı; sessiz kapsam büyümesi yasak, bu yüzden talep kayda geçti ama **iş açılmadı.**
>
> ⚠️ **Kapsam durumu: KİLİDİN DIŞINDA.** Üç soruluk test (CLAUDE.md):
> 1. **v3'te var mıydı?** Hayır — v3 kaynağında taranıp doğrulandı (tek eşleşme *"Seçenekleri de getir"* yorumuydu, Türkçe fiil).
> 2. **v5.0 MVP'de mi?** Hayır — CLAUDE.md *"Hedef değil"* listesinde **adıyla** geçiyor: *"yemek platformu entegrasyonları"*.
> 3. **Öz-kuralımız zorunlu kılıyor mu?** Hayır.
>
> → Üçü de hayır. **Kod yazılabilmesi için önce kendi ADR'si gerekir** (Core Directive #2 + kapsam kilidi). ADR, "hedef değil" satırını da açıkça değiştirmek zorundadır; yoksa anayasa ile kod çelişir.

**Bugün ölçülmüş ön koşullar** (hiçbiri tahmin değil, 2026-11-14 taraması):

- **İndirim altyapısı yok.** `discount_cents` → **0 eşleşme** (saf domain fonksiyonu + 6 test var, kolon/uç/UI yok). Platform siparişleri kampanyalı gelir; indirim taşınamayan bir sipariş modeline platform siparişi yazılamaz.
- **İade ucu yok.** `payments.ts`'te "refund" yalnız bir **yorum** satırı; izin tanımlı, uç yok. Platform iptalleri/iadeleri bu ucu ister.
- **Sipariş kanalı alanı yok.** `order_type` yalnız `dine_in`/`takeaway`/`delivery`; "hangi platformdan geldi" + platform sipariş kimliği + kurye durumu için şema kararı gerekir.
- **`OPS-3` (CD + versiyonlu release + rollback) açık.** Bugün deploy elle. Dış bir tarafın siparişi akarken hatayı geri alma süresi kritikleşir.
- **Üç platform = üç ayrı sözleşme.** Her biri kendi webhook'u, menü senkronu, dükkan aç/kapa durumu ve mutabakatı demek; tek bir "entegrasyon" işi değil.

**Zorunlu kapılar:** `architect` (ADR) · `security-reviewer` (**yeni dış-gelen güven sınırı — zorunlu**) · `db-migration-guard` (kanal + platform kimliği şeması) · `hci-reviewer` + `turkish-ux-reviewer` (yeni sipariş kaynağı mutfak/kasa ekranlarında görünür).

**ADR'de karara bağlanacaklar:** hangi platform(lar) ve hangi sırayla · siparişi platform mu iter (webhook) biz mi çekeriz · menü/fiyat senkronu tek yönlü mü · platform siparişi hangi `order_type`'a düşer · indirim ve iade modeli (yukarıdaki iki boşluğun kapanma biçimi) · mutabakat/raporlama · dükkan aç-kapa kontrolü kimde.

## Faz 5 — Ölçek (yalnız gerekirse)

- **MIM-3** — in-memory realtime → Redis adapter. **Yalnız çok-node gerektiğinde.** 2-3 şube tek node'da rahat çalışır; şimdi yapmak erken optimizasyon.

## Sürekli / fırsatçı (ayrı faz açılmaz)

Dokunulan modülde kademeli: **KOD-2** tanrı-dosyalar · **KOD-6** API zarf sözleşmesi · **KOD-8** SplitPaymentModal · **TEST-1** web UI test derinliği · **GUV-5** argon2id · **OPS-9** MSI imzalama (EV sertifika, büyümede) · **OPS-12** sıfır-kesinti + secret rotasyon runbook.

---

## Şu anda beklemede (faz değil, takip)

| Kalem | Ne bekleniyor |
|---|---|
| ~~Play Store üretim başvurusu~~ | ✅ **Kapandı** — onaylandı, **22 Eki 2026**'da yayında (1.0.0, %100, 178 ülke) |
| ~~Play Console destek kaydı~~ | ✅ **Konusu kalmadı** — üretim erişimi onaylandığı için başvurudaki yanlış cevap engel olmadı |
| ~~K8 `/auth/*` 429 izleme penceresi~~ | ✅ **Kapandı 2026-10-19** — 10 ölçüm, hepsi `PASS` (`restoran=0 diger=0 toplam=0`), rollback gerekmedi; timer `disabled`, sonuç `docs/ops/deploy.md` §10.1'de |

> **Bu tablonun üç satırı da kapandı (2026-11-05 denetimi).** Bugün gerçekten bekleyenler bu listede değil, `context-anchor.md` §2'de: Android cihazda OTA teyidi ([USER]) · #770 ızgara dikey alanı (ürün kararı) · 14 Kas Hetzner faturası (iade riski, takip [USER]'da) · DEX kod karartma son tarihi Şub 2027 |

## Bu dosya nasıl güncellenir

Faz açılırken: ADR yaz → `active-plan.md`'yi o faza çevir → burada fazın başına ADR numarasını yaz. Faz kapanınca: ✅ + PR numarası. Yeni bir DD maddesi gerçeğe karşı çürürse `dd-scope-triage.md`'de **ve burada** düzelt — kardeş-artefakt sapması bu projede tekrarlayan bir hata.
