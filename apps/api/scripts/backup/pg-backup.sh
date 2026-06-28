#!/usr/bin/env bash
#
# pg-backup.sh — Restoran POS v5 otomatik PostgreSQL yedeği (ADR-023).
#
# OS-level cron/systemd timer ile çalışır (API process'inden BAĞIMSIZ — backup
# yedeklediği sistemden bağımsız olmalı, ADR-023 Soru 1). Akış:
#   pg_dump -Fc  →  age (at-rest şifreli)  →  lokal /var/backups  →  rclone sync
#   (Hetzner Storage Box, off-site)  →  lokal retention temizliği.
#
# Doğrulama (DoD): shellcheck-clean + `--dry-run` exit 0 + `--help`. Gerçek dump
# + Storage Box CI'da test edilemez → sunucu manuel smoke + aylık restore drill
# (docs/ops/backup-strategy.md).
#
# Yapılandırma (ortam değişkenleri, deploy-zamanı — docs/ops/backup-strategy.md):
#   PGDATABASE            Yedeklenecek DB adı            (default: restoran_pos)
#   PGUSER                pg_dump kullanıcısı            (default: postgres)
#   PGHOST                DB host                        (default: localhost)
#   PGPORT                DB port                        (default: 5432)
#   BACKUP_DIR            Lokal yedek dizini             (default: /var/backups/postgres)
#   AGE_RECIPIENT         age public key (ZORUNLU)       (örn: age1xxxx...)
#   RCLONE_REMOTE         rclone off-site hedefi         (default: storagebox:restoran-pos-backups)
#   RETENTION_DAILY_DAYS  Lokal saklama (gün)            (default: 14)
#
# Çıkış kodları: 0 başarı | 1 yapılandırma/dump/transfer hatası.

set -euo pipefail

readonly SCRIPT_NAME="pg-backup"

PGDATABASE="${PGDATABASE:-restoran_pos}"
PGUSER="${PGUSER:-postgres}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/postgres}"
AGE_RECIPIENT="${AGE_RECIPIENT:-}"
RCLONE_REMOTE="${RCLONE_REMOTE:-storagebox:restoran-pos-backups}"
RETENTION_DAILY_DAYS="${RETENTION_DAILY_DAYS:-14}"
export PGDATABASE PGUSER PGHOST PGPORT

DRY_RUN=0

log() {
  echo "[${SCRIPT_NAME}] $*" >&2
}

die() {
  log "HATA: $*"
  exit 1
}

on_error() {
  local exit_code=$?
  log "beklenmeyen hata (satır ${BASH_LINENO[0]}, çıkış ${exit_code})"
  exit "${exit_code}"
}
trap on_error ERR

usage() {
  cat <<'EOF'
pg-backup.sh — Restoran POS v5 PostgreSQL yedeği (ADR-023)

Kullanım:
  pg-backup.sh [--dry-run] [--help]

  --dry-run   Gerçek dump/şifreleme/transfer YAPMAZ; yalnız komut planını yazar.
              (pg_dump/age/rclone kurulu olmasa da çalışır — CI/DoD doğrulaması.)
  --help      Bu yardımı göster.

Yapılandırma ortam değişkenleriyle yapılır (bkz. script başı + docs/ops/backup-strategy.md).
Schedule: systemd timer (öncelikli) veya cron — docs/ops/backup-strategy.md.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --help|-h) usage; exit 0 ;;
    *) die "bilinmeyen argüman: $1 (--help)" ;;
  esac
  shift
done

run() {
  # Komutu çalıştır; --dry-run ise yalnız yazdır.
  if [ "${DRY_RUN}" -eq 1 ]; then
    log "DRY-RUN: $*"
  else
    "$@"
  fi
}

main() {
  local ts dump_file
  ts="$(date +%Y%m%d-%H%M%S)"
  dump_file="${BACKUP_DIR}/${PGDATABASE}-${ts}.dump.age"

  log "başladı db=${PGDATABASE} host=${PGHOST}:${PGPORT} hedef=${dump_file}"

  # 1) Yapılandırma kontrolü
  if [ -z "${AGE_RECIPIENT}" ]; then
    if [ "${DRY_RUN}" -eq 1 ]; then
      log "DRY-RUN: AGE_RECIPIENT boş (gerçek çalıştırmada ZORUNLU)"
    else
      die "AGE_RECIPIENT (age public key) tanımlı değil — şifresiz yedek yasak (KVKK, ADR-023 Soru 4)"
    fi
  fi

  # 2) Yedek dizini
  run mkdir -p "${BACKUP_DIR}"

  # 3) pg_dump -Fc → age (at-rest şifreli) → dosya
  #    Custom format kendi sıkıştırır; age tek-recipient public-key şifreler.
  if [ "${DRY_RUN}" -eq 1 ]; then
    log "DRY-RUN: pg_dump -Fc \"${PGDATABASE}\" | age -r \"${AGE_RECIPIENT:-<recipient>}\" > \"${dump_file}\""
  else
    if ! pg_dump -Fc "${PGDATABASE}" | age -r "${AGE_RECIPIENT}" >"${dump_file}"; then
      rm -f "${dump_file}"
      die "pg_dump/age başarısız — kısmi dosya silindi"
    fi
    log "dump yazıldı: ${dump_file} ($(du -h "${dump_file}" | cut -f1))"
  fi

  # 4) Off-site sync (rclone SFTP → Storage Box; transit SSH/TLS şifreli)
  run rclone sync "${BACKUP_DIR}" "${RCLONE_REMOTE}"
  log "off-site sync tamam: ${RCLONE_REMOTE}"

  # 5) Lokal retention (off-site retention rclone tarafında — runbook)
  if [ "${DRY_RUN}" -eq 1 ]; then
    log "DRY-RUN: find \"${BACKUP_DIR}\" -name '*.dump.age' -mtime +${RETENTION_DAILY_DAYS} -delete"
  else
    find "${BACKUP_DIR}" -name '*.dump.age' -mtime +"${RETENTION_DAILY_DAYS}" -delete
    log "lokal retention uygulandı (>${RETENTION_DAILY_DAYS} gün silindi)"
  fi

  log "tamamlandı"
}

main
