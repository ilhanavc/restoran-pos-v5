# KVKK Aydınlatma Metni + Yurt Dışı Aktarım (m.9) Dayanağı — TASLAK

> ⚠️ **BU BİR TASLAKTIR — HUKUKİ GÖRÜŞ DEĞİLDİR.** Yayınlanmadan / uygulanmadan önce KVKK konusunda yetkin bir **avukat veya veri koruma danışmanı** tarafından gözden geçirilip onaylanmalıdır. Özellikle **yurt dışı aktarım (m.9, 6 Mart 2024 tarihli 7499 sayılı Kanun değişikliği)** rejimi ve KVKK Kurulu'nun güncel kararları (yeterlilik kararları, standart sözleşme metni) **güncel olarak teyit edilmelidir**. Bu belge, `docs/compliance/kvkk-data-inventory.md` veri envanterine dayanır ve §11 GO/NO-GO maddeleri **#2 (m.9 hukuki)** ve **#3 (aydınlatma)** için avukat incelemesini başlatacak taslağı sağlar. Taslağın hazırlanması bu maddeleri **kapatmaz**; kapanış = avukat onayı + metnin yayını + m.9 dayanağının tesisi.

**Köşeli parantezli [ALANLAR]** işletme sahibi tarafından doldurulacaktır.
**Kaynak envanter:** `docs/compliance/kvkk-data-inventory.md` (§2 taraflar, §3 veri kategorileri, §4 amaç/dayanak, §5 saklama, §6 m.9, §7 m.10).

---

## A. MÜŞTERİ AYDINLATMA METNİ (taslak)

**[İŞLETME UNVANI / TİCARİ AD]** ("İşletme" / "Veri Sorumlusu") olarak, 6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") m.10 kapsamında sizi bilgilendirmek isteriz.

### 1. Veri Sorumlusunun Kimliği
- **Unvan:** [İŞLETME UNVANI]
- **Adres:** [AÇIK ADRES]
- **Telefon:** [TELEFON] · **E-posta:** [E-POSTA]
- **VERBİS Sicil No:** [VARSA — yoksa kaydın gerekip gerekmediği avukata sorulmalı; bkz. Bölüm E]

### 2. İşlenen Kişisel Verileriniz
Sipariş verdiğinizde aşağıdaki kişisel verileriniz işlenir:
- **Kimlik / İletişim:** ad-soyad, telefon numarası
- **Konum:** teslimat adresi (mahalle ve adres bilgisi), teslimat notu/tarifi
- **Müşteri işlem:** sipariş kayıtları ve varsa siparişe ilişkin notlar
- **Telefonla arama:** bizi aradığınızda gelen arama numaranız, sizi anlık tanıyabilmek amacıyla **en fazla 30 gün** süreyle işlenir ve sonra otomatik silinir.

> Özel nitelikli kişisel veri (sağlık, din, etnik köken vb.) işlenmez. Serbest not alanlarına bu tür bilgiler girilmez.

### 3. İşleme Amaçları
Verileriniz; **siparişinizin alınması, hazırlanması ve teslim edilmesi**, sizinle iletişim kurulması, sipariş/teslimat kayıtlarının tutulması ve **operasyonel güvenliğin** (sahte sipariş / kötüye kullanım riskinin yönetimi) sağlanması amaçlarıyla işlenir.

### 4. Toplama Yöntemi ve Hukuki Sebep
Verileriniz; **telefonla veya şahsen sipariş** verdiğinizde ve gelen arama tanıma yoluyla, elektronik ortamda toplanır. Hukuki sebepler KVKK m.5/2 uyarınca:
- **(c) sözleşmenin kurulması/ifası** (siparişin alınıp teslim edilmesi),
- **(f) meşru menfaat** (müşteri tanıma, operasyonel güvenlik).

Bu işlemeler açık rıza gerektirmez. (Pazarlama/SMS gibi ikincil amaçlar için ayrıca açık rızanız istenirdi; işletmemiz bu tür işleme **yapmamaktadır**.)

### 5. Kişisel Verilerin Aktarımı — Yurt Dışı Aktarım Dahil
Verileriniz, **sunucu barındırma hizmeti** için kullandığımız **Hetzner Online GmbH** (veri işleyen) altyapısında saklanır. Bu sunucular **Almanya'dadır**; dolayısıyla verileriniz **yurt dışına (Almanya) aktarılmaktadır.** Yedekleme deposu da Almanya'dadır ve şifrelidir. Aktarım şifreli bağlantı (TLS) ile yapılır. Yurt dışı aktarım, KVKK m.9 kapsamında **[AVUKAT TARAFINDAN BELİRLENECEK DAYANAK — bkz. Bölüm C]** çerçevesinde gerçekleştirilir.

### 6. Saklama Süresi
Sipariş ve iletişim verileriniz, aramızdaki ilişki ve yasal saklama yükümlülükleri süresince saklanır; gelen arama numaraları 30 gün sonra otomatik silinir. Talebiniz üzerine, yasal saklama yükümlülükleri saklı kalmak kaydıyla verileriniz silinir.

### 7. Haklarınız (KVKK m.11)
Veri sorumlusuna ([E-POSTA] / [ADRES]) başvurarak; kişisel verinizin işlenip işlenmediğini öğrenme, bilgi talep etme, işleme amacını öğrenme, aktarıldığı tarafları öğrenme, **eksik/yanlış işlenmişse düzeltilmesini**, silinmesini/yok edilmesini, işlemeye itiraz etme ve zarara uğramanız halinde giderim talep etme haklarına sahipsiniz. Başvurularınız KVKK ve ilgili mevzuattaki sürelerde yanıtlanır.

---

## B. PERSONEL AYDINLATMA METNİ (taslak — özet)

Çalışanlar da ilgili kişidir; m.10 onlar için de yerine getirilir.

- **İşlenen veri:** e-posta, kullanıcı adı, parola (yalnız güvenli **hash** olarak; açık parola saklanmaz), rol; oturum güvenliği için IP/cihaz bilgisi ve denetim kaydı (kim-ne-yaptı).
- **Amaç:** kimlik doğrulama, yetkilendirme, sipariş atfı, hesap verebilirlik/güvenlik.
- **Hukuki sebep:** m.5/2 (c) sözleşmenin ifası (iş ilişkisi) + (ç) hukuki yükümlülük + (f) meşru menfaat (güvenlik).
- **Aktarım:** aynı şekilde Almanya (Hetzner) — yurt dışı aktarım (Bölüm C).
- **Haklar:** m.11 (yukarıdaki gibi).

---

## C. YURT DIŞI AKTARIM (KVKK m.9) DAYANAĞI — ANALİZ + KARAR GEREKTİREN NOKTALAR

> ⚠️ Bu bölüm **hukuki analiz taslağıdır**; nihai dayanak **avukat tarafından** seçilip tesis edilmelidir. Aşağıdaki çerçeve 6 Mart 2024 tarihli **7499 sayılı Kanun** ile değişen m.9'a göredir (aktarım hükümleri ~1 Haziran 2024'te yürürlüğe girmiştir); Kurul'un güncel yeterlilik kararları ve standart sözleşme metni teyit edilmelidir.

**Durum:** Prod sunucu ve yedek **Almanya'da (Hetzner)**. Müşteri PII'si (ad/telefon/adres) **sürekli ve sistematik** olarak yurt dışında saklanmaktadır. AB'nin GDPR yeterliliği, **Türkiye KVKK açısından otomatik yeterlilik sağlamaz** — ayrı bir m.9 dayanağı gerekir.

**m.9 dayanak seçenekleri (değişiklik sonrası hiyerarşi):**
1. **Yeterlilik kararı** (Kurul'un ülke/sektör/kuruluş bazlı kararı) — varsa aktarım buna dayanır. → *Almanya/Hetzner için güncel yeterlilik kararı olup olmadığı avukatça teyit edilmeli.*
2. **Uygun güvenceler** (yeterlilik yoksa; ilgili kişinin haklarını kullanabilmesi + etkili başvuru şartıyla):
   - taraflar arası uluslararası sözleşme (kamu), **bağlayıcı şirket kuralları (BCR)**,
   - **Standart Sözleşme** (Kurul'un ilan ettiği metin — imzadan itibaren **5 iş günü** içinde Kurul'a bildirilir),
   - yazılı taahhütname + Kurul izni.
3. **Arızi haller (istisnalar)** — açık rıza (aktarıma özgü, aydınlatılmış), sözleşme ifası zorunluluğu vb. → **Sistematik/sürekli aktarım için uygun DEĞİLDİR** (istisnalar arızi/tek seferlik aktarımlar içindir). Telefonla siparişte her müşteriden aktarıma özel açık rıza toplamak da operasyonel olarak pratik değildir.

**Ön-öneri (avukat onayına tabi):** Sistematik controller→processor (İşletme→Hetzner) aktarımı için en uygun yol büyük olasılıkla **(2) uygun güvence = Standart Sözleşme**'dir. Somut soru: **Hetzner, Türkiye KVKK Kurulu'nun Standart Sözleşme metnini imzalar mı?** Hetzner GDPR kapsamında **AVV/DPA (Auftragsverarbeitungsvertrag)** sunar; Türk Standart Sözleşmesi'ni imzalayıp imzalamayacağı Hetzner ile netleştirilmelidir. İmzalamıyorsa alternatif = taahhütname + Kurul izni (daha yavaş) veya barındırmanın yeniden değerlendirilmesi (altyapı kararı — bu belgenin kapsamı dışı).

**Bağlantılı boşluk (m.12/3):** İşletme ile Hetzner arasındaki **veri işleyen sözleşmesi (DPA/AVV)** durumu belgelenmemiştir (envanter §2, §11 #12). m.9 güvencesi ile m.12/3 sözleşmesi birlikte ele alınmalıdır.

---

## D. AYDINLATMANIN SUNUM / YAYIN YÖNTEMİ

Aydınlatma, veri toplandığı anda erişilebilir olmalıdır. Pratik seçenekler:
- **Telefonla sipariş:** kısa sözlü bilgilendirme + tam metne yönlendirme ("Bilgileriniz sipariş ve KVKK aydınlatma metnimiz kapsamında işlenir; detay: [web/işletmede].").
- **İşletmede:** kasada/girişte görünür **asılı metin** veya QR kod.
- **Varsa web/sosyal medya:** tam metin yayını + sipariş kanalında link.
- Personel için: işe giriş evrakı / panoya asılı metin.

---

## E. AVUKAT + İŞLETME AKSİYON LİSTESİ (kapanış için)

| # | Aksiyon | Sahip |
|---|---|---|
| 1 | [ALANLAR]'ı doldur: işletme unvan/adres/telefon/e-posta | İşletme |
| 2 | **m.9 dayanağını seç ve tesis et** (yeterlilik kararı teyidi → yoksa Standart Sözleşme'yi Hetzner ile imzala + **5 iş günü içinde Kurul'a bildir**) | Avukat + İşletme |
| 3 | Hetzner **DPA/AVV** (m.12/3 veri işleyen sözleşmesi) durumunu netleştir ve belgele | Avukat + İşletme |
| 4 | **VERBİS** kayıt yükümlülüğü var mı? (işletme büyüklüğü/çalışan sayısı/ciro eşiklerine göre) — teyit et, gerekirse kaydol | Avukat |
| 5 | Aydınlatma metnini (A + B) onayla, [dayanak] alanını doldur, **yayınla** (Bölüm D) | Avukat + İşletme |
| 6 | m.11 başvurularını yanıtlama iç prosedürünü belirle (kime/nasıl/ne sürede) | İşletme |
| 7 | Silme talebi geldiğinde imha prosedürü + **kağıt/dış imha kaydı** tut (envanter §5) | İşletme |

**Kapanış kriteri (envanter §11 #2/#3):** #2 = m.9 dayanağı tesis + aydınlatmada belirtim ✅; #3 = aydınlatma metni onaylı + yayında ✅. Bu taslak bu iki maddeyi **başlatır**; onay + tesis + yayın ile kapanır.

---

*Taslak — Session 85 (2026-07-07). Dayanak: `kvkk-data-inventory.md`. Hukuki onay bekliyor.*
