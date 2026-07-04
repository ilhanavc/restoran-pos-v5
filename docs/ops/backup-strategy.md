# Yedekleme Stratejisi — Restoran POS v5

> Dayanak: **ADR-023 — Otomatik DB Yedek**. Bu doküman operasyonel runbook'tur (deploy + restore + drill).
> Script: [`apps/api/scripts/backup/pg-backup.sh`](../../apps/api/scripts/backup/pg-backup.sh).

## 1. Genel bakış (RPO / RTO)

- **Ne yedeklenir:** PostgreSQL tüm DB (`pg_dump -Fc` logical custom-format).
- **Sıklık:** günlük 03:00 (Europe/Istanbul).
- **RPO (kabul edilebilir veri kaybı):** ≤ 24 saat (son günlük dump). Gün-içi kayıp pilotta kabul; WAL/PITR (RPO ~dakika) v5.1+.
- **RTO (toplam restore süresi):** ~30-45 dk (off-site'tan çek → çöz → `pg_restore` → doğrula).
- **Katmanlar (3-2-1):** lokal `/var/backups/postgres` (hızlı restore) + off-site Hetzner Storage Box (felaket kurtarma).

## 2. Mimari — neden OS-level (API'den bağımsız)

Backup, **yedeklediği sistemden bağımsız** çalışmalıdır (ADR-023 Soru 1): API process crash/OOM/deploy sırasında durmuş olsa bile gece yedeği alınmalı. Bu yüzden backup **API node-cron'una eklenmedi**; OS-level systemd timer (öncelikli) veya cron ile çalışan in-repo shell script'tir. `pg_dump` zaten bir shell aracıdır; node sarmalamak izolasyon kazandırmaz, aksine API sağlığına bağımlılık ekler.

## 3. Schedule kurulumu (sunucu)

> ⚠️ Schedule sunucu deployment artifact'ıdır (repo'da kod olarak yaşamaz). Aşağıdaki birimleri sunucuda oluşturun.

### Seçenek A — systemd timer (öncelikli)

`/etc/systemd/system/pg-backup.service`:
```ini
[Unit]
Description=Restoran POS PostgreSQL yedek
After=postgresql.service

[Service]
Type=oneshot
User=postgres
EnvironmentFile=/etc/restoran-pos/backup.env
ExecStart=/opt/restoran-pos/scripts/backup/pg-backup.sh
```

`/etc/systemd/system/pg-backup.timer`:
```ini
[Unit]
Description=Restoran POS günlük yedek (03:00)

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

Etkinleştir + doğrula:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pg-backup.timer
systemctl list-timers | grep pg-backup     # aktif görünmeli
```

`/etc/restoran-pos/backup.env` (ortam değişkenleri — bkz. script başı):
```
PGDATABASE=restoran_pos
PGUSER=postgres
PGHOST=localhost
PGPORT=5432
BACKUP_DIR=/var/backups/postgres
AGE_RECIPIENT=age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
RCLONE_REMOTE=storagebox:restoran-pos-backups
RETENTION_DAILY_DAYS=14
```

### Seçenek B — cron (fallback)

```cron
0 3 * * *  postgres  . /etc/restoran-pos/backup.env; /opt/restoran-pos/scripts/backup/pg-backup.sh >> /var/log/pg-backup.log 2>&1
```

> **API + Postgres farklı sunucudaysa** (managed PG / ayrı DB host): script'i DB'ye erişebilen bir host'ta çalıştırın; `PGHOST` o host'a, `pg_dump` o sunucuda kurulu olmalı. (ADR-023 açık soru 1 — kurulum netleşince bu not güncellenir.)

## 4. Off-site hedef — Hetzner Storage Box (rclone)

KVKK gereği veri Almanya'da kalır (Storage Box, Almanya DC). rclone SFTP backend:
```bash
rclone config
# n) New remote → name: storagebox
# Storage: sftp
# host: uXXXXXX.your-storagebox.de   user: uXXXXXX   port: 23
# key_file veya pass (SSH anahtarı önerilir)
rclone mkdir storagebox:restoran-pos-backups
rclone lsd storagebox:                       # bağlantı testi
```
Transit SSH/TLS ile şifrelidir.

## 5. Şifreleme (`age`) — at-rest + KRİTİK anahtar uyarısı

Dump müşteri PII içerir (`customers`, `call_logs` — ADR-016). At-rest `age` ile şifrelenir.

```bash
age-keygen -o /root/age-key.txt          # private key — SUNUCUDA TUTMA, kasaya al
# çıktı: Public key: age1xxxx...  → bunu AGE_RECIPIENT yap
```

> 🔴 **KRİTİK:** `age` private key kaybolursa **tüm yedekler kalıcı olarak kurtarılamaz.** Private key'i:
> 1. 1Password (veya eşdeğer kasa) vault'una koy,
> 2. ayrıca **offline** bir kopya (USB / kağıt) sakla,
> 3. **sunucuda bırakma** (sunucu compromise olsa bile yedekler okunamasın).
> Public key (`age1...`) sunucuda env'de durabilir — yalnız şifreler, çözemez.

## 6. Retention politikası

- **Lokal:** günlük, `RETENTION_DAILY_DAYS` (default 14) günden eski silinir (script içinde `find -mtime`).
- **Off-site (Storage Box):** günlük 14 / haftalık 8 / aylık 6 (ADR-023). Off-site retention'ı haftalık bir `rclone delete --min-age` job'u veya Storage Box snapshot ile uygula (runbook v1: lokal retention otomatik, off-site retention manuel/aylık gözden geçir → v5.1'de otomatikleştir).

## 7. Restore runbook (manuel — MVP)

> Restore UI v5.1+. Şimdilik manuel; aşağıdaki adımlar.

```bash
# 1) Off-site'tan istenen dump'ı çek
rclone copy storagebox:restoran-pos-backups/restoran_pos-YYYYMMDD-HHMMSS.dump.age /tmp/

# 2) age ile çöz (private key kasadan)
age -d -i /path/to/age-key.txt /tmp/restoran_pos-YYYYMMDD-HHMMSS.dump.age > /tmp/restoran_pos.dump

# 3) Restore (DİKKAT: --clean mevcut veriyi siler; önce throwaway DB'de dene)
#    Yeni/boş DB'ye:
createdb restoran_pos_restore
pg_restore --no-owner --dbname=restoran_pos_restore /tmp/restoran_pos.dump
#    Veya mevcut DB üzerine (prod restore — çok dikkatli):
#    pg_restore --clean --if-exists --no-owner --dbname=restoran_pos /tmp/restoran_pos.dump

# 4) Doğrulama sorguları
psql -d restoran_pos_restore -c "SELECT count(*) FROM orders;"
psql -d restoran_pos_restore -c "SELECT max(created_at) FROM orders;"
psql -d restoran_pos_restore -c "SELECT count(*) FROM payments;"

# 5) API'yi restore edilen DB'ye yönelt + restart (prod restore senaryosunda)
```

> Roller/grant'ler için `pg_dumpall --globals-only` ile ayrı küçük dump alınması önerilir (auth bütünlüğü); restore'da önce globals, sonra DB.

## 8. Restore drill (aylık — ZORUNLU)

"Test edilmemiş backup = backup değil." **Ayda bir** son dump'ı throwaway DB'ye restore edip doğrula. Sonucu aşağıya işle:

| Tarih | Dump dosyası | Restore OK? | orders satır | Notlar | Yapan |
|---|---|---|---|---|---|
| 2026-07-04 | `pos_dev` lokal `pg_dump -Fc` (144K, PG 17.10) | ✓ (`pg_restore` exit 0, 0 stderr) | 29 | **LOKAL dev drill** (Session 80): 27/27 tablo satır-sayısı kaynakla birebir; migrations head `043`; merged-forensic spot check sağlam; script `--dry-run` Git Bash/Windows exit 0. `age`+`rclone`+systemd ayakları sunucu-taraflı → deploy-zamanı (§9 manuel liste geçerli). | Claude (Session 80) |
| _(ilk SUNUCU drill'i deploy sonrası)_ | | | | | |

## 9. DoD checklist

**Otomatik (CI/lokal):**
- [x] `shellcheck apps/api/scripts/backup/pg-backup.sh` temiz
- [x] `pg-backup.sh --dry-run` exit 0 (pg_dump/age/rclone kurulu olmasa da)
- [x] `pg-backup.sh --help` çıktı verir
- [x] `set -euo pipefail` + ERR trap mevcut

**Manuel (sunucu — deploy sonrası, kullanıcı yapar — MSI smoke paterni):**
- [ ] Script sunucuda elle çalıştı → lokal `.age` dosya oluştu
- [ ] `rclone sync` → Storage Box'ta dosya göründü
- [ ] İlk **restore drill** throwaway DB'ye → satır sayıları eşleşti (§8 tabloya işlendi)
- [ ] Retention: `RETENTION_DAILY_DAYS`+1 günden eski dosya silindi
- [ ] `systemctl list-timers` / `crontab -l` → schedule aktif
- [ ] `age` private key kasaya + offline alındı, sunucudan kaldırıldı

## Kapsam dışı (v5.1+)

WAL archiving + PITR · restore UI / one-click · otomatik off-site retention · backup başarı/başarısızlık alerting (Telegram/Slack) · çoklu off-site hedef · multi-tenant per-tenant dump. (ADR-023 kapsam kilidi.)
