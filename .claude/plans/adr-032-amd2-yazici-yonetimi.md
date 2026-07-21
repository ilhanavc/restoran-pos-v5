## ADR-032 Amendment 2 — Yazıcı Yönetim Ekranı (kayıt · durum · istasyon ataması)

- **Durum**: **Accepted — Dilim A+B (2026-07-21).** Ürün sahibi İlhan 2026-07-20 akşamı bu işi cutover sonrasına ertelemişti, 2026-07-21'de kararı değiştirdi ("şimdi yapalım") ve dilimleme sorusuna **"Görünürlük + atama paneli"** cevabını verdi → **Dilim A (liste + durum + yetim-kuyruk uyarısı) ve Dilim B (istasyon atama paneli) cutover ÖNCESİNE (23 Tem gate'i), Dilim C/D/E (kitchen_print anahtarı · ekleme/revoke · test baskısı) cutover SONRASINA.** K7 register-guard'ı revoke butonuyla birlikte D'de sevk edilir (ya ikisi ya hiçbiri). Ekran cutover blokeri DEĞİLDİR: 23 Tem'e yetişmezse cutover onsuz yapılır, PowerShell+SQL yolu geçerli kalır.
- **Tarih**: 2026-07-21
- **İlişki**: ADR-032 (İkincil Yazıcı Yönlendirmesi — `payload.kind` + agent `jobKinds` claim filtresi) ve **ADR-032 Amendment 1** (Mutfak İstasyon Yönlendirmesi — `categories.print_station`, Migration 048, PR #405; **kodu canlı, metni henüz `decisions.md`'ye taşınmadı**, kaynak: `.claude/plans/adr-032-amd1-mutfak-istasyon-routing.md`) genişletmesi; ADR-032'nin "**Yönetim UI'si YOK** … v5.1'de kalır" kapsam-kilidini kısmen açar. Bağlı: **ADR-004 §5** (1 agent = 1 yazıcı) · **ADR-004 Amd2 §6** (agent register kontratı) · **ADR-004 Amd4** (spooler-RAW transport) · **ADR-004 Amd9** (raster render — test fişi bu boru hattını kullanır) · **ADR-020 K2** (`categories.kitchen_print` = KDS yönlendirme kuralı) · **ADR-024** (denetim izi) · **ADR-031** (pilot/cutover go-no-go; K12 migration gate) · **ADR-003** (forward-only migration) · **ADR-022** (v5.1 backlog — "Print Agent Manager UI" kalemi buradan düşer).
- **Kapsam (dosya)**: `packages/db/migrations/049_agents_display_name_declared_kinds.sql` (yeni, additive) · `packages/shared-types/src/` (zod şemaları + `printers` DTO) · `apps/api/src/routes/printers.ts` (yeni) · `apps/api/src/routes/print-jobs.ts` (claim'de tek fire-and-forget yazma + K7 register guard'ı) · `apps/api/src/print/templates/test-receipt.ts` (yeni) · `apps/api/src/routes/menu.ts` (yalnız K4-C dilimi seçilirse: `kitchenPrint` alanı) · `apps/web/src/features/admin/printers/` (yeni) · `apps/web/src/components/layout/Sidebar.tsx:80-86` · `apps/web/src/app/router.tsx` · `apps/web/src/locales/tr.json`.
- **Neden Amendment (yeni ADR değil):** Amd5/6/7 kriteri — yeni *server↔agent runtime kontratı* getiren → yeni ADR. Bu iş agent kontratının **iki noktasına** dokunuyor (K7 register guard'ı = yeni 403 dalı; K6 = ikinci bir API anahtarının varlığı), ama **payload şekli, `?kind=` semantiği, claim SELECT/UPDATE'i ve `PrintJobKindSchema` kümesi aynen kalıyor** → exe/MSI davranışı değişmiyor. Eklenen yüzeyin %95'i kullanıcı-JWT'li admin yüzeyi. ADR-032 ertelemeyi kendi metninde adıyla yapıp promosyon yolunu kendisi yazdığı için kilidi koyan belgeyi değiştirmek izlenebilirliği tek yerde tutar. **Karşı-argüman kayda geçer:** 1 migration + ~8 endpoint + RBAC + register guard'ı ile bu iş bir amendment'in üst sınırındadır; İlhan tercih ederse **ADR-034** olarak numaralandırılabilir (içerik aynen geçerli).

---

### Bağlam

**Talep.** Bugün yazıcı eklemek/çıkarmak yalnız dükkan PC'sinde `install-second-agent.ps1` çalıştırmakla; hangi kategorinin hangi mutfak yazıcısına düştüğü yalnız prod DB'de elle `UPDATE categories SET print_station=…` ile; hangi yazıcının ayakta olduğu **hiçbir yerden** görünmüyor. Ürün sahibi bu üçünü admin ekranına istiyor.

**Ne değişti (2026-07-20 → 2026-07-21).** Bu belgenin 2026-07-20 tarihli taslağı (`adr-032-amd1-yazici-yonetimi.md`) iki dayanağı çürüdüğü için ertelenmişti: (a) "agent kontratı DONDURULDU, exe DEĞİŞMEZ" ve (b) "tek mutfak yazıcısı var". **İkisi de artık geçersiz** — ADR-032 Amd1 (S100, PR #405) `kind` enum'unu `kitchen|bill|grill` yaptı, `categories.print_station` kolonunu ekledi (Migration 048 **dün gece prod'a indi, canlı**) ve yeni exe (0.0.4) gerektiriyor. Ürün sahibi 21 Temmuz'da ekranı cutover öncesine aldı.

**Kod-doğrulanmış mevcut durum (2026-07-21).**
- `printers` tablosu **YOK**. `agents` tablosu (`037`) yalnız `id · tenant_id · device_fingerprint · api_key_hash · last_seen_at · revoked_at · revoke_reason · created_at` taşıyor — `display_name` ve `declared_kinds` **yok** (`packages/db/src/generated.ts:44-72`).
- **Agent listeleme/CRUD/revoke endpoint'i HİÇ YOK.** `printer.settings` yetkisi `packages/shared-types/src/permissions.ts:48,89`'da tanımlı ama **ölü**; `apps/api/src/__tests__/rbac-parity.test.ts:239` bunu `// matris-kapsamlı ailede route yok` yorumuyla muaf tutuyor.
- `agents.last_seen_at` **zaten yazılıyor** (`middleware/print-agent-auth.ts:124-131`, her kimlikli istekte fire-and-forget); agent `?wait=` ile ≤25 sn long-poll yaptığından bu gerçek bir canlılık sinyali. **Eksik olan tek şey okuyan uç.**
- `print_jobs` tablosunda **`printer_id` YOK** (`generated.ts:348-363`: attempts · created_at · id · payload · retry_at · status · tenant_id · updated_at) → iş, yazıcıya değil **kind'a** yönlenir.
- `categories.print_station` **canlı** (Migration 048); şu an **9 kategoride de NULL** → hepsi taban istasyona (`kitchen` = FIRIN) düşüyor.
- `kitchen_print` **hiçbir API ucundan yazılamıyor**: `apps/api/src/routes/menu.ts:124-139` PATCH yalnız `name` + `sortOrder` kabul ediyor. Kolonu okuyan yalnız `routes/orders.ts` (sent-transition + enqueue) ve `routes/kds.ts` (KDS görünürlüğü).
- `install-second-agent.ps1` (`apps/print-agent/installer/`) parametreleri: `-ServiceName -ConfigPath -JobKinds{kitchen|bill|grill} -PrinterName -PrinterHost -PrinterPort -DeviceFingerprint -ApiUrl -SetApiKey -InstallDir -Uninstall`. Dosyanın Türkçe yorumları S100'de **kasıtla ASCII'ye** çevrilmiş (`ag yazicisi`) ve BOM eklenmiş — PS 5.1 mojibake dersi.

**Ortogonal iki kavram (bu Amendment'in omurgası).** Migration 048'in yorum bloğu ayrımı açıkça yazıyor ve kod bunu uyguluyor:

| Kolon | Soru | Otorite | Okuyan |
|---|---|---|---|
| `categories.kitchen_print` (bool, NOT NULL) | "Mutfağa **gider mi**?" | ADR-020 K2 — KDS görünürlüğü **ve** `sent` geçişi + enqueue tetiği | `routes/orders.ts`, `routes/kds.ts` |
| `categories.print_station` (TEXT, nullable) | "**Hangi** mutfak yazıcısı?" | ADR-032 Amd1 — NULL = taban istasyon (`kitchen` = FIRIN) | yalnız enqueue (`print/resolve-item-stations.ts`) |

`kitchen_print=false` olan bir kategori için `print_station`'ın **hiçbir anlamı yoktur** (enqueue o kalemi hiç görmez). Tersi doğru değil: `kitchen_print=true` + `print_station=NULL` bugünkü normal durumdur. UI bu ikisini **ayrı ayrı** sunmak zorundadır; birleştirilirse v3'ün "üç paralel atama kavramı" hatası tekrarlanır.

**Kritik uyarı (taslaktan aynen korunur).** `kitchen_print`'i kapatmak fişi değil, **mutfağın o üründen haberdar olmasını** komple kapatır (fiş + KDS ekranı birlikte). Bu bayrağı sunan her UI bunu onay metninde **iki sonucu birden** yazarak söylemek zorundadır.

---

### Araştırma bulguları

**Yeni — kod-doğrulanmış, taslakta YOKTU (en önemli iki bulgu):**

1. **Register akışı, tek-seferlik anahtar tasarımını DESTEKLER** (`routes/print-jobs.ts:483-563`): apiKey prefix'ten tenant adayları seçilir (`revoked_at IS NULL` filtresiyle), her aday satırın `api_key_hash`'ine karşı `bcrypt.compare` yapılır, eşleşme varsa `(tenant, device_fingerprint)` aranır → **aynı tenant + aynı fingerprint + aktif satır varsa idempotent re-use**, yoksa yeni satır (hash **eşleşen satırdan kopyalanır**). Yani UI'nin önceden oluşturduğu "bekleyen" satır `api_key_hash = hash(yeniAnahtar)` ile yazılırsa, agent aynı fingerprint ile register olduğunda **tam olarak o satıra** oturur. Register kontratı değişmeden çalışır.
2. **Revoke SIZDIRIYOR — `revoked_at` bir agent'ı kalıcı olarak durdurmuyor.** Aynı kodda: `sameTenantRow` ve `otherTenantRow` aramaları `revoked_at === null` filtreli. Devre dışı bırakılmış bir agent yeniden register olduğunda ikisi de bulunamaz → **`else` dalı çalışır ve aynı `device_fingerprint` ile YENİ bir satır INSERT edilir.** Agent tarafı bunu kendiliğinden tetikler: `apps/print-agent/src/index.ts:179-181` "refresh failed → re-registering", `:480` boot'ta register. **Sonuç: devre dışı bıraktığınız yazıcı, servis yeniden başladığında (veya token yenilemesi ilk başarısız olduğunda) yeni bir satır olarak dirilir ve basmaya devam eder.** Bu, tam olarak v3'ün "engelliyormuş gibi görünen ama engellemeyen silme modali" hatasının v5 versiyonudur — ve bugün kimse fark edemez, çünkü ekran yok.
3. `install-second-agent.ps1` **varsayılanları canlı kasa agent'ını hedefliyor** (`-ConfigPath` varsayılanı `print-agent-bill.json`, `-ServiceName` varsayılanı `…Bill`). Ekranın ürettiği komut bu parametreleri **asla varsayılana bırakmamalıdır** — S101 kickoff'u da bunu "ZORUNLU" diye işaretlemiş.

**v3 muadili (`D:\dev\restoran-pos-v3`, salt-okunur çıkarım) — taslaktan korunur.** 3 ekran (Liste 5-kutu özet + "Sorunlu" sayacı / 4-sekmeli Detay / Yönlendirme), 13 endpoint, `printers` + `printer_routing` tabloları. **Ürün sahibinin yargısı: "çok sorunlu ve karmaşık"** → v5 bu ekranı taşımaz, derslerini taşır. **Taşınacak 5 ders:** (1) test baskısı doğrudan yazmaz, normal kuyruğa iş atar → üretim yolunun tamamını sınar; (2) pasifleştirme yönlendirmeleri temizler ve **sayı vererek** bildirir; (3) çözümlenemeyen iş payload'uyla `failed` yazılır (sessiz kayıp yok); (4) hata kodu → Türkçe aksiyon sözlüğü; (5) silme öncesi kullanım özeti. **TEKRARLANMAYACAK 4 hata:** (a) yanıltıcı silme modali (`canHardDelete` sabit `true`, `blockers` hep boş); (b) tip-güvensiz 4-kademeli fallback (son kademe "tip gözetmeksizin ilk aktif yazıcı" → mutfak fişi kasadan çıkabiliyordu); (c) üç paralel atama kavramı + `type`+`roles` ikiliği (ölü kavram); (d) `(business_id, category_id)` UNIQUE gün-1'de yoktu. **v3'te yazılıp KAPATILMIŞ:** serbest fiş şablonu → v5'e hiç girmez.

**Sektör.** Toast/SambaPOS'ta yazıcı yönetimi "istasyon" kavramıdır; fiziksel kurulum daima lokal ajanla yapılır, bulut yalnız **kayıt + eşleme + sağlık** tutar. Bulut UI'sinden Windows servisi kurulamaz — dürüst çözüm "kurulum komutunu üret + kopyalat". **Adisyo'nun "MUTFAK GRUBU" paneli** ürün sahibinin referansı: yazıcıyı aç → hangi kategorileri bastığını işaretle (K3 bu emsali izler).

---

### Kararlar (K1–K14)

**K1 — Kimlik: "yazıcı" = "agent". Ayrı `printers` tablosu AÇILMAZ.** ADR-004 §5 gereği model 1 agent = 1 yazıcı; agent'tan bağımsız bir yazıcı kaydı bugün yok. Ayrı tablo = 1:1 boş-join + senkronize tutulacak ikinci kimlik = v3'ün `type`+`roles` ölü-paralel-kavram hatası. `agents` tablosu **iki nullable kolonla** genişletilir:
- `display_name TEXT` — **istasyon etiketi** olarak konumlanır ("Fırın", "Izgara", "Kasa"). Bu, Amd1'in yarattığı adlandırma borcunu kapatır: `kitchen` kind'ı artık "mutfak" değil **"fırın/taban istasyon"** anlamındadır ve slug'ı değiştirmek canlı veriyi kırar; insan-etiketi bu farkı kullanıcı gözünde kapatır. NULL ise UI `device_fingerprint`'e düşer. Fiş üstündeki etiket ayrı kalır (`print/resolve-item-stations.ts:39-42`, `FIRIN`/`IZGARA` — **UI etiketi fişi DEĞİŞTİRMEZ**; ikisi ayrı katman, bu bilinçli).
- `declared_kinds TEXT[]` — K2.

**Fiziksel ayarlar (transport/IP/port/spooler kuyruk adı/codepage) buluta KOPYALANMAZ.** Tek kaynak dükkan PC'sindeki config dosyasıdır; bulutta bir kopyası olsaydı yalan olurdu (bulut onu ne okur ne yazar). UI bunu açıkça yazar: "Fiziksel ayarlar bu yazıcının kurulu olduğu PC'deki config dosyasındadır." **UI'da "agent" kelimesi geçmez; kullanıcıya "yazıcı" denir** (glossary'ye eklenir).

*Reddedilen:* ayrı `printers` tablosu (yukarıda) · fiziksel ayarları bulutta düzenletmek (ikinci ölü kavram) · `kind` slug'larını Türkçeleştirmek/yeniden adlandırmak (canlı `print_station` verisi + config `jobKinds` + enum kırılır; kod-içi İngilizce kuralı da bunu ister).

**K2 — `declared_kinds` = GÖZLENEN, otoriter DEĞİL; claim hot-path'i DEĞİŞMEZ.** Claim ucu (`GET /print/v1/jobs/next`) agent'ın zaten gönderdiği `?kind=` dizisini normalize ettikten sonra `agents.declared_kinds`'a **fire-and-forget** yazar (`last_seen_at` ile birebir aynı desen, aynı satırda). Sunucu bu alanı **claim filtresinde KULLANMAZ** — ADR-032 Design B aynen kalır.

Gerekçe (taslaktakinden farklı, çünkü "exe donduruldu" kısıtı düştü): (a) **dürüstlük** — ekran, agent'ın gerçekte ne çektiğini gösterir, temenniyi değil (v3 `roles` hatasının panzehiri); (b) **risk ayrıştırma** — cutover'a 3 gün kala aynı hafta içinde hem üç yazıcılı fiziksel kurulumu hem claim semantiğini değiştirmek, bir arıza çıktığında hangisinin sebep olduğunu belirsizleştirir; Design B'yi korumak bu ekranı **tanılayıcı** tutar, **müdahil** değil; (c) sunucu-otoriter rol (Design A) v5.1'de bu veriyi hazır bulur. `?kind=` göndermeyen agent → `NULL` → UI **"Tüm işleri alıyor (filtresiz)"** uyarı çipi basar; bu, ADR-032'nin (−) maddesindeki en tehlikeli yanlış-config'in ilk kez görünür olmasıdır.

*Reddedilen:* ADR-032 Design A'ya terfi (sunucu-otoriter `agents.printer_role`, claim'de rol lookup) — RED (v5.0), yukarıdaki (b); K2 UI ihtiyacının %100'ünü **davranış değiştirmeden** karşılıyor.

**K3 — Atama YÖNÜ: yazıcı panelinden çok-seçimli kategori listesi (kategori tarafından DEĞİL). `[ONAY GEREKLİ]`** Ürün sahibi Adisyo'nun "MUTFAK GRUBU" panelini referans aldı: yazıcıyı aç → hangi kategorileri bastığını işaretle → tek Kaydet ile N kategori yazılır. Bu, 2026-07-20 taslağındaki K11'i (kategori satırının 3-nokta menüsünde "Yazıcı ata") **iptal eder**.

- **Depolama değişmez:** tek kolon `categories.print_station`. Yeni join tablosu **YOK** (bir kategori tam olarak bir istasyona basar; Amd1 modeli bu). Yeni migration da yok — bu karar tamamen UI/uç seviyesindedir.
- **Panel yalnız mutfak-kind yazıcılarda görünür** (`kitchen`/`grill`). `bill` yazıcısında kategori paneli **hiç yoktur** (kasa fişi kategoriye göre yönlenmez) — v3'ün "yanlış tipe yönlendirme" sınıfı hatalar yapısal olarak imkânsız kalır.
- **Liste içeriği:** `kitchen_print=true` olan tüm kategoriler. Her satırda ad + (başka istasyondaysa) "şu an: IZGARA" rozeti.
- **Taban istasyon (NULL) semantiği dürüstçe gösterilir.** FIRIN (`kitchen`) panelinde, `print_station IS NULL` olan kategoriler **işaretli ve kilitli** görünür; tooltip: "Taban yazıcı — hiçbir yazıcıya atanmamış kategoriler buradan basar." Böylece "işareti kaldırdım ama yine buradan basıyor" çelişkisi hiç doğmaz.
- **Kaydet, diff yazar:** yeni işaretlenen → `print_station = <bu istasyon>`; işareti kaldırılan → `print_station = NULL` (= taban istasyon). Onay özeti **sayı vererek** yazar (v3 dersi 2): "3 kategori bu yazıcıya alınacak (2'si IZGARA'dan taşınıyor), 1 kategori FIRIN'a dönecek."
- **Yazma ucu:** `PUT /printers/:id/categories` — tek transaction, tek audit kaydı, tenant-scoped, `deleted_at IS NULL` filtreli. Kategori adı ile eşleme **YASAK**, yalnız UUID (S101'in Türkçe İ/I tuzağı kuralı uç seviyesine taşınır).
- **Uçuştaki iş uyarısı:** Amd1 K10 geri-alma dersi — atama değiştiğinde kuyrukta o kategoriye ait `queued` iş varsa, o iş **eski** kind'la basılır. Kaydet modali bunu tek cümleyle söyler: "Kuyrukta bekleyen işler eski yazıcıdan basılacaktır."

*Reddedilen:* kategori tarafından radyo-seçim (2026-07-20 taslağı K11) — RED, ürün sahibi tersini istedi; ayrıca 9 kategoriyi tek tek açmak yerine tek panelde toplu işaretleme yoğun-saat dostu (HCI) · her iki yönü birden sunmak (iki yazma yolu = iki doğruluk kaynağı = v3'ün üç-paralel-kavram hatasının kapısı) · `category_printers` join tablosu (çoklu atama v5.0'da yok; Amd1 tek kolonu canlıya aldı, üç gün sonra şema değiştirmek gereksiz risk).

**K4 — `kitchen_print` ayrı bir kavramdır, ayrı yerde durur. `[ONAY GEREKLİ: kapsam]`** Yazıcı paneli **yalnız** "hangi yazıcı" sorusunu yönetir. "Mutfağa gider mi" anahtarı kategorinin özelliğidir ve **Menü Tanımları** ekranında, `CategoryListItem` 3-nokta menüsünde yaşar (`assignAttributes` emsali). Yazıcı paneli, kafa karışıklığını önlemek için altta **salt-okunur** bir bölüm gösterir: "Mutfağa gitmeyenler (1): İÇECEKLER" + "Menü Tanımları'ndan değiştirilir" bağlantısı.

- Bu, **v5.0'da yeni bir yetenektir** (bugün `kitchen_print` hiçbir uçtan yazılamıyor — `menu.ts:134-139` yalnız `name`+`sortOrder`). Uygulanırsa `CategoryUpdateRequestSchema`'ya tek opsiyonel `kitchenPrint: boolean` alanı eklenir; **yeni rota açılmaz**.
- **Onay modali iki sonucu birden yazar:** "Bu kategorinin ürünleri artık mutfak yazıcısından basılmayacak **ve mutfak ekranında (KDS) görünmeyecek.**"
- **Bu, kesilebilir bir dilimdir (Dilim C).** Kesilirse İÇECEKLER ayarı S101 planındaki gibi SQL ile girilir ve yazıcı panelindeki salt-okunur bölüm yine gösterilir (okuma zaten var).

*Reddedilen:* `kitchen_print`'i yazıcı panelinde üçüncü bir durum olarak sunmak ("FIRIN | IZGARA | Mutfağa gitmez") — RED: kullanıcıya tek bir seçim gibi görünür ama iki farklı kolona, iki farklı yıkıcılık seviyesinde yazar; "yazıcı değiştiriyorum" niyetiyle KDS kapatılabilir (sessiz üretim arızası). Kavramlar ortogonalse UI de ortogonal olmalıdır · `kitchen_print`'i hiç göstermemek — RED: ekranda görünmeyen bir kategori kullanıcıya "kayboldu" gibi gelir (salt-okunur bölüm bunu çözer).

**K5 — "Yazıcı ekleme" = dürüst 2 aşamalı akış (bulut + PC); üretilen komut kuralları bağlayıcıdır.** Bulut, restoran PC'sine Windows servisi kuramaz; UI bunu iddia etmez. Akış:
1. Admin "Yazıcı Ekle" → form: **görünen ad** · **iş türü** (`Fırın (mutfak)` / `Izgara` / `Kasa`) · **cihaz kimliği** (`device_fingerprint`, öneri otomatik: `<PC>-grill`) · **bağlantı** (`Ağ yazıcısı (IP)` → host+port | `Windows kuyruğu (spooler)` → kuyruk adı) — bağlantı bilgisi **saklanmaz**, yalnız komut üretiminde kullanılır (K1).
2. Sunucu `agents` satırını **bekleyen (pending)** durumda oluşturur; `generateAgentApiKey`/`hashAgentApiKey` mevcut helper'larıyla anahtar üretilir, **yalnız bcrypt hash saklanır**; ham anahtar yanıt gövdesinde **BİR KEZ** döner, ekranda kopyala-butonlu + "Bu anahtar bir daha gösterilmeyecek" uyarısıyla sunulur.
3. Ekran, dükkan PC'sinde çalıştırılacak **hazır PowerShell komutunu** üretir + kopyala butonu + etiket: "Bu komut **dükkan PC'sinde** çalıştırılır. Bulut bu kurulumu uzaktan yapamaz." **Komut üretim kuralları (kod-doğrulanmış, pazarlığa kapalı):**
   - `-ServiceName`, `-ConfigPath`, `-DeviceFingerprint`, `-ApiUrl`, `-JobKinds` **her zaman açıkça** yazılır. Gerekçe: script varsayılanları **canlı kasa agent'ını** hedefliyor (`print-agent-bill.json`, `…Bill`); varsayılana bırakılan bir komut çalışan kasa yazıcısının config'ini ezer.
   - Transport: ağ ise `-PrinterHost <ip> -PrinterPort 9100`, spooler ise `-PrinterName "<kuyruk>"`. İkisi birden **asla** üretilmez.
   - `-SetApiKey` **her zaman** eklenir (anahtar interaktif sorulur; komut satırına/geçmişe düşmez).
   - **Üretilen komut metni saf ASCII'dir** — Türkçe karakter (ı/ğ/ş/İ) içermez. Gerekçe: RustDesk/PowerShell 5.1 paste yolu Türkçe karakterde mojibake üretti (S100 BOM olayı + gist-delivery dersi). Servis adı/fingerprint alanları formda ASCII'ye zorlanır (kullanıcıya görünen `display_name` serbesttir, o komuta girmez).
4. Agent kendini **mevcut** `POST /print/v1/agent/register` ile yazar; satır ilk `last_seen_at` ile *bekleyen* → *çevrimiçi* geçer. **Register imzası DEĞİŞMEZ.**

*Reddedilen:* UI'dan gerçek uzaktan kurulum/servis başlatma vaadi — RED, bulut PC'ye erişemez; vaat edilirse v3'ün yalanı tekrarlanır · komutu "kısa tutmak" için varsayılanlara güvenmek — RED, canlı kasa config'ini ezer · anahtarı komut metnine gömmek — RED, ekran görüntüsü/geçmiş/pano sızıntısı.

**K6 — Anahtar modeli: her yeni yazıcı KENDİ anahtarını alır; mevcut paylaşılan anahtar kırılmaz.** Bugün dükkandaki üç agent tek `PRINT_AGENT_API_KEY`'i paylaşıyor (ayrışma `device_fingerprint` ile) ve register yeni satıra hash'i **eşleşen satırdan kopyalıyor** (`print-jobs.ts:551-561`). Ekrandan eklenen yazıcı bunun yerine **kendi** anahtarını alır. Gerekçe: (a) tek-yazıcı iptali ancak yazıcı başına anahtar varsa anlamlıdır (K7); (b) paylaşılan anahtarın rotasyonu üç servisi birden durdurur; (c) geçiş **kademelidir** — mevcut üç agent'a dokunulmaz, yalnız yeni eklenenler ayrışır. **Maliyet, kayda geçer:** register'daki aday döngüsü her farklı hash için bir `bcrypt.compare` (cost 12, ~250 ms) çalıştırır; 4 anahtarda register ~1 sn sürer. Register nadir (boot + refresh hatası) → kabul.

*Reddedilen:* ekranın da paylaşılan anahtarı göstermesi/yeniden kullanması — RED, ham anahtar tarayıcıya taşınır ve iptal edilemez hale gelir · mevcut üç agent'ı ekran üzerinden ayrı anahtarlara geçirmek — RED (v5.0), cutover haftasında çalışan kimlikleri döndürmek = gereksiz risk; v5.1.

**K7 — Revoke'un sızıntısı KAPATILIR: register'a "iptal edilmiş parmak izi" guard'ı eklenir. `[ONAY GEREKLİ]`** Kod-doğrulanmış bulgu (Araştırma §2): `revoked_at` set etmek agent'ı kalıcı durdurmuyor — servis yeniden başladığında aynı `device_fingerprint` ile **yeni satır** açılıyor ve yazıcı dirilir. Bu, "Devre Dışı Bırak" butonuna sahip bir ekranın kullanıcıya söyleyeceği en büyük yalandır.

**Karar:** `POST /print/v1/agent/register` içinde, aktif satır yokken **aynı tenant + aynı fingerprint'e ait iptal edilmiş satır varsa** yeni satır INSERT edilmez → `403 AGENT_REVOKED` (yeni hata kodu + `error.printAgent.revoked` i18n anahtarı). Aktif satır bulunduğunda davranış **bit-bit aynı** kalır (idempotent dal). **Bağlayıcı eşleşme:** revoke özelliği ile bu guard **birlikte** sevk edilir; guard olmadan revoke UI'si **sevk edilmez** (ya ikisi, ya hiçbiri). Ekranda "geri al" (restore) zaten var → yanlış tıklama SQL gerektirmeden düzeltilir.

*Reddedilen:* yalnız dürüst metinle geçiştirmek ("PC'de servisi de kaldırın") — RED: kullanıcı komutu çalıştırmayı unutursa sistem sessizce eski hale döner; güvenlik kararı kullanıcı disiplinine bırakılmaz (öncelik sırası: güvenlik > hız) · revoke'u v5.0'dan tamamen çıkarmak — kabul edilebilir geri çekilme (Dilim D kesilir), ama o zaman ekranda "Devre Dışı Bırak" butonu **hiç görünmez** · agent'ın API anahtarını iptalde silmek — RED, paylaşılan anahtarda diğer iki servisi öldürür.

**K8 — "Silme" = devre dışı bırakma (revoke) + gerçek engel + PC talimatı.** Hard delete **yok** (denetim izi + geçmiş işler). Modal, v3'ün yalanını tekrarlamaz:
- **Gerçek kullanım özeti**: bu istasyona atanmış kategori sayısı · o kind'da bekleyen/başarısız iş sayısı · son görülme.
- **Gerçekten uygulanan blokerler** (buton *gerçekten* pasif olur): (a) bir kind'ı üstlenen **son çevrimiçi yazıcı** devre dışı bırakılamaz — engel metni sayıyla; (b) o kind'da bekleyen iş varsa ve devralacak aktif yazıcı yoksa engel; (c) **`kitchen`/`grill` istasyonuna atanmış kategori varken o istasyonun son yazıcısı kapatılamaz** — Amd1'in yetim-iş sorunu (K10: `grill` işi `kitchen` agent'ının kind filtresi yüzünden **reclaim bile edilemez**) tekrarlanmasın diye. Engel metni yol gösterir: "Önce bu 3 kategoriyi başka bir yazıcıya alın."
- `revoke_reason` (mevcut kolon) **zorunlu** serbest metin. **Restore** UI'da vardır.
- Modal, PC'de yapılacak işi de verir: `install-second-agent.ps1 -Uninstall -ServiceName <ad>` — çünkü revoke servisi durdurmaz, yalnız yetkisini kaldırır (K7 guard'ı ile birlikte artık gerçekten kaldırır).

**K9 — Test baskısı: v3 dersi aynen (kuyruktan geçer).** `POST /printers/:id/test-print` doğrudan yazıcıya yazmaz; **normal `print_jobs` kuyruğuna** satır atar, `payload.kind` = o yazıcının beyan ettiği kind → mevcut ADR-032 filtresi işi doğru agent'a teslim eder. İçerik **ADR-004 Amd9 raster** boru hattıyla üretilir (`test-receipt.ts`: işletme adı + yazıcı görünen adı + cihaz kimliği + tarih/saat + Türkçe alfabe + `₺` + buzzer) → tek tıkla **kuyruk→claim→transport→raster→kağıt** zincirinin tamamı sınanır. UI sonucu `GET /printers/jobs/:jobId` ile yoklar, `success`/`failed` + hata metnini gösterir.

**Dürüstlük notu (güncellendi — v5.0 sınırı):** `print_jobs`'ta `printer_id` **yok** (kod-doğrulandı); iş yazıcıya değil **kind'a** yönlenir. Hedeflenen üç yazıcının **her biri farklı kind beyan ettiği** için (FIRIN=`kitchen` · IZGARA=`grill` · KASA=`bill`) test baskısı bugün **belirlenimlidir**. Aynı kind'ı beyan eden iki yazıcı kurulursa testin hangisine düşeceği garanti edilemez — bu sınır ekranda dipnot olarak yazılır ve yazıcı listesinde aynı kind'ı paylaşan yazıcılar **uyarı çipiyle** işaretlenir.

**K10 — Durum/monitoring eşikleri.** `GET /printers` her yazıcı için: görünen ad · cihaz kimliği · `declared_kinds` · `last_seen_at` · `revoked_at` · hesaplanan durum · kendi kind'ındaki kuyruk derinliği · atanmış kategori sayısı. Agent ≤25 sn long-poll yaptığından: **Çevrimiçi** `last_seen_at < 60 sn` · **Gecikmeli** 60 sn – 5 dk · **Çevrimdışı** > 5 dk veya hiç görülmemiş · **Devre dışı** `revoked_at IS NOT NULL` · **Bekliyor** (kaydedildi, hiç register olmadı).

**"Sorunlu" tanımı** (v3'ün kırmızı sayacının v5 karşılığı) — şunlardan biri: çevrimdışı · kendi kind'ında `failed`/`retry` iş var · kind beyanı yok (filtresiz çekiyor) · **bir kind'ı üstlenen çevrimiçi yazıcı yok = yetim kuyruk** · **iptal edilmiş bir yazıcının parmak izi aktif bir satırda yeniden görünüyor** (K7 öncesi dirilmiş satırların teşhisi) · aynı kind'ı iki aktif yazıcı beyan ediyor (K9 belirsizliği).

Yetim kuyruk göstergesi bu ekranın **en yüksek operasyonel değeridir** ve Amd1 ile değeri arttı: artık **üç** hat var, `grill` işini `kitchen` agent'ı **reclaim bile edemez** → "ızgara basmıyor" sessiz arızası ancak burada görünür. Tazeleme: ekran açıkken **react-query 10 sn polling**; yeni Socket.IO olayı **YOK** (kapsam kilidi).

**K11 — Yetki + denetim izi: ölü `printer.settings` bağlanır.** Tüm yeni uçlar **kullanıcı-JWT + `requirePermission('printer.settings')`**; v5.0'da **yalnız `admin`** (test baskısı kağıt harcar, anahtar üretir). Uçlar `/print/v1` ailesinin **DIŞINA** (`/printers`) mount edilir; o aile agent-JWT'lidir. `rbac-parity.test.ts:239`'daki muafiyet satırı kaldırılıp gerçek assert'lere dönüşür. **Denetim (ADR-024):** yazıcı oluşturma (anahtar üretimi) · revoke/restore · **kategori atama değişikliği** (eski→yeni istasyon, kategori id'leri) · `kitchen_print` değişikliği audit'e yazılır; **ham API anahtarı hiçbir log/audit payload'ına GİRMEZ**.

**K12 — Migration güvenliği (KIRMIZI BAYRAK — canlı veri, cutover'a 3 gün).** `049_agents_display_name_declared_kinds.sql`, **yalnız toplayıcı**: `ALTER TABLE agents ADD COLUMN IF NOT EXISTS display_name TEXT` + `ADD COLUMN IF NOT EXISTS declared_kinds TEXT[]`. **DEFAULT yok** (tablo yeniden yazımı yok) · **NOT NULL yok** · **index yok** (tablo ≤4 satır) · **CHECK yok** · kilit ACCESS EXCLUSIVE ama ~ms · **forward-only, DOWN yok** (ADR-003 §9.5c — 048 emsali; kolonlar nullable ve nötr, geri alma veri seviyesinde). **`categories`, `products`, `print_jobs`, `orders` tablolarına HİÇ DOKUNULMAZ** — bu Amendment'in en önemli güvenlik özelliği; `print_station` kolonuna da dokunulmaz (048 canlı).

**Backfill YOK:** `display_name` NULL kalır (UI fingerprint'e düşer, admin 1 dakikada ekrandan adlandırır); `declared_kinds` ilk poll'da (saniyeler içinde) kendini doldurur. ADR-031 K12 CONCURRENTLY gate **tetiklenmez** (index yok). **db-migration-guard'ın soracakları ve cevapları:** satır sayısı ≤4 · kilit ~ms · DEFAULT rewrite yok · veri kaybı yok · PG17 `TEXT[]` (proje PG-only) · **codegen doğrulaması zorunlu** (`git diff packages/db/src/generated.ts` → `display_name: string | null` + `declared_kinds: string[] | null`) · merge öncesi `gh pr list --state open` ile numara çakışması kontrolü (048'den sonra sıradaki numara **049**). **`COMMENT ON COLUMN` yazılırsa codegen JSDoc üretir** — manuel edit migration-check'i kırar, yalnız codegen çıktısı commit edilir.

**K13 — TAKVİM ve DİLİMLEME (bu Amendment'in en kırılgan kararı). `[ONAY GEREKLİ]`**

**Gerçek pencere: 3 takvim günü — 21, 22, 23 Temmuz.** Cutover penceresi 24–26 Temmuz ve **cutover günlerinde deploy YAPILMAZ** kuralı korunur (ADR-031). Prod'da ≥1 tam gün canlı gözlem istendiğinden fiilî hedef **23 Temmuz akşamı deploy**. Aynı pencerede yarışan işler: S100 prod dalgası, ızgara agent kurulumu + fiziksel smoke, atama SQL'i, EAS mobil dalgası, cutover runbook'unun bayat bölümleri.

**Dürüst değerlendirme, kayda geçer: tam kapsam (K1–K12) bu pencereye SIĞMAZ.** Bu yüzden iş **sevk edilebilir dilimlere** ayrılır ve dilim sınırında durulabilir:

| Dilim | İçerik | Değeri tek başına var mı? | Hedef |
|---|---|---|---|
| **A — Görünürlük** | Migration 049 + claim'de `declared_kinds` yazımı + `GET /printers` + liste ekranı (durum · kuyruk derinliği · **yetim kuyruk** · filtresiz-agent çipi) + `PATCH /printers/:id` (yalnız `display_name`) | **EVET** — cutover haftasının teşhis aracı; ızgara kurulumunun kabul kriterini ("üç canlı agent") ekrandan doğrular | ≤23 Tem |
| **B — Atama** | `PUT /printers/:id/categories` + yazıcı panelinde çok-seçimli kategori listesi (K3) | **EVET** — atama SQL'inin yerini alır, İ/I tuzağını ortadan kaldırır | ≤23 Tem (hedef) |
| **C — `kitchen_print`** | Kategori tarafında anahtar (K4) + onay modali | Kısmen — SQL alternatifi var | Cutover sonrası |
| **D — Ekleme/İptal** | `POST /printers` + tek-seferlik anahtar + komut üretimi (K5/K6) + revoke/restore (K8) **+ K7 guard'ı** | **EVET** ama ızgara kurulumundan sonra gelirse değeri düşer | Cutover sonrası |
| **E — Test baskısı** | `POST /printers/:id/test-print` + `test-receipt.ts` (K9) | **EVET** — saha teşhisi | Cutover sonrası |

**Öneri: A + B, 23 Temmuz'a. C/D/E cutover sonrası.** Gerekçe: A ekranın *tanılayıcı* yarısıdır ve cutover haftasında en çok o lazım; B, elle SQL'in yerini alarak insan hatası riskini düşürür; D en çok kod + en çok güvenlik yüzeyi getirir ve ızgara kurulumu zaten **onu beklemez** (aşağı bakınız).

**Bu özellik cutover blokeri DEĞİLDİR** (2026-07-20 taslağının bu ilkesi aynen korunur): hiçbir dilim yetişmezse cutover onsuz yapılır, `install-second-agent.ps1` + doğrudan SQL yolu çalışmaya devam eder. Yetişmeyen dilim **24–26 Temmuz'da deploy edilmez**, cutover sonrasına kayar.

**Izgara kurulumu bu ekranı BEKLEMEZ — ikisi paralel yürür.** `.claude/plans/session-101-kickoff.md` §2'deki reçete (yeni exe 0.0.4 → mutfak config teyidi → `-JobKinds grill` + TCP kurulum → fiziksel smoke → iki fazlı atama SQL'i) **olduğu gibi uygulanır**; kurulum bu ekrana bağımlı değildir çünkü mevcut paylaşılan anahtar kullanılır ve fingerprint ayrıştırması zaten çalışıyor. Ekran, kurulum**dan sonra** devreye girerse **doğrulama aracı** olur (üç agent listede görünür mü, `declared_kinds` doğru mu, yetim kuyruk var mı); kurulum**dan önce** yetişirse ek olarak **kolaylaştırıcı** olur. **Bağımlılık tek yönlüdür ve zayıftır: ekran ızgarayı bekler, ızgara ekranı beklemez.**

*Reddedilen:* tüm kapsamı 23 Temmuz'a sıkıştırmak — RED, gate'ler (security-reviewer + hci-reviewer + db-migration-guard) kalabalık bir PR'da anlamlı çalışamaz; DoD kalitesi düşer ve cutover haftasına yarım özellik girer · işi tekrar cutover sonrasına ertelemek — RED, ürün sahibi kararını değiştirdi ve A dilimi tam da cutover haftasında değerli · cutover günlerinde "küçük bir deploy" yapmak — RED, ADR-031 kuralı.

**K14 — Kapsam kilidi: v5.0'da NE YOK (açık liste). `[ONAY GEREKLİ]`** (1) kategori→**çoklu** yazıcı ataması; (2) **ürün seviyesinde** yazıcı override (`products.printer_target` — Migration `015` "kapsam dışı" der); (3) kopya sayıları (`copies`); (4) otomatik-yazdırma politikaları (v3'ün 6 olay bayrağı); (5) serbest fiş şablonu (v3'te yazılıp kapatılmış); (6) yazıcı başına font/satır-genişliği/codepage (ADR-004 Amd9 raster bunları anlamsızlaştırdı); (7) **yazıcı keşfi/tarama** (agent kontratı gerektirir); (8) uzaktan servis başlat/durdur/yeniden başlat; (9) hard delete; (10) **çok-tenant** yazıcı yönetimi (tek-tenant pilot); (11) print job geçmişi tarayıcısı + toplu retry UI; (12) tam hata-kodu→Türkçe-aksiyon sözlüğü (v3 dersi 4) — v5.0'da yalnız son hata metni + tek satırlık genel aksiyon; (13) fiziksel ayarların (IP/port/kuyruk adı) bulutta saklanması ve düzenlenmesi; (14) **dördüncü fiziksel hat** (bar vb.) — Amd1 `grill`'i v5.0'a aldı, yenisi ayrı karar ister (`PrintJobKindSchema` + `KITCHEN_STATION_KINDS` + yeni exe + config). **v3'ün 4-sekmeli detay formu kasıtla taşınmaz** — "Basit UI prensibi": iki seviye + zero-config; ürün sahibinin v3 yazıcı ekranı hakkındaki yargısı ("çok sorunlu ve karmaşık") bu kilidin gerekçesidir.

---

### Değerlendirilen alternatifler (özet — gerekçeler ilgili kararların altında)

- **Ayrı `printers` tablosu + `category_printers` join tablosu (v3 modelinin v5 kopyası):** RED (v5.0) — 1 agent = 1 yazıcı olduğundan 1:1 boş-join; çoklu atama v5.0'da yok; Amd1 tek kolonu **üç gün önce** canlıya aldı, şema değiştirmek gereksiz risk. v5.1'de çoklu atama gelirse doğru araç budur.
- **`kitchen_print` ile `print_station`'ı tek bir UI kontrolünde birleştirmek:** RED — ortogonal kavramlar; birleşik kontrol "yazıcı değiştiriyorum" niyetiyle KDS'i kapatabilir (K4).
- **Kategori tarafından atama (2026-07-20 taslağı K11):** RED — ürün sahibi Adisyo emsaliyle ters yönü seçti; ayrıca toplu işaretleme yoğun-saat dostu (K3).
- **ADR-032 Design A'ya terfi (sunucu-otoriter rol):** RED (v5.0) — cutover haftasında claim semantiğini değiştirmek arıza atfını belirsizleştirir (K2).
- **Revoke'u guard'sız sevk etmek:** RED — kod-doğrulanmış diriliş yolu (K7) buton yalanı üretir. Alternatif kabul edilebilir geri çekilme: revoke'u v5.0'dan çıkarmak (Dilim D).
- **UI'dan gerçek uzaktan kurulum vaadi / fiziksel ayarları bulutta tutmak / testi kuyruğu atlayarak yapmak / yeni Socket.IO olayı:** hepsi RED — sırasıyla v3 yalanı · ikinci ölü kavram · yalancı güven · test edilmeyen realtime kontratı sessizce ölür.
- **İşi tekrar cutover sonrasına ertelemek:** RED (ürün sahibi kararı), ancak **dilim sınırında durma** (K13) resmî geri çekilme yoludur.

---

### Sonuçlar

- (+) **Yetim kuyruk ve filtresiz-agent ilk kez görünür olur** (K10) — ADR-032'nin yazılı ama ölçülemeyen riski, Amd1'in üç hatlı dünyasında cutover haftasında teşhis edilebilir hale gelir. `grill` işinin `kitchen` agent'ınca reclaim edilememesi, ancak bu ekranla fark edilebilir.
- (+) **Revoke'un sızıntısı kapanır** (K7) — bugün canlıda var olan, kimsenin fark edemediği bir "iptal edilmiş agent dirilir" yolu tespit edildi ve kapatılıyor.
- (+) **Atama SQL'i UI'ya taşınır** (K3) — prod'da elle `UPDATE categories` çalıştırma ihtiyacı ve Türkçe İ/I eşleşme tuzağı ortadan kalkar; her atama audit'e düşer.
- (+) **v3'ün 4 hatası yapısal olarak imkânsızlaşır:** yanıltıcı silme modali → gerçek blokerler (K8) · tip-güvensiz fallback → `bill` yazıcısında kategori paneli hiç yok + `KITCHEN_STATION_KINDS` doğrulaması (Amd1 K5) · üç paralel atama kavramı → iki ortogonal kolon, iki ayrı ekran (K3/K4) · `type`+`roles` ikiliği → tek gözlenen alan `declared_kinds` (K2).
- (+) Ölü `printer.settings` yetkisi canlanır; RBAC matrisindeki boşluk kapanır (K11).
- (+) Tek tıkla **uçtan uca** test baskısı (K9) — kuyruk+transport+raster+buzzer birlikte; saha teşhis süresi dakikalardan saniyelere iner.
- (−) **Canlı veri üzerinde migration, cutover'a 3 gün kala** — additive-only + backfill'siz olsa da sıfır risk değil; K13 takvim disiplini (≤23 Tem, cutover günlerinde deploy yok) tek kontroldür.
- (−) **Takvim gerçekten sıkışık** — aynı 3 günde S100 prod dalgası + ızgara kurulumu + fiziksel smoke + EAS dalgası var. Dilimleme (K13) bunu yönetilebilir kılar ama **tam kapsamın yetişmeyeceği baştan kabul edilmiştir**.
- (−) **`kitchen_print` yanlış tıklaması sessiz üretim arızasıdır** — kategori hem fişten hem KDS'ten düşer. Tek savunma UI metni + onay modali + audit (K4/K11); teknik engel yok (bilinçli ödünleşim: kullanıcı bu ayarı gerçekten değiştirebilmeli).
- (−) **Yazıcı ekleme tek adımda bitmez** (bulut + PC) — dürüstlük uğruna kabul edildi (K5). PowerShell adımı kalıcı olarak `[USER]` işidir.
- (−) `declared_kinds` **gözlenen** olduğundan yeni "bekleyen" yazıcı ilk poll'a kadar kind'ını göstermez (≤25 sn penceresi).
- (−) Yeni admin HTTP yüzeyi + anahtar üretimi + revoke + **register'da yeni 403 dalı** → `security-reviewer` **zorunlu**; tarayıcıda bir kez gösterilen ham anahtar yeni bir sızma yüzeyidir (log/audit yasağı K11 ile kapatıldı).
- (−) K6 ile dükkanda ikinci bir API anahtarı doğar → register'daki bcrypt aday döngüsü uzar (~250 ms/anahtar) ve **anahtar envanteri** artık iki kalemdir (runbook/`pos-secrets.env` notu şart).
- (−) ADR-032'nin "Yönetim UI'si YOK" kilidi kısmen açılıyor; ADR-022 v5.1 listesi ve **henüz `decisions.md`'ye taşınmamış Amd1 metni** güncellenmezse belge-kod driftine yol açar (DoD'de madde var).

---

### Riskler ve azaltımlar

| # | Risk | Azaltım |
|---|---|---|
| R1 | Cutover haftasında yarım kalmış ekran prod'a girer | K13 dilimleme; dilim sınırında **durulabilir**; yetişmeyen dilim 24-26'da deploy edilmez |
| R2 | K7 guard'ı canlı bir agent'ı yanlışlıkla 403'e düşürür | Guard yalnız **aktif satır yok + iptal edilmiş satır var** dalında; restore UI'da; entegrasyon testi (aktif satır varken davranış bit-bit aynı) |
| R3 | Kategori atama, kuyrukta bekleyen işleri yetim bırakır | K3 kaydet-modalinde uyarı + Amd1 K10 geri-alma sırası (önce uçuştaki job'ları çevir, sonra kolonu) runbook'ta |
| R4 | Üretilen kurulum komutu canlı kasa config'ini ezer | K5: `-ConfigPath`/`-ServiceName`/`-DeviceFingerprint` **her zaman açık**; ASCII zorunluluğu |
| R5 | Bekleyen satır ile komuttaki fingerprint uyuşmaz → yetim "bekleyen" satır | Komut ekrandan kopyalanır (elle yazılmaz); liste "Bekliyor" durumunu gösterir; bekleyen satır revoke edilebilir (revoke → register aday listesinden düşer → anahtar geçersizleşir) |
| R6 | `agents` tablosuna yazan claim hot-path'i yavaşlar | Fire-and-forget, `last_seen_at` ile **aynı** UPDATE'e eklenir; ek sorgu yok; p95 ölçümü uzun-poll uçlarını zaten hariç tutuyor |
| R7 | Gate'ler (security/hci/turkish-ux/db-migration) 3 güne sığmaz | Dilimler ayrı PR'lar; A diliminin gate yükü en hafif (okuma + 1 migration) |

---

### Kapsam kilidi (CLAUDE.md testi)

- **"v3'te vardı mı?"** → EVET (3 ekran, 13 uç) — ama ürün sahibi "çok sorunlu ve karmaşık" dedi; v5 **davranışı** değil **dersleri** taşır (K14).
- **"v5.0 MVP listesinde mi?"** → HAYIR; ADR-032 bunu açıkça v5.1'e ertelemişti. Bu Amendment kilidi **ürün sahibinin 2026-07-21 açık talebiyle** ve dar bir kapsamla açıyor; K14 listesi yeni kilidi tanımlar. ADR-022 v5.1 backlog'undan "Print Agent Manager UI" kalemi düşer, yerine K14 maddeleri girer.

---

### Definition of Done (implementer — bu Amendment Accepted olduktan SONRA; dilim sırası K13)

**Dilim A — Görünürlük (≤23 Tem hedef)**
- [ ] **Migration `049_agents_display_name_declared_kinds.sql`:** `display_name TEXT` + `declared_kinds TEXT[]` (ikisi de nullable, DEFAULT/index/CHECK yok, forward-only). `categories`/`products`/`print_jobs`/`orders` tablolarına **dokunulmadığı** doğrulanır. **db-migration-guard onayı zorunlu** (K12 soru listesi cevaplanır). Merge öncesi `gh pr list --state open` numara-çakışması kontrolü.
- [ ] **Codegen:** `pnpm codegen` sonrası `git diff packages/db/src/generated.ts` ile `display_name: string | null` + `declared_kinds: string[] | null` üretildiği **gözle doğrulanır** (env-passthrough tuzağı → gerekirse direct npx). `COMMENT ON COLUMN` yazıldıysa JSDoc çıktısı **manuel düzenlenmez**.
- [ ] **`routes/print-jobs.ts` claim handler:** mevcut `?kind=` normalize sonucu `agents.declared_kinds`'a **fire-and-forget** yazılır (`last_seen_at` deseni, aynı UPDATE). **Claim SELECT/UPDATE sorgusuna DOKUNULMAZ** — ADR-032 Design B davranışı bit-bit korunur (5 ADR-032 senaryosu + Amd1 istasyon testleri regresyon olarak yeşil).
- [ ] **`routes/printers.ts` (yeni, `/print/v1` DIŞINDA, kullanıcı-JWT + `requirePermission('printer.settings')`, yalnız `admin`):** `GET /printers` (durum + kuyruk derinliği + atanmış kategori sayısı, K10 eşikleri) · `PATCH /printers/:id` (yalnız `display_name`). zod şemaları `shared-types`'ta; `any` yok.
- [ ] **`apps/web`:** `/tanimlamalar/yazicilar` rotası (`router.tsx` lazy) + Sidebar "Tanımlamalar" grubu (`Sidebar.tsx:80-86`); `features/admin/printers/` (UsersPage emsali: PageHeader + liste + Drawer + `api.ts` react-query, 10 sn polling). "Sorunlu" çipleri (K10 altı koşul) + "Fiziksel ayarlar PC'deki config dosyasındadır" notu.
- [ ] **RBAC:** `rbac-parity.test.ts:239` muafiyeti kaldırılır, `printer.settings` için gerçek assert'ler (admin ✓ / cashier·waiter·kitchen 403).

**Dilim B — Atama (≤23 Tem hedef)**
- [ ] **`PUT /printers/:id/categories`:** tek transaction, tenant-scoped, **yalnız UUID ile eşleme** (ad/`ILIKE`/`lower()` YASAK), `deleted_at IS NULL`, yalnız `kitchen_print=true` kategoriler; `KITCHEN_STATION_KINDS` dışına yazma reddedilir; tek audit kaydı (eski→yeni istasyon + kategori id'leri).
- [ ] **Yazıcı paneli çok-seçimli kategori listesi (K3):** yalnız mutfak-kind yazıcılarda; başka istasyondaki kategorilerde "şu an: X" rozeti; taban istasyon panelinde NULL kategoriler **işaretli+kilitli** + tooltip; kaydet özeti **sayı verir**; "kuyrukta bekleyen işler eski yazıcıdan basılır" uyarısı.
- [ ] Salt-okunur "Mutfağa gitmeyenler (N)" bölümü + Menü Tanımları bağlantısı (K4).

**Dilim C — `kitchen_print` anahtarı (cutover sonrası)**
- [ ] `CategoryUpdateRequestSchema`'ya opsiyonel `kitchenPrint`; `menu.ts` PATCH genişletilir (**yeni rota yok**); `CategoryListItem` 3-nokta menüsüne kalem; onay modali **iki sonucu birden** yazar (fiş + KDS); audit.

**Dilim D — Ekleme / İptal (cutover sonrası) — K7 guard'ı ile BİRLİKTE sevk edilir**
- [ ] `POST /printers` (bekleyen satır + `api_key_hash` = yeni anahtarın hash'i + tek-seferlik ham anahtar) · `POST /printers/:id/revoke` (gerçek blokerler K8 + zorunlu `revoke_reason`) · `POST /printers/:id/restore`.
- [ ] **K7 register guard'ı:** aktif satır yok + aynı (tenant, fingerprint) iptal edilmiş satır var → `403 AGENT_REVOKED` (+ `errors.ts` kodu + i18n anahtarı). **Aktif satır varken davranış bit-bit aynı** — entegrasyon testiyle kanıtlanır.
- [ ] **K5 register uyumu doğrulanır:** önceden oluşturulmuş bekleyen satır + aynı fingerprint ile register **idempotent** dala düşer (409 DEĞİL) — entegrasyon testi. Düşmüyorsa **bekleyen-satır şekli** düzeltilir, register kontratı DEĞİL.
- [ ] **Komut üreteci (K5):** `-ServiceName -ConfigPath -DeviceFingerprint -ApiUrl -JobKinds` her zaman açık · transport'a göre `-PrinterHost/-PrinterPort` **veya** `-PrinterName` (asla ikisi) · `-SetApiKey` her zaman · **çıktı saf ASCII** (birim testle doğrulanır: `/^[\x20-\x7E\r\n]+$/`).
- [ ] Tek-seferlik anahtar: kopyala butonu + "bir daha gösterilmeyecek" uyarısı; **ham anahtar log/audit'e girmez** (test).

**Dilim E — Test baskısı (cutover sonrası)**
- [ ] `POST /printers/:id/test-print` (kuyruğa iş, K9) + `GET /printers/jobs/:jobId` + `print/templates/test-receipt.ts` (ADR-004 Amd9 **raster**: işletme adı + yazıcı adı + cihaz kimliği + tarih/saat + Türkçe alfabe + `₺` + buzzer). Aynı kind'ı paylaşan yazıcılarda belirsizlik dipnotu + uyarı çipi.

**Her dilim için ortak**
- [ ] **i18n:** tüm metinler `admin.printers.*` altında `tr.json`'a; hardcoded string yok. **Glossary** (`docs/domain/glossary.md`): "yazıcı" = agent; UI'da "agent" kelimesi kullanılmaz; "istasyon" = FIRIN/IZGARA.
- [ ] **Test (LOKAL `pos_test` — `pos_dev` DEĞİL):** claim regresyonu · `declared_kinds` poll sonrası dolar · K10 eşikleri (60 sn / 5 dk / yetim kuyruk) birim testi · atama ucu UUID-dışı girdi reddi · RBAC 403'leri · (D) revoke blokerleri + guard + tek-seferlik anahtar ikinci kez dönmez.
- [ ] **Gate'ler:** `security-reviewer` (D dilimi: anahtar üretimi/tek-seferlik gösterim/revoke/register guard'ı) **zorunlu** · `hci-reviewer` + `turkish-ux-reviewer` (atama paneli, yıkıcı revoke modali, KDS-eşleşme uyarısı) **zorunlu** · `db-migration-guard` (A dilimi) **zorunlu**.
- [ ] **Belge senkronu:** **ADR-032 Amd1 metni `decisions.md`'ye taşınır** (bugün yalnız plan dosyasında; kodu canlı) → sonra bu Amendment eklenir; ADR-032 kapsam-kilidi paragrafı güncellenir; ADR-022'den "Print Agent Manager UI" düşer (yerine K14); `docs/project-charter.md:57-58` yazıcı satırları üç yazıcı gerçeğine çekilir; Print Agent runbook'una "yazıcı ekleme admin ekranından başlar" + **ikinci API anahtarının envanteri** notu.
- [ ] **Deploy disiplini (K13):** prod'a **en geç 23 Temmuz 2026**; **24–26 Temmuz cutover günlerinde deploy YOK**; yetişmeyen dilim cutover sonrasına. Deploy sırası: migration → `shared-types` dist build → API (pm2 restart) → web. Deploy notunda **exe/MSI/nssm/config'e dokunulmadığı** teyit edilir (bu Amendment print-agent binary'sini değiştirmez; 0.0.4 exe'si Amd1'in işidir).
- [ ] `any` yok; strict geçer; cerrahi değişiklik (yalnız whitelist dosyalar); tam suite + CI yeşil.

**Fiziksel / `[USER]` maddeleri (kod DoD'undan ayrı — bu ekran onlarsız "tamam" sayılmaz)**
- [ ] `[USER]` **Üç yazıcı da listede doğru durumda görünüyor:** FIRIN · IZGARA · KASA — `declared_kinds` sırasıyla `kitchen` · `grill` · `bill`, üçü de **Çevrimiçi**. (Amd1 kurulumunun bağımsız kabul kriteriyle çakışır; ekran onu **doğrular**.)
- [ ] `[USER]` **Üçüne de görünen ad verildi** ("Fırın", "Izgara", "Kasa") ve liste fingerprint yerine bu adları gösteriyor.
- [ ] `[USER]` **Yetim kuyruk göstergesi gerçek olayla sınandı:** ızgara servisi kasıtla durdurulur → `grill` kategorili bir sipariş gönderilir → ekranda "yetim kuyruk / çevrimdışı" uyarısı çıkar → servis geri açılır → iş basılır ve uyarı kalkar.
- [ ] `[USER]` **(B dilimi) Atama ekrandan yapıldı, kağıtla doğrulandı:** bir kategori IZGARA'ya alınır → sipariş → **fiş doğru yazıcıdan** çıkar; sonra FIRIN'a geri alınır → yine doğru yazıcıdan çıkar. SQL kullanılmaz.
- [ ] `[USER]` **(D dilimi) Üretilen komut gerçekten çalışıyor:** ekrandan kopyalanan komut dükkan PC'sinde (veya birebir kopyası bir test PC'sinde) çalıştırılır → servis kurulur → yazıcı listede *Bekliyor* → *Çevrimiçi* geçer. Mojibake/paste bozulması **yok**.
- [ ] `[USER]` **(D dilimi) Revoke gerçekten durduruyor:** bir test yazıcısı devre dışı bırakılır → servis **yeniden başlatılır** → agent 403 alır, **yeni satır oluşmaz**, basmaz. Sonra restore → tekrar çalışır.
- [ ] `[USER]` **(E dilimi) Test baskısı üç yazıcıda da kağıda çıkıyor:** Türkçe harfler + `₺` + buzzer doğru; kesme (cut) çalışıyor.
- [ ] `[USER]` **Geri alma provası yapıldı:** ekran/uç arızalanırsa `install-second-agent.ps1` + doğrudan SQL yolunun hâlâ çalıştığı teyit edilir (bu özellik cutover blokeri değildir — kanıtı budur).

---

### Açık sorular (ürün sahibi kararı gerekir)

1. **`[ONAY GEREKLİ]` Dilimleme (K13):** A+B 23 Temmuz'a, C/D/E cutover sonrasına — kabul mü?
2. **`[ONAY GEREKLİ]` K7:** revoke ile register guard'ı birlikte sevk edilir (ya ikisi ya hiçbiri) — kabul mü?
3. **`[ONAY GEREKLİ]` K4:** `kitchen_print` anahtarı v5.0'a girsin mi (Dilim C), yoksa SQL'de mi kalsın?
4. **`[ONAY GEREKLİ]` K14:** kapsam kilidi listesi (14 madde) onaylanıyor mu?
5. **Numaralandırma:** "ADR-032 Amendment 2" mi, bağımsız "ADR-034" mü?

<!-- ADR-032 Amendment 2 PROPOSED (2026-07-21) — YAZICI YÖNETİM EKRANI, cutover ÖNCESİNE alındı (İlhan 20-Tem akşamı ertelemişti, 21-Tem "şimdi yapalım"). ÖNCEKİ TASLAK (adr-032-amd1-yazici-yonetimi.md, 20-Tem) ÇÜRÜDÜ: "exe DONDURULDU" + "tek mutfak yazıcısı" varsayımları Amd1 (PR #405, Migration 048 CANLI, enum kitchen|bill|grill) ile düştü. ORTOGONAL İKİ KOLON omurga: kitchen_print(bool,NOT NULL)="mutfağa gider mi"=KDS görünürlüğü+sent-transition (orders.ts+kds.ts, ADR-020 K2) · print_station(TEXT,null)="hangi yazıcı", NULL=taban=kitchen=FIRIN, yalnız enqueue okur (resolve-item-stations.ts, KITCHEN_STATION_KINDS doğrulaması). KOD-DOĞRULANMIŞ YENİ BULGULAR: (1) register (print-jobs.ts:483-563) tek-seferlik anahtarı DESTEKLER — bekleyen satır api_key_hash=hash(yeniKey) → aday lookup(revoked_at IS NULL) → bcrypt → aynı fingerprint idempotent dal; (2) 🔴 REVOKE SIZDIRIYOR — sameTenantRow/otherTenantRow aramaları revoked_at===null filtreli → iptal edilmiş agent yeniden register olunca else dalı AYNI fingerprint ile YENİ SATIR açar; agent bunu kendiliğinden tetikler (index.ts:179-181 refresh-fail→re-register, :480 boot) → devre-dışı yazıcı servis restart'ında DİRİLİR = v3'ün "engelliyormuş gibi görünen modal" hatasının v5 hâli; (3) install-second-agent.ps1 varsayılanları CANLI KASA agent'ını hedefliyor (print-agent-bill.json/…Bill) → üretilen komut varsayılana bırakılamaz; (4) print_jobs'ta printer_id YOK (generated.ts:348-363) → iş kind'a yönlenir; (5) kitchen_print HİÇBİR uçtan yazılamıyor (menu.ts:134-139 yalnız name+sortOrder); (6) printer.settings ölü (permissions.ts:48,89; rbac-parity.test.ts:239 muafiyet). KARARLAR: K1 "yazıcı"=agent, ayrı printers tablosu YOK; agents+display_name TEXT(=İSTASYON ETİKETİ "Fırın/Izgara/Kasa" — kitchen slug'ının artık "fırın/taban" anlamı insan-etiketiyle kapanır; fiş etiketi FIRIN/IZGARA ayrı katman)+declared_kinds TEXT[]; fiziksel ayarlar buluta KOPYALANMAZ; UI'da "agent" kelimesi yok. K2 declared_kinds GÖZLENEN-otoriter-değil, claim hot-path DEĞİŞMEZ (gerekçe artık "exe donduruldu" DEĞİL → RİSK AYRIŞTIRMA: aynı hafta hem 3-yazıcılı fiziksel kurulum hem claim semantiği değişirse arıza atfı belirsizleşir; ekran TANILAYICI kalsın, müdahil değil); kind-yok→"filtresiz" çipi. K3 [ONAY] ATAMA YÖNÜ TERSİNE (taslak K11 İPTAL): yazıcı panelinde ÇOK-SEÇİMLİ kategori listesi (Adisyo "MUTFAK GRUBU" emsali), N kategori tek Kaydet; depolama yine tek kolon print_station, join tablosu YOK, YENİ MIGRATION YOK; panel yalnız mutfak-kind'da (bill'de kategori paneli HİÇ yok); taban istasyon panelinde NULL kategoriler İŞARETLİ+KİLİTLİ (+tooltip) → "işareti kaldırdım yine basıyor" çelişkisi doğmaz; diff-yazma + SAYI VEREN onay özeti (v3 dersi) + "kuyruktaki işler eski yazıcıdan basılır" uyarısı; PUT /printers/:id/categories tek-tx, YALNIZ UUID (ad/ILIKE/lower YASAK — Türkçe İ/I). K4 [ONAY] kitchen_print AYRI KAVRAM AYRI YER: kategori tarafında (menu.ts PATCH'e opsiyonel kitchenPrint + CategoryListItem 3-nokta), yazıcı panelinde yalnız SALT-OKUNUR "Mutfağa gitmeyenler (N)"; birleşik üçlü kontrol REDDEDİLDİ (yazıcı değiştirme niyetiyle KDS kapanır); Dilim C = kesilebilir. K5 ekleme=dürüst 2-aşama + KOMUT ÜRETİM KURALLARI BAĞLAYICI: -ServiceName/-ConfigPath/-DeviceFingerprint/-ApiUrl/-JobKinds her zaman AÇIK (varsayılan canlı kasayı ezer) · host XOR name · -SetApiKey her zaman · çıktı SAF ASCII (PS5.1 mojibake dersi, regex testi). K6 yeni yazıcı KENDİ anahtarını alır (paylaşılan anahtar kırılmaz, mevcut 3 agent'a dokunulmaz); maliyet: register bcrypt aday döngüsü ~250ms/anahtar. K7 [ONAY] REVOKE GUARD'I: register'da aktif-satır-yok + iptal-edilmiş-aynı-fingerprint → 403 AGENT_REVOKED; revoke UI'si guard'sız SEVK EDİLMEZ (ya ikisi ya hiçbiri); aktif satırda davranış bit-bit aynı (test). K8 silme=revoke, hard-delete yok; GERÇEK blokerler (son çevrimiçi kind-yazıcısı · devralınmayan bekleyen iş · İSTASYONA ATANMIŞ KATEGORİ VARKEN son yazıcı — Amd1 yetim-grill-job reclaim edilemez); revoke_reason zorunlu; restore var; -Uninstall talimatı. K9 test baskısı kuyruktan geçer (Amd9 raster test-receipt.ts); DÜRÜSTLÜK GÜNCELLENDİ: printer_id yok ama 3 yazıcı 3 FARKLI kind (kitchen/grill/bill) → bugün BELİRLENİMLİ; aynı kind'ı 2 yazıcı beyan ederse uyarı çipi+dipnot. K10 eşikler: çevrimiçi<60sn/gecikmeli-5dk/çevrimdışı/devre-dışı/bekliyor; "SORUNLU"=çevrimdışı VEYA failed-retry VEYA kind-beyanı-yok VEYA YETİM KUYRUK VEYA dirilmiş-fingerprint VEYA aynı-kind-çakışması; 10sn react-query, yeni socket olayı YOK. K11 printer.settings BAĞLANIR (yalnız admin), uçlar /print/v1 DIŞINDA /printers; audit: oluştur/revoke/restore/kategori-atama/kitchen_print; HAM ANAHTAR LOGLANMAZ. K12 Migration 049 additive-only 2 nullable kolon (DEFAULT/NOT-NULL/index/CHECK YOK, ~ms, FORWARD-ONLY down yok, 048 emsali), backfill YOK, categories/products/print_jobs/orders'a HİÇ DOKUNULMAZ, ADR-031-K12 tetiklenmez, codegen diff + gh-pr-list. K13 [ONAY] TAKVİM DÜRÜST: gerçek pencere YALNIZ 21-22-23 Tem (cutover 24-26, o günlerde DEPLOY YOK) ve aynı pencerede S100-prod-dalgası+ızgara-kurulumu+fiziksel-smoke+EAS yarışıyor → TAM KAPSAM SIĞMAZ, kayda geçer; DİLİMLER: A görünürlük(migration+claim-yazımı+GET/PATCH+liste) ≤23-Tem · B atama(PUT+panel) ≤23-Tem hedef · C kitchen_print · D ekleme/revoke+guard · E test-baskısı → cutover sonrası; ÖNERİ A+B; "BU İŞ CUTOVER BLOKERİ DEĞİL" ilkesi KORUNUR (yetişmezse PowerShell+SQL yolu çalışır); IZGARA KURULUMU EKRANI BEKLEMEZ (session-101-kickoff §2 aynen; bağımlılık tek yönlü ve zayıf: ekran ızgarayı bekler, ızgara ekranı beklemez; ekran sonra gelirse DOĞRULAMA aracı olur). K14 [ONAY] v5.0'da YOK (14): çoklu atama · ürün-override · kopya · otomatik-yazdırma politikaları · serbest şablon · yazıcı-başına font/codepage(Amd9 anlamsızlaştırdı) · keşif/tarama · uzaktan servis kontrolü · hard-delete · çok-tenant · job-geçmişi/toplu-retry · hata-sözlüğü · fiziksel-ayar-bulutta · 4.hat; v3'ün 4-sekmeli detayı KASITLA taşınmaz (ürün sahibi: "çok sorunlu ve karmaşık" → Basit-UI). RİSKLER R1-R7 tabloda (yarım-ekran/guard-yanlış-403/uçuştaki-job/komut-canlı-config-ezme/fingerprint-uyuşmazlığı/hot-path/gate-sıkışması). DoD: 5 dilim + ortak(i18n admin.printers.*, pos_test, gate'ler, BELGE SENKRONU: Amd1 metni ÖNCE decisions.md'ye taşınmalı — bugün yalnız plan dosyasında) + 8 [USER] FİZİKSEL madde (3-yazıcı-listede · adlandırma · yetim-kuyruk-gerçek-olayla · atama-kağıtla · üretilen-komut-çalışıyor · revoke-restart'a-dayanıyor · test-baskısı-3-yazıcıda · GERİ-ALMA-PROVASI). AÇIK: dilimleme · guard-birlikte-sevk · kitchen_print-kapsamı · K14-onayı · Amd2-mi-ADR-034-mü. -->
