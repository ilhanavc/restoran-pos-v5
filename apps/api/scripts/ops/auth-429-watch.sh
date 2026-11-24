#!/usr/bin/env bash
#
# auth-429-watch.sh — /auth/* rate-limit 429 izlemesi (ADR-002 Amd8, K8).
#
# NEDEN: Amd8 üç bellek-içi kova koydu (taban 60/dk per-IP · /login sıkı 5/15dk ·
#   /login hacim 30/15dk). K8 kabul ölçütü deploy sonrası 7 gündür ve iki eşiği var:
#     * RESTORANIN KENDİ IP'sinden servis saatinde >=1 adet 429  -> derhal `pm2 restart pos-api`
#     * 7 günde >=2 böyle olay                                   -> PR geri alınır
#   Dış IP'lerden gelen 429 BEKLENEN sonuçtur, ölçüt değildir (deploy öncesi ölçümde
#   10 günde 88 adet /auth/signin taraması vardı — bizim ucumuz bile değil, 404).
#   Bu yüzden düz `grep -c '" 429 '` yetmez: sayıyı IP'ye göre AYIRMAK zorunlu.
#
# KAPSAM SINIRI (dürüst ol, script bunu çözmüyor):
#   Personel yalnız restoran ağından değil hücresel bağlantıdan da giriyor. Tek bir
#   hücresel cihaz kilitlenirse bu ölçüm onu GÖSTERMEZ — o kanal kullanıcı bildirimidir.
#   Script "sessiz kalan" vakayı yakalar, insan bildirimini ikame etmez.
#
# VERİ KAYNAĞI: Nginx access log (logrotate `rotate 14` -> 7 günlük pencere kapsanır).
#   Yeni veri toplamıyor; zaten Nginx'in tuttuğu satırları sayıyor (KVKK: ek toplama yok).
#
# ──────────────────────────────────────────────────────────────────────────────
# 🔒 GÜVENLİK — bu script ROOT olarak koşar ve girdisi SALDIRGAN KONTROLÜNDEDİR.
#   Access log satırının bir kısmını istemci yazdırabilir. S140 güvenlik kapısı
#   burada KRİTİK bir root-RCE buldu; ilk sürüm pencere filtresinde her satır için
#   `date -d "<log'dan gelen dize>"` çağırıyordu. Prod'da ampirik doğrulandı:
#     1) Nginx `$remote_user`'ı `Authorization: Basic`'ten auth_basic KAPALIYKEN DE
#        doldurur, kullanıcı adı doğrulanmaz ve BOŞLUK içerebilir -> awk alanları kayar,
#        `$4` artık zaman damgası değil, saldırgan dizesi olur.
#     2) Nginx yalnız `"` `\` ve kontrol baytlarını `\xHH` olarak kaçırır;
#        `$ ( ) \`` KAÇIRILMAZ. Log'da birebir `ZZmarkA $(X ZZmarkB` gözlendi.
#   Yani `date -d "..."` içine komut ikamesi girebiliyordu -> root olarak çalışırdı.
#
#   Bu yüzden iki kural, BOZULMAMALI:
#     K-A: Log satırından türeyen HİÇBİR veri harici komuta/kabuğa geçmez. Bu script
#          hiç alt-süreç çağırmaz; tüm ayrıştırma awk içinde, string/sayı ile yapılır.
#     K-B: Alan KONUMUNA (`$4`, `$7`) güvenilmez — alan kayması gerçektir. Zaman damgası
#          ve istek satırı REGEX ile çıkarılır, biçimi doğrulanır. Doğrulamayan satır
#          sessizce yanlış ayrıştırılmaz; "ayrıştırılamayan" olarak SAYILIR ve raporlanır
#          (alan kayması başlı başına bir saldırı sinyalidir).
# ──────────────────────────────────────────────────────────────────────────────
#
# Kullanım:
#   ./auth-429-watch.sh                      # ekrana rapor + verdict
#   ./auth-429-watch.sh --append             # ayrıca $SNAPSHOT_LOG'a tek satır ekle (timer bunu çağırır)
#   ./auth-429-watch.sh --ip 1.2.3.4         # restoran IP'sine ek adres (tekrarlanabilir)
#   ./auth-429-watch.sh --only-ip 1.2.3.4    # restoran IP listesini tamamen değiştir
#   ./auth-429-watch.sh --days 7             # pencereyi gün olarak sınırla (default: log'daki her şey)
#   ./auth-429-watch.sh --by-hour            # restoran IP'sindeki 429'ları saat kırılımıyla bas
#   ./auth-429-watch.sh --no-exclude         # hiçbir yolu eleme (ham ölçüm / negatif kontrol)
#
set -euo pipefail

# Restoranın baskın çıkış IP'si. REPO PUBLIC olduğu için adres KODA GÖMÜLMEZ
# (recon bilgisi: işletmenin + geliştirme makinesinin internet bağlantısını ifşa eder).
# Değer sunucuda tutulur; systemd birimi EnvironmentFile ile geçirir — "birim dosyaları
# repo'da versiyonlanmaz" emsaliyle tutarlı (docs/ops/deploy.md §10.1).
#   /etc/restoran-pos/auth-429-watch.env:  RESTAURANT_IPS="1.2.3.4 5.6.7.8"
RESTAURANT_IPS="${RESTAURANT_IPS:-}"
SNAPSHOT_LOG="${SNAPSHOT_LOG:-/var/log/restoran-pos/auth-429-watch.log}"
LOG_GLOB="${LOG_GLOB:-/var/log/nginx/access.log*}"
AUTH_PREFIX="/api/auth/"
DAYS=""
APPEND=0
BY_HOUR=0

# S140 deploy doğrulamasında taban kovayı ampirik sınamak için istek atıldı
# (60x404 + 429'lar, dev makinesinden). O yapay satırlar ölçüme girmesin diye
# yol bazında elenir — "hangi saatte ben attım" hatırlamaya dayanmaz.
EXCLUDE_PATHS="/api/auth/__ratelimit-probe"

while [ $# -gt 0 ]; do
  case "$1" in
    --ip)         RESTAURANT_IPS="$RESTAURANT_IPS $2"; shift 2 ;;
    --only-ip)    RESTAURANT_IPS="$2"; shift 2 ;;
    --days)       DAYS="$2"; shift 2 ;;
    --append)     APPEND=1; shift ;;
    --by-hour)    BY_HOUR=1; shift ;;
    --exclude)    EXCLUDE_PATHS="$EXCLUDE_PATHS $2"; shift 2 ;;
    --no-exclude) EXCLUDE_PATHS=""; shift ;;
    -h|--help)    grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "bilinmeyen arg: $1" >&2; exit 1 ;;
  esac
done

if [ -z "${RESTAURANT_IPS// /}" ]; then
  echo "!! RESTAURANT_IPS tanımsız — ölçüt hesaplanamaz." >&2
  echo "   /etc/restoran-pos/auth-429-watch.env içine RESTAURANT_IPS=\"<ip>\" yaz" >&2
  echo "   ya da --only-ip <ip> ile geç. (Adres repo'da TUTULMAZ — §GÜVENLİK)" >&2
  exit 2
fi

# --- Pencere başlangıcı: YYYYMMDDHHMMSS olarak BİR KEZ hesaplanır -------------
# DAYS yalnız tam sayı olabilir (kabuğa geçen tek değer; biçimi burada doğrulanır).
since_stamp=0
if [ -n "$DAYS" ]; then
  case "$DAYS" in
    ''|*[!0-9]*) echo "!! --days yalnız tam sayı olabilir: '$DAYS'" >&2; exit 1 ;;
  esac
  since_stamp="$(date -u -d "$DAYS days ago" +%Y%m%d%H%M%S)"
fi

# --- Tek geçişte ayrıştır: "ip saat" satırları ---------------------------------
# Harici komut YOK (K-A). Alan konumu yerine regex (K-B). awk her zaman 0 ile çıkar,
# dolayısıyla `grep` boru hattının "eşleşme yok -> exit 1 -> pipefail -> sessiz ölüm"
# tuzağı da ortadan kalkar (S140 güvenlik kapısı HIGH bulgusu: sağlıklı gün HİÇ
# kaydedilmiyordu, çünkü 429 yokken grep 1 döndürüp set -e script'i öldürüyordu).
tmp="$(mktemp)"; meta="$(mktemp)"; trap 'rm -f "$tmp" "$meta"' EXIT

# shellcheck disable=SC2086
zcat -f $LOG_GLOB 2>/dev/null | awk \
  -v exl="$EXCLUDE_PATHS" -v since="$since_stamp" -v pfx="$AUTH_PREFIX" -v metaf="$meta" '
  BEGIN {
    nex = split(exl, ex, " ")
    split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", mn, " ")
    for (i = 1; i <= 12; i++) mnum[mn[i]] = sprintf("%02d", i)
  }
  {
    # --- Ön-süzgeç: satır /api/auth/ geçmiyorsa ölçümü HİÇ etkilemez (ayrıştırmaya
    #     bile girmez). Bu sayede "ayrıştırılamayan" sayacı yalnız ölçümle İLGİLİ
    #     satırları sayar — aksi hâlde logdaki tarayıcı çöpü (ham TLS handshake,
    #     bozuk istek satırı) sayacı şişirip alarmı anlamsızlaştırıyordu (ilk
    #     ölçümde 305 satır: tamamı alakasız tarama trafiğiydi).
    #     UA/Referer içinde geçen "/api/auth/" buraya sızabilir; yetkili yol
    #     kontrolü aşağıda ayrıştırılmış istek yolunda yapılır.
    if (index($0, pfx) == 0) next

    # --- Zaman damgası: KONUM DEĞİL REGEX; biçim doğrulanmazsa satır şüphelidir.
    if (match($0, /\[[0-9][0-9]\/[A-Z][a-z][a-z]\/[0-9][0-9][0-9][0-9]:[0-9][0-9]:[0-9][0-9]:[0-9][0-9]/) == 0) {
      unparsable++    # alan kayması / bozuk satır -> saldırı sinyali, raporlanır
      next
    }
    tsraw = substr($0, RSTART + 1, RLENGTH - 1)      # 11/Oct/2026:09:08:30
    split(tsraw, d, /[\/:]/)                          # d[1]=gun d[2]=ay d[3]=yil d[4]=saat d[5]=dk d[6]=sn
    if (!(d[2] in mnum)) { unparsable++; next }
    stamp = d[3] mnum[d[2]] d[1] d[4] d[5] d[6]       # YYYYMMDDHHMMSS (log TZ = sunucu TZ = UTC)
    if (since != 0 && stamp + 0 < since + 0) next

    # --- İstek satırı: "GET /yol HTTP/1.1". Nginx içindeki `"`yi \x22 yapar,
    #     bu yüzden [^"]* güvenli ve istek uydurulamaz.
    if (match($0, /"[A-Z]+ [^"]*"/) == 0) { unparsable++; next }
    reqline = substr($0, RSTART + 1, RLENGTH - 2)     # GET /yol HTTP/1.1
    rest    = substr($0, RSTART + RLENGTH)            #  429 123 "-" "curl/..."

    # --- Durum kodu: istek alıntısından HEMEN SONRAKİ ilk alan (konum tahmini yok)
    if (match(rest, /^ [0-9][0-9][0-9]/) == 0) { unparsable++; next }
    status = substr(rest, 2, 3)
    if (status != "429") next

    # --- Yol: istek satırının 2. parçası
    nq = split(reqline, q, " ")
    if (nq < 2) { unparsable++; next }
    path = q[2]
    if (index(path, pfx) != 1) next                   # yalnız /api/auth/*
    for (j = 1; j <= nex; j++) if (index(path, ex[j]) > 0) next

    # --- IP: $1 = $remote_addr, gerçek TCP peer; boşluk içeremez, güvenilir.
    print $1, d[4]
  }
  END { print (unparsable + 0) > metaf }
' > "$tmp"

total=$(wc -l < "$tmp" | tr -d ' ')
unparsable=$(cat "$meta" 2>/dev/null || echo 0)

rest_count=$(awk -v ips="$RESTAURANT_IPS" '
  BEGIN { n = split(ips, a, " "); for (i = 1; i <= n; i++) want[a[i]] = 1 }
  ($1 in want) { c++ } END { print c + 0 }' "$tmp")
other_count=$(( total - rest_count ))

window_label="log'daki tüm veri (logrotate: 14 gün)"
[ -n "$DAYS" ] && window_label="son $DAYS gün"

echo "=== /auth/* 429 izlemesi (ADR-002 Amd8 K8) — $(date '+%Y-%m-%d %H:%M:%S %Z') ==="
echo "  pencere          : $window_label"
echo "  restoran IP(leri): $RESTAURANT_IPS"
echo "  elenen yol(lar)  : ${EXCLUDE_PATHS:-(yok — ham ölçüm)}"
echo "  ---"
printf "  RESTORAN IP 429  : %s   <-- OLCUT\n" "$rest_count"
printf "  diger IP 429     : %s   (beklenen; olcut DEGIL)\n" "$other_count"
printf "  toplam 429       : %s\n" "$total"

if [ "$BY_HOUR" -eq 1 ] && [ "$rest_count" -gt 0 ]; then
  echo "  --- restoran IP'sinde saat kirilimi ---"
  awk -v ips="$RESTAURANT_IPS" '
    BEGIN { n = split(ips, a, " "); for (i = 1; i <= n; i++) want[a[i]] = 1 }
    ($1 in want) { h[$2]++ } END { for (k in h) printf "  %s:00 -> %s adet\n", k, h[k] }' "$tmp" | sort
fi

if [ "$unparsable" -gt 0 ]; then
  echo "  ---"
  printf "  !! ayristirilamayan satir: %s  (yalniz /api/auth/ gecen satirlar)\n" "$unparsable"
  echo "     Biçimi doğrulamayan satır SAYILMADI — sessizce yanlış ayrıştırılmadı,"
  echo "     ama ölçümde de görünmüyor. Yani bu sayı 0 değilse 429 KAÇIRIYOR olabiliriz."
  echo "     Beklenen değer 0; artıyorsa satırları elle incele:"
  echo "       grep -F '/api/auth/' /var/log/nginx/access.log | grep -vE '\"[A-Z]+ [^\"]*\" [0-9]{3}'"
fi

echo "=== VERDICT ==="
if [ "$rest_count" -eq 0 ]; then
  verdict="PASS"
  echo "  PASS — restoran IP'sinden 429 YOK. K8 saglikli."
else
  verdict="ALERT"
  echo "  ALERT — restoran IP'sinden $rest_count adet 429 var."
  echo "  0) ILK SORU: o saatte prod'a KASITLI istek atildi mi? Dev makinesi"
  echo "     restoranla AYNI IP'den cikiyor (S140) -> olcut yanlis tetiklenebilir."
  echo "  1) DERHAL kurtarma (oturum kaybi YOK, servis saatinde guvenli):"
  echo "       pm2 restart pos-api --time"
  echo "  2) Saat kirilimina bak (--by-hour): servis saati disindaysa olcut tetiklenmez."
  echo "  3) 7 gun icinde 2. kez servis-saati olayi -> PR geri alinir (docs/ops/deploy.md 10.1)."
fi

if [ "$APPEND" -eq 1 ]; then
  mkdir -p "$(dirname "$SNAPSHOT_LOG")"
  printf '%s\tverdict=%s\trestoran=%s\tdiger=%s\ttoplam=%s\tayristirilamayan=%s\n' \
    "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$verdict" "$rest_count" "$other_count" "$total" "$unparsable" \
    >> "$SNAPSHOT_LOG"
  echo "  (snapshot eklendi: $SNAPSHOT_LOG)"
fi

[ "$verdict" = "PASS" ] && exit 0 || exit 1
