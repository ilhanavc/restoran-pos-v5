# v3'ten Ağrılar (Pain Points) — v5'te Önlenecekler

> v3 canlı kullanımında yaşanan, kullanıcı tarafından anlatılan veya kodda tespit edilen problemler. v5 her ağrıya karşı önlemle doğar. Kaynak etiketleri: `Kullanıcı gözlemi:`, `Kodda tespit:`, `Doğrulanmamış:`.

## Kategori: Yazıcı

### P-01. Türkçe karakter bozulması (sporadik)
- **Kullanıcı gözlemi:** Bazen fişte "şef" yerine "?ef" çıkıyor.
- **Kök neden (Kodda tespit):** Preamble `ESC @ + ESC t 13` her baskıdan önce gönderilmiyordu — yazıcı bazen PC437 default'unda kalıyordu (Sinyal #28).
- **v5 önlemi:** Encoder her baskıdan önce preamble gönderir, opsiyonel değil. Test: unit test byte stream ilk 3 byte'ı doğrular.

### P-02. Sessiz yazıcı arızası
- **Kullanıcı gözlemi:** Yazıcı kağıtsız/kapalı olunca kasiyer fark etmeden servis devam ediyordu, mutfağa fiş gitmiyordu.
- **v5 önlemi:** 20 sn timeout + 2 retry (5+15 sn), son başarısızlıkta kasaya toast + ses uyarısı (Sinyal #26).

### P-03. Çift basım
- **Kullanıcı gözlemi:** Kasiyer "gönder" butonuna iki kez tıklayınca fiş iki kez çıkıyordu, mutfak iki porsiyon yapıyordu.
- **v5 önlemi:** `print_jobs.idempotency_key` UNIQUE + UI optimistic lock (buton disabled ack gelene kadar).

### P-04. StoreBridge karmaşıklığı (ölü kod)
- **Kodda tespit:** Electron renderer → main → COM → yazıcı zinciri. Debug imkansız, crash döngüsü.
- **v5 önlemi:** Ayrı Node.js servisi (Windows hizmeti). Kod baştan yazılır, v3'ten copy-paste yasak. ADR-004.

### P-05. Yazıcı ekleme = yeniden deploy
- **Kullanıcı gözlemi:** Yeni yazıcı koyunca config file + restart gerekiyordu.
- **v5 önlemi:** `printers` tablosu admin CRUD, runtime reconnect (Sinyal #27).

## Kategori: Veri / Şema

### P-06. Float para aritmetiği
- **Kodda tespit:** v3'te `grand_total REAL` + sonradan eklenen `grand_total_cents INT`. Raporlarda `COALESCE(x.amount_cents, ROUND(x.amount * 100))` çirkin pattern — kuruş yuvarlama farkları (Sinyal #21).
- **v5 önlemi:** Sadece `*_cents INT`. Float yasak. ESLint rule.

### P-07. Telefon UNIQUE eksikliği
- **Kodda tespit:** `customer_phones.normalized_phone` UNIQUE constraint yoktu. Aynı müşteri farklı formatlarda iki kez kayıt olabiliyordu (0532, +90532, 90532…) (Sinyal #14).
- **Kullanıcı gözlemi:** Caller ID eşleşmesi bazen yanlış müşteri açıyordu.
- **v5 önlemi:** Normalize + `UNIQUE(tenant_id, normalized_phone)` partial index.

### P-08. Kategori rename eski raporu bozuyordu
- **Kodda tespit:** v3 sonradan `category_id_snapshot + category_name_snapshot` kolonlarını ekledi (Sinyal #35). Eklenmeden önce kategori adı değişince geçmiş rapor başka kategori altına kayıyordu.
- **v5 önlemi:** Snapshot kolonları sipariş anında zorunlu (`NOT NULL`).

### P-09. Audit log retention yok
- **Kodda tespit:** v3 audit kümülatif büyüyordu, retention job'u yok.
- **v5 önlemi:** 2 yıl cron purge (Sinyal #39).

### P-10. `incoming_calls` + `call_logs` iki tablo
- **Kodda tespit:** İki tablo tutarsız, raw telefon log'da. KVKK riski.
- **v5 önlemi:** Tek `call_logs` tablosu, 30 gün retention, PII sanitize audit'te (Sinyal #20, #39).

## Kategori: Sipariş / İş Mantığı

### P-11. Aynı masaya iki aktif sipariş
- **Kullanıcı gözlemi:** Bazen garson paralel açıp aynı masaya iki ayrı sipariş oluşturuyordu, birleştirmek zordu.
- **Kodda tespit:** v3'te constraint yok.
- **v5 önlemi:** `UNIQUE(tenant_id, table_id) WHERE status='open'` partial index (Sinyal #11).

### P-12. `order_no` race condition
- **Kodda tespit:** v3 MAX+1 pattern lock'suzdu. Yoğun saatte iki siparişin aynı numarayı alma riski.
- **v5 önlemi:** `SELECT … FOR UPDATE` + günlük reset (Sinyal #23).

### P-13. Ödeme `mixed`/`other` enum kafası
- **Kodda tespit:** v3 `payment_type` enum'unda `mixed` + `other` vardı, UI'de sık yanlış seçiliyordu.
- **v5 önlemi:** Sadece `cash | card`. Karışık ödeme = 2 ayrı `payments` satırı (Sinyal #29).

### P-14. Sipariş iptal vs refund karışıklığı
- **Kullanıcı gözlemi:** Ödeme sonrası iptalde para iadesinin audit'i yoktu.
- **v5 önlemi:** Ödeme öncesi iptal → `orders.status='cancelled'`. Ödeme sonrası → `refunds` satırı + admin + neden (Sinyal #31).

## Kategori: Raporlar / Kapanış

### P-15. Manuel günlük kapanış güvenilmez
- **Kullanıcı gözlemi:** Restoran kapanışta PC gece kapatılıyordu, manuel kapanış unutulunca ertesi gün rapor bozuk geliyordu.
- **v5 önlemi:** Otomatik cron = kapanış saati + 2 saat (Sinyal #32).

### P-16. Yazarkasa Z ile karışma
- **Kullanıcı gözlemi:** "Z raporu" POS'un değil, yazarkasanın. Ekibe anlatırken karışıyordu.
- **v5 önlemi:** İsim "günlük kapanış". Yazarkasa Z POS kapsamı dışı (Sinyal #32).

## Kategori: Müşteri / KVKK

### P-17. Müşteri silme veri bütünlüğünü bozuyordu
- **Kodda tespit:** v3'te silme endpoint'i müşteri satırı `DELETE` ediyordu, siparişlerdeki FK null kalıyordu ama snapshot yoktu → raporda "Bilinmeyen" görünüyordu.
- **v5 önlemi:** Anonimize modeli — müşteri satırı kalır, PII silinir, snapshot zaten var (Sinyal #15).

### P-18. Raw telefon audit'te
- **Kodda tespit:** v3 audit olayları tam telefonu log'luyordu (KVKK riski).
- **v5 önlemi:** PII sanitizer — telefon son 4 maske, isim/adres yok, `customer_id` FK yeterli (Sinyal #39).

## Kategori: Caller ID

### P-19. 2-3 saniye gecikme
- **Kullanıcı gözlemi:** Telefon çaldıktan 2-3 sn sonra ekranda bilgi çıkıyordu, kasiyer o arada almış oluyordu.
- **Kodda tespit:** v3 polling kullanıyordu.
- **v5 önlemi:** Socket.IO realtime push (Sinyal #19).

## Kategori: Altyapı / Deployment

### P-20. Yedek altyapısı yok
- **Kullanıcı gözlemi:** v3 Electron + SQLite — yedek tamamen manuel (USB'ye kopyala).
- **v5 önlemi:** Hetzner Storage Box + günlük pg_dump + 30 gün + E2E şifreleme + aylık restore testi (Sinyal #42).

### P-21. Backend route guard belirsizliği
- **Doğrulanmamış:** v3'te bazı endpoint'lerde role kontrolü middleware'de değildi, handler içinde dağılmıştı. Auth hata senaryosu tam kapsanmamış olabilir.
- **v5 önlemi:** Route-level guard middleware (role matrix), ADR-002.

### P-22. Multi-araç kaosu (v4'ten ders)
- **Kullanıcı gözlemi:** claude.ai + cursor + codex + Claude Code paralel kullanıldı, kod dağıldı, v4 iptal edildi.
- **v5 önlemi:** Sadece Claude Code. CLAUDE.md disiplin. ADR-her-karar.

### P-23. Electron + SQLite scale limit
- **Kodda tespit:** Tek PC, tek kullanıcı mimari. Mobil/uzaktan erişim imkansız.
- **v5 önlemi:** Cloud API + web + RN mobil. PostgreSQL 17.

## Meta

- **"3 yıl önceki işi görmek" vs "yedek" karışıklığı** (Sinyal #41): Kullanıcı eğitiminde net ayır. Canlı DB süresiz saklar; yedek 30 gün disaster recovery.
- **Kapsam sessiz büyümesi**: v4'te "bir şey daha" sürekli eklendi. v5'te CLAUDE.md kapsam kilidi + ADR disiplini.

## v5'te Olmayacak Ağrılar (özet)

Her P-XX için v5'te somut önlem var: UNIQUE index, idempotency key, snapshot NOT NULL, CP857 preamble zorunlu, PII sanitizer, route guard middleware, auto cron, storage box, Socket.IO. Hiçbiri "sonra yaparız" bırakılmadı — hepsi MVP şemasında.
