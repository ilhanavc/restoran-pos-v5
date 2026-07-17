# Kasiyer İstasyonu — Dükkan-PC Chrome Kiosk Kurulumu

> **[USER kararı S98]:** Kasa = dükkan-PC'de Chrome tam-ekran/kiosk (ek donanım yok; yazıcı-agent'larıyla aynı makine). Cutover'dan önce bir kez kurulur (`cutover-gunu-runbook.md` §0).

## 1. Kiosk kısayolu

Masaüstüne kısayol oluştur — Hedef:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --app=https://restoranpos.org --start-maximized
```

- `--app=` : adres çubuğusuz, sekmesiz tek-pencere (kasiyer yanlışlıkla başka siteye gidemez; Alt+F4 ile kapanır).
- Tam kilitli mod istenirse `--app=` yerine `--kiosk https://restoranpos.org` (çıkış yalnız Alt+F4; kurulum/destek için --app daha pratik — **önerilen: --app**).
- Chrome farklı dizindeyse yolu `where chrome` ile bul.

## 2. Windows açılışında otomatik başlat

1. `Win+R` → `shell:startup` → Enter.
2. 1. adımdaki kısayolu bu klasöre kopyala.
3. (Dükkan-PC zaten print-agent/caller-bridge için açık kalıyor — ek servis gerekmez.)

## 3. Güç/ekran ayarları (kiosk hijyeni)

```
powercfg /change monitor-timeout-ac 0
powercfg /change standby-timeout-ac 0
```

Ekran koruyucu: Ayarlar → Kişiselleştirme → Kilit ekranı → Ekran koruyucu → **Yok** (parola-korumalı ekran kilidi rush-hour'da kasayı kilitler).

## 4. Oturum

- Kasiyer sabah İLK açılışta bir kez giriş yapar (e-posta + şifre). Oturum gün boyu açık kalır (refresh-token yenilemesi otomatik).
- Oturum düşerse davranış: login ekranı gelir → tekrar giriş. (Refresh-cookie ömrünün gün-boyu yetip yetmediği S99 kiosk-smoke'unda teyit edilecek — sorun görülürse ayrı iş açılır.)
- Çıkış butonu kasada KULLANILMAZ (garson-devri yok; tek kasiyer-hesabı).

## 5. Kurulum teslimi (uzak — RustDesk)

Komut/kısayol içeriğini RustDesk'e **elle yapıştırMA** (paste bozulması — S87 dersi). İki güvenli yol:
- Bu dosyadaki 3-4 satırı dükkan-PC'de elle yaz (kısa, risk düşük) — **önerilen**;
- ya da cutover günü gist-teslim şablonu (`irm <raw-url> -OutFile kur.ps1` + dosyadan çalıştır) hazırlanır.

## 6. Cutover-günü smoke (runbook §3 ile birlikte)

- [ ] PC yeniden başlat → Chrome kiosk kendiliğinden açıldı, login geldi.
- [ ] Kasiyer girişi → Masalar board'u; yazıcı-agent'ları Running (aynı PC).
- [ ] Bir test-öde akışı → kasa fişi bastı (runbook §2 teyidiyle birleşir).
