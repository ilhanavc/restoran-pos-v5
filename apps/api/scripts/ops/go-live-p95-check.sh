#!/usr/bin/env bash
#
# go-live-p95-check.sh — Restoran POS v5 go/no-go performans ölçümü (A6, Session 85).
#
# Ölçüt (docs/project-charter.md §Performans, :129-131):
#   * Web UI p95 etkileşim < 200 ms    -> Nginx $request_time (server-side proxy) p95
#   * 8 saat yoğun kullanimda çökme yok -> pm2 "pos-api" restart ARTMAMALI
#
# ÖN-KOŞUL: Nginx access log $request_time İÇERMELİ (default "combined" içermez).
#   Eksikse script gereken log_format değişikliğini basar (`--setup`).
#
# UZUN-POLL HARİÇ TUTMA (Session 100 bulgusu — 2026-07-20):
#   print-agent `GET /print/v1/jobs/next?wait=25` ucunu TASARIMI GEREĞİ ~25 sn açik tutar
#   (iş gelene kadar bekleyen long-poll). Socket.IO bağlantilari da dakikalarca açik kalir.
#   Bunlar kullanici etkileşimi DEĞİLdir; ölçüme girerlerse p95 daima FAIL döner
#   (ilk kurulumda ölçülen: p95=25118ms, gerçek istek /api/health=2ms).
#   Bu yüzden aşağidaki EXCLUDES yollari VARSAYILAN OLARAK ölçüm diş birakilir;
#   kaç istek elendiği her koşuda ekrana yazilir (sessiz eleme yok).
#
# Kullanım:
#   sudo ./go-live-p95-check.sh                  # path=/api, access.log + .1
#   sudo ./go-live-p95-check.sh --path /         # farkli path öneki
#   sudo ./go-live-p95-check.sh --path ''        # TÜM istekler
#   sudo ./go-live-p95-check.sh --threshold 200  # p95 eşiği (ms)
#   sudo ./go-live-p95-check.sh --exclude /foo   # listeye ek hariç-tutma (tekrarlanabilir)
#   sudo ./go-live-p95-check.sh --no-exclude     # hiçbir şeyi eleme (ham ölçüm)
#   sudo ./go-live-p95-check.sh --setup          # Nginx log_format talimati
#
set -euo pipefail

PATH_PREFIX="/api"
THRESHOLD_MS=200
PM2_APP="pos-api"
LOGS=(/var/log/nginx/access.log /var/log/nginx/access.log.1)
EXCLUDES="/print/v1/jobs/next /socket.io/"

print_setup() {
  cat <<'SETUP'
-- ÖN-KOŞUL: Nginx access log'una $request_time ekle --------------------------
/etc/nginx/nginx.conf  http { } bloğuna log_format ekle:

    log_format timed '$remote_addr - $remote_user [$time_local] "$request" '
                     '$status $body_bytes_sent "$http_referer" "$http_user_agent" '
                     'rt=$request_time urt=$upstream_response_time';

Mevcut  access_log /var/log/nginx/access.log;  satirini:

    access_log /var/log/nginx/access.log timed;

Sonra:  nginx -t && systemctl reload nginx
(Yeni satirlar rt= taşir; birkaç dk trafikten sonra ölçüm yapilabilir.)
------------------------------------------------------------------------------
SETUP
}

while [ $# -gt 0 ]; do
  case "$1" in
    --path)       PATH_PREFIX="$2"; shift 2 ;;
    --threshold)  THRESHOLD_MS="$2"; shift 2 ;;
    --exclude)    EXCLUDES="$EXCLUDES $2"; shift 2 ;;
    --no-exclude) EXCLUDES=""; shift ;;
    --setup)     print_setup; exit 0 ;;
    -h|--help)   grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "bilinmeyen arg: $1" >&2; exit 1 ;;
  esac
done

# --- rt= değerlerini topla (ms), path öneğine göre süz ---
tmp="$(mktemp)"; skipf="$(mktemp)"; trap 'rm -f "$tmp" "$skipf"' EXIT
for f in "${LOGS[@]}"; do [ -r "$f" ] && cat "$f"; done \
  | awk -v pfx="$PATH_PREFIX" -v exl="$EXCLUDES" -v skipf="$skipf" '
  BEGIN { nex = split(exl, ex, " ") }
  {
    rt=""
    for (i=1;i<=NF;i++) if (substr($i,1,3)=="rt=") rt=substr($i,4)
    if (rt=="" || rt=="-") next
    if (pfx != "" && index($7,pfx)!=1) next   # $7 = combined formatta istek yolu
    for (j=1;j<=nex;j++) if (index($7,ex[j])>0) { skipped++; next }   # uzun-poll/websocket
    printf "%.0f\n", rt*1000
  }
  END { print skipped+0 > skipf }' | sort -n > "$tmp"
n_skipped="$(cat "$skipf" 2>/dev/null || echo 0)"

n=$(wc -l < "$tmp")
if [ "$n" -eq 0 ]; then
  echo "!! Ölçülebilir istek yok: log'da 'rt=' bulunamadi (ya da path='$PATH_PREFIX' eşleşmedi)."
  if [ "${n_skipped:-0}" -gt 0 ]; then
    echo "   NOT: $n_skipped istek uzun-poll/websocket olarak elendi (EXCLUDES='$EXCLUDES')."
    echo "   Ham ölçüm için: --no-exclude"
  fi
  print_setup
  exit 2
fi

pct() {  # $1 = yüzdelik (0-100)
  local idx
  idx=$(awk -v n="$n" -v p="$1" 'BEGIN{ i=int((p/100.0)*n+0.5); if(i<1)i=1; if(i>n)i=n; print i }')
  sed -n "${idx}p" "$tmp"
}
p50=$(pct 50); p95=$(pct 95); p99=$(pct 99); pmax=$(tail -1 "$tmp")

echo "=== Nginx \$request_time  (path='$PATH_PREFIX', n=$n istek) ==="
if [ "${n_skipped:-0}" -gt 0 ]; then
  printf "  hariç tutulan: %s uzun-poll/websocket istegi (EXCLUDES='%s'; ham ölçüm: --no-exclude)\n" \
    "$n_skipped" "$EXCLUDES"
fi
printf "  p50=%sms  p95=%sms  p99=%sms  max=%sms\n" "$p50" "$p95" "$p99" "$pmax"
verdict="PASS"; [ "$p95" -ge "$THRESHOLD_MS" ] && verdict="FAIL"
printf "  p95 %sms  (eşik <%sms) -> %s\n" "$p95" "$THRESHOLD_MS" "$verdict"

echo "=== pm2 '$PM2_APP' (restart charter :131) ==="
if command -v pm2 >/dev/null 2>&1; then
  pm2 describe "$PM2_APP" 2>/dev/null | grep -iE 'restarts|status|uptime' | sed 's/^/  /' \
    || echo "  ($PM2_APP bulunamadi)"
  echo "  NOT: restart sayisi go-live BAŞINDAKİ değerle karşilaştirilmali -> ARTMAMALI."
else
  echo "  pm2 yok"
fi

echo "=== GO / NO-GO ==="
[ "$verdict" = "PASS" ] \
  && echo "  p95 OK  ($p95 ms < ${THRESHOLD_MS} ms)" \
  || echo "  p95 FAIL ($p95 ms >= ${THRESHOLD_MS} ms) -> yoğun-saat verisiyle tekrar ölç"
echo "  + pm2 restart artişi 0 olmali (yukaridan doğrula)."
echo "  NOT: Nginx p95 = server-side; charter 'UI etkileşim'i client-render dahil daha geniş — bu server-side alt-sinir kontrolü."
