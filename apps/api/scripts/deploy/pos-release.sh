#!/usr/bin/env bash
# pos-release — versioned release + one-command rollback for the cloud box (ADR-047).
#
# Layout (K1):
#   $POS_ROOT/releases/<UTC>-<sha7>/   immutable build (git archive + node_modules + dists + RELEASE.json)
#   $POS_ROOT/current -> releases/<id> the only "live" pointer, switched atomically (rename)
#   $POS_ROOT/shared/                  web.env.production · web-assets/ pool (K4) · release.conf · history
#   $POS_ROOT/bin/                     this script + run-api.sh (fixed location, never inside a release)
#
# Subcommands: build <rev> · deploy <rev> · activate <id> · rollback [<id>] · list · status · prune
#              self-install <id>
# Human-triggered only (ADR-047 K3/S4: no CD). User-facing output is Turkish; code is English.
#
# Every external dependency is overridable through the environment so the script can be exercised
# end-to-end in CI against a fake root with stub binaries (apps/api/scripts/deploy/test-pos-release.sh).

set -euo pipefail
umask 022
# Byte-order sorting/comparison everywhere, matching `COLLATE "C"` in the pgmigrations queries.
export LC_ALL=C

POS_ROOT="${POS_ROOT:-/srv/restoran-pos}"
POS_GIT_DIR="${POS_GIT_DIR:-/opt/git/restoran-pos.git}"
POS_SECRETS_FILE="${POS_SECRETS_FILE:-/root/pos-secrets.env}"
POS_DB_NAME="${POS_DB_NAME:-pos_prod}"
POS_BASE_URL="${POS_BASE_URL:-https://restoranpos.org}"
POS_PM2_APP="${POS_PM2_APP:-pos-api}"
POS_BACKUP_UNIT="${POS_BACKUP_UNIT:-pg-backup.service}"
POS_SMOKE_WAIT_SECS="${POS_SMOKE_WAIT_SECS:-60}"
POS_PGHOST="${POS_PGHOST:-/var/run/postgresql}"   # local socket → peer auth for `postgres` (ADR-049 K4)

RELEASES="$POS_ROOT/releases"
SHARED="$POS_ROOT/shared"
CURRENT="$POS_ROOT/current"
HISTORY="$SHARED/history"
ASSET_POOL="$SHARED/web-assets"
MIGRATIONS_REL="packages/db/migrations"
FIRST_LABELLED_MIGRATION=73

# --- release.conf (S1/S2 answers; overridable per box) -------------------------------------------
KEEP_RELEASES=5          # S1: keep the last 5 releases
SERVICE_START_HOUR=10    # S2: deploy/activate refused 10:00–24:00 Europe/Istanbul
SERVICE_END_HOUR=24
PNPM_STORE_DIR=""        # empty = pnpm default; set to pin the store (ADR-047 PR-0 note)
if [[ -f "$SHARED/release.conf" ]]; then
  # shellcheck source=/dev/null
  source "$SHARED/release.conf"
fi

# --- output -------------------------------------------------------------------------------------
if [[ -t 1 ]]; then RED=$'\e[31m'; GRN=$'\e[32m'; YLW=$'\e[33m'; RST=$'\e[0m'; else RED=''; GRN=''; YLW=''; RST=''; fi
info() { printf '%s\n' "• $*"; }
ok()   { printf '%s\n' "${GRN}✔ $*${RST}"; }
warn() { printf '%s\n' "${YLW}⚠ $*${RST}" >&2; }
die()  { printf '%s\n' "${RED}✘ $*${RST}" >&2; exit 1; }

usage() {
  cat <<'EOF'
Kullanım: pos-release <komut> [seçenekler]

  build <commit>          Yeni sürümü hazırlar (canlıya DOKUNMAZ)
  deploy <commit>         Hazırla → (gerekirse yedek + migration) → canlıya al → kontrol et
  activate <sürüm>        Hazır bir sürümü canlıya alır
  rollback [<sürüm>]      Önceki (ya da verilen) sürüme döner — servis saatinde de serbest
  rollback <sürüm> --sema-geri --onay
                          Araya 'breaking' migration girdiyse önce down dosyalarıyla şemayı geri alır
                          (yedek önce; servis saatinde yalnız --servis-icinde ile — ADR-049 K4)
  list                    Sürümleri listeler
  status                  Canlı sürüm, veritabanı migration durumu
  prune                   Eski sürümleri ve kullanılmayan web dosyalarını temizler
  self-install <sürüm>    pos-release ve run-api.sh'ı o sürümden bin/'e kurar

Seçenekler:
  --servis-icinde         Servis saatinde deploy/activate'e izin ver (yalnız acil düzeltme)
  --breaking-onay         'breaking' migration içeren deploy'u onayla (geri dönüş betikle mümkün olmaz)
  --sema-geri             rollback: down dosyalarıyla şema geri alma (ADR-049)
  --onay                  --sema-geri listesini okuduğunu ve onayladığını belirtir
EOF
}

# --- helpers ------------------------------------------------------------------------------------
now_ms() { date +%s%3N; }

in_service_window() {
  local h
  h=$(TZ=Europe/Istanbul date +%H)
  h=$((10#$h))
  (( h >= SERVICE_START_HOUR && h < SERVICE_END_HOUR ))
}

require_outside_service() {
  local allow="$1"
  if in_service_window; then
    if [[ "$allow" == "1" ]]; then
      warn "SERVİS SAATİ (${SERVICE_START_HOUR}:00–${SERVICE_END_HOUR}:00) — --servis-icinde ile bilerek devam ediliyor."
    else
      die "Servis saatinde (${SERVICE_START_HOUR}:00–${SERVICE_END_HOUR}:00, Türkiye) güncelleme yapılmaz. Acil düzeltme ise --servis-icinde ekleyin. Geri dönüş (rollback) bu kilide takılmaz."
    fi
  fi
}

current_id() {
  [[ -L "$CURRENT" ]] || { echo ""; return 0; }
  basename "$(readlink "$CURRENT")"
}

release_dir() { echo "$RELEASES/$1"; }

# Release ids, oldest first (names are time-prefixed, so name order = time order).
release_ids() {
  [[ -d "$RELEASES" ]] || return 0
  find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -regextype posix-extended \
    -regex '.*/[0-9]{8}T[0-9]{6}Z-[0-9a-f]+' -printf '%f\n' | sort
}

require_release() {
  local id="$1"
  [[ "$id" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,40}$ ]] || die "Geçersiz sürüm adı: '$id'"
  [[ -f "$(release_dir "$id")/RELEASE.json" ]] || die "Sürüm bulunamadı ya da yarım: $id"
}

# Last migration file name (without .sql) shipped in a release.
release_migration_head() {
  local dir="$1/$MIGRATIONS_REL"
  find "$dir" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | sort | tail -n1 | sed 's/\.sql$//'
}

psql_db() {
  sudo -u postgres psql -d "$POS_DB_NAME" -At -v ON_ERROR_STOP=1 -c "$1"
}

db_applied() { psql_db 'SELECT name FROM pgmigrations ORDER BY name COLLATE "C"'; }
db_head()    { psql_db 'SELECT name FROM pgmigrations ORDER BY name COLLATE "C" DESC LIMIT 1'; }

# Migrations shipped in a release that the DB has not applied yet.
pending_migrations() {
  local dir="$1/$MIGRATIONS_REL" applied
  applied=$(db_applied) || return 1   # unreadable DB must not look like "everything pending"
  find "$dir" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | sort | sed 's/\.sql$//' | while read -r name; do
    grep -qxF "$name" <<<"$applied" || echo "$name"
  done
}

# ADR-047 K5.2: additive only if numbered ≥ 073 AND exactly one valid label line "additive" in the
# first 20 lines. Anything else (≤072, missing file, missing/garbled label) is breaking (fail-closed).
migration_compat() {
  local name="$1" file="$2" num labels
  num=$((10#${name%%_*}))
  if (( num < FIRST_LABELLED_MIGRATION )) || [[ ! -f "$file" ]]; then echo breaking; return 0; fi
  # Case-insensitive count, like the TS classifier: a stray "ROLLBACK-COMPAT:" line must count.
  labels=$(head -n 20 "$file" | grep -ciE '^[[:space:]]*--[[:space:]]*rollback-compat[[:space:]]*:' || true)
  if [[ "$labels" == "1" ]] && head -n 20 "$file" | grep -qxE -- '-- rollback-compat: additive[[:space:]]*'; then
    echo additive
  else
    echo breaking
  fi
}

# Find a migration file in any kept release (newest first).
find_migration_file() {
  local name="$1" d
  while read -r d; do
    if [[ -f "$RELEASES/$d/$MIGRATIONS_REL/$name.sql" ]]; then echo "$RELEASES/$d/$MIGRATIONS_REL/$name.sql"; return 0; fi
  done < <(release_ids | tac)
  echo ""
}

# ADR-049 K3: down files live next to the migrations, outside node-pg-migrate's folder.
DOWN_REL="packages/db/migrations-down"
find_down_file() {
  local name="$1" d
  while read -r d; do
    if [[ -f "$RELEASES/$d/$DOWN_REL/$name.down.sql" ]]; then echo "$RELEASES/$d/$DOWN_REL/$name.down.sql"; return 0; fi
  done < <(release_ids | tac)
  echo ""
}

pnpm_cmd() {
  if [[ -n "$PNPM_STORE_DIR" ]]; then pnpm --store-dir "$PNPM_STORE_DIR" "$@"; else pnpm "$@"; fi
}

with_lock() {
  mkdir -p "$SHARED"
  exec 9>"$SHARED/.lock"
  flock -n 9 || die "Başka bir pos-release işlemi sürüyor."
}

record_history() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $1" >>"$HISTORY"; }

# The release active before the current one (from history), if it still exists.
previous_id() {
  local cur
  cur=$(current_id)
  [[ -f "$HISTORY" ]] || { echo ""; return 0; }
  # Walk history from the newest entry; first existing release that is not current.
  awk '{print $2}' "$HISTORY" | tac | while read -r id; do
    [[ "$id" == "$cur" ]] && continue
    if [[ -f "$RELEASES/$id/RELEASE.json" ]]; then echo "$id"; break; fi
  done
}

# --- build --------------------------------------------------------------------------------------
cmd_build() {
  local rev="$1" sha short id dir tmp
  sha=$(git --git-dir="$POS_GIT_DIR" rev-parse --verify --quiet "${rev}^{commit}") || die "Commit bulunamadı: $rev ($POS_GIT_DIR)"
  short=${sha:0:7}
  id="$(date -u +%Y%m%dT%H%M%SZ)-$short"
  dir="$RELEASES/$id"
  tmp="$RELEASES/.building-$id"
  [[ -f "$SHARED/web.env.production" ]] || die "$SHARED/web.env.production yok (web derlemesi için gerekli)."
  mkdir -p "$RELEASES" "$ASSET_POOL"

  info "Sürüm hazırlanıyor: $id (commit $sha)"
  rm -rf "$tmp"
  mkdir -p "$tmp"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" EXIT

  git --git-dir="$POS_GIT_DIR" archive "$sha" | tar -x -C "$tmp"
  cp "$SHARED/web.env.production" "$tmp/apps/web/.env.production"

  # node-pg-migrate would also run .js/.ts files, which carry no rollback-compat label.
  local stray
  stray=$(find "$tmp/$MIGRATIONS_REL" -maxdepth 1 -type f ! -name '*.sql' -printf '%f ')
  [[ -z "$stray" ]] || die "Migration klasöründe .sql olmayan dosya var: $stray"

  local want have
  want=$(node -e 'const p=require(process.argv[1]).packageManager||"";console.log(p.replace(/^pnpm@/,""))' "$tmp/package.json")
  have=$(cd "$tmp" && pnpm -v)
  if [[ -n "$want" && "$want" != "$have" ]]; then
    die "pnpm sürümü uyuşmuyor: depo $want istiyor, sunucuda $have çalışıyor. (corepack ile sabitleyin: corepack enable && corepack prepare pnpm@$want --activate)"
  fi

  (
    cd "$tmp"
    pnpm_cmd install --frozen-lockfile \
      --filter "@restoran-pos/api..." --filter "@restoran-pos/db..." --filter "@restoran-pos/web..."
    pnpm_cmd --filter @restoran-pos/shared-types build
    pnpm_cmd --filter @restoran-pos/web build
  ) || die "Derleme başarısız — yarım sürüm silindi, canlı sistem etkilenmedi."

  [[ -f "$tmp/apps/web/dist/index.html" ]] || die "Web derlemesi index.html üretmedi."

  local head
  head=$(release_migration_head "$tmp")
  (cd "$tmp" && node -e '
    const [sha, id, head, node, pnpmV] = process.argv.slice(1);
    const fs = require("fs"); const crypto = require("crypto");
    const lock = crypto.createHash("sha256").update(fs.readFileSync("pnpm-lock.yaml")).digest("hex").slice(0, 16);
    fs.writeFileSync("RELEASE.json", JSON.stringify({ id, sha, built_at: new Date().toISOString(),
      migration_head: head, node, pnpm: pnpmV, lockfile_sha256_16: lock }, null, 2) + "\n");
  ' "$sha" "$id" "$head" "$(node -v)" "$have")

  mv "$tmp" "$dir"
  trap - EXIT
  ok "Sürüm hazır: $id (migration head: ${head:-yok})"
  BUILT_ID="$id"
}

# --- activate (switch + restart + smoke) --------------------------------------------------------
switch_current() {
  local id="$1"
  # K4: add this release's hashed web assets to the shared pool; never delete here.
  if [[ -d "$RELEASES/$id/apps/web/dist/assets" ]]; then
    cp -a --update=none "$RELEASES/$id/apps/web/dist/assets/." "$ASSET_POOL/"
  fi
  # K1: atomic switch — rename(2) of a new symlink over the old one.
  rm -f "$POS_ROOT/current.tmp"
  ln -s "releases/$id" "$POS_ROOT/current.tmp"
  mv -T "$POS_ROOT/current.tmp" "$CURRENT"
}

pm2_restart_count() {
  pm2 jlist | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      const p=JSON.parse(s).find(x=>x.name===process.argv[1]);
      if(!p){console.log("missing");return}
      console.log(p.pm2_env.status+" "+p.pm2_env.restart_time);
    });' "$POS_PM2_APP"
}

smoke() {
  local fail=0 code body r i
  # Wait for the API to come up (tsx start ≈ 2.5 s on prod, PR-0).
  for ((i = 0; i < POS_SMOKE_WAIT_SECS; i++)); do
    body=$(curl -s --max-time 5 "$POS_BASE_URL/api/health" || true)
    [[ "$body" == *'"ok"'* ]] && break
    sleep 1
  done
  if [[ "$body" == *'"ok"'* ]]; then ok "/api/health ok"; else warn "/api/health yanıt vermedi: ${body:0:80}"; fail=1; fi

  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$POS_BASE_URL/" || true)
  if [[ "$code" == "200" ]]; then ok "/ → 200"; else warn "/ → $code"; fail=1; fi

  body=$(curl -s --max-time 10 "$POS_BASE_URL/socket.io/?EIO=4&transport=polling" || true)
  if [[ "$body" == 0\{* ]]; then ok "socket.io el sıkışması"; else warn "socket.io: ${body:0:40}"; fail=1; fi

  # S148: token-less real routes must answer 401, never 500 (proves the middleware/mount chain).
  for r in orders tables printers audit-logs products/x/attribute-groups; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$POS_BASE_URL/api/$r" || true)
    if [[ "$code" == "401" ]]; then ok "/api/$r → 401"; else warn "/api/$r → $code (beklenen 401)"; fail=1; fi
  done

  local before after
  before=$(pm2_restart_count)
  sleep 3
  after=$(pm2_restart_count)
  if [[ "$before" == "$after" && "$after" == online* ]]; then ok "pm2: $after (yeniden başlama döngüsü yok)"; else warn "pm2 kararsız: $before → $after"; fail=1; fi
  return "$fail"
}

activate_and_smoke() {
  local id="$1" t0 t1
  t0=$(now_ms)
  switch_current "$id"
  if ! pm2 restart "$POS_PM2_APP" --time >/dev/null; then
    warn "pm2 restart başarısız."
    return 1
  fi
  info "Canlı sürüm: $id — kontroller yapılıyor…"
  if smoke; then
    # Only a release that passed smoke enters history, so "previous" never points at a broken one.
    record_history "$id"
    t1=$(now_ms)
    ok "Kontroller geçti. Geçiş + kontrol süresi: $(( (t1 - t0) / 1000 )) sn"
    return 0
  fi
  return 1
}

cmd_activate() {
  local id="$1" allow="$2"
  require_release "$id"
  require_outside_service "$allow"
  [[ "$id" != "$(current_id)" ]] || die "Bu sürüm zaten canlı: $id"
  local pending
  pending=$(pending_migrations "$(release_dir "$id")") || die "Veritabanı okunamadı — bekleyen migration'lar belirlenemiyor."
  [[ -z "$pending" ]] || die "Bu sürümün uygulanmamış migration'ları var ($(echo "$pending" | tr '\n' ' ')). activate değil deploy kullanın."
  # Activating an older release is a rollback in disguise → same K5 schema check.
  local reason
  if ! reason=$(rollback_allowed "$id"); then
    printf '%s\n' "$reason"
    die "Bu sürüm bugünkü veritabanıyla güvenli değil — activate REDDEDİLDİ."
  fi
  activate_and_smoke "$id" || die "Kontroller başarısız. Önceki sürüme dönmek için: pos-release rollback"
}

# --- rollback (K5) ------------------------------------------------------------------------------
# Echoes the reason and returns 1 if rolling back to $1 is not safe for the current DB schema.
rollback_allowed() {
  local target="$1" t_head d_head applied name file verdict blocked=0 listed=0
  t_head=$(jq_field "$(release_dir "$target")/RELEASE.json" migration_head)
  # Fail closed: an unreadable DB must never look like "safe".
  applied=$(db_applied) || { echo "Veritabanı okunamadı — geri dönüşün güvenli olduğu doğrulanamıyor."; return 1; }
  d_head=$(printf '%s\n' "$applied" | tail -n1)
  [[ -n "$d_head" ]] || { echo "Veritabanında uygulanmış migration görünmüyor — doğrulanamıyor."; return 1; }
  if [[ "$d_head" == "$t_head" ]]; then
    info "Veritabanı ve hedef sürüm aynı migration'da ($d_head) — geri dönüş güvenli."
    return 0
  fi
  if [[ "$d_head" < "$t_head" ]]; then
    echo "Veritabanı ($d_head) hedef sürümün gerisinde ($t_head): bu geri dönüş değil, deploy."
    return 1
  fi
  info "Hedef sürümden sonra uygulanan migration'lar:"
  while read -r name; do
    [[ -z "$name" ]] && continue
    [[ "$name" > "$t_head" ]] || continue
    file=$(find_migration_file "$name")
    verdict=$(migration_compat "$name" "$file")
    printf '    %-50s %s\n' "$name" "$verdict"
    listed=$((listed + 1))
    [[ "$verdict" == "additive" ]] || blocked=1
  done <<<"$applied"
  if (( listed == 0 )); then
    echo "Veritabanı hedeften ileride görünüyor ama aradaki migration'lar listelenemedi — doğrulanamıyor."
    return 1
  fi
  if (( blocked )); then
    echo "Aradaki migration'lardan en az biri 'breaking' — eski kod bugünkü veritabanıyla güvenle çalışmaz. Yol: düzeltip ileri deploy, ya da yedekten dönüş (veri kaybı; ürün sahibi kararı, backup-strategy.md §7)."
    return 1
  fi
  return 0
}

jq_field() {
  node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(o[process.argv[2]] ?? "")' "$1" "$2"
}

# ADR-049 K4 — plan the schema downs needed before rolling code back to $1.
# Prints, one per line, "<name>\t<down-file>" in the order to run them (newest first).
# Returns 1 (with the reason on stdout) if the plan is impossible.
sema_geri_plan() {
  local target="$1" t_head applied name file verdict down seen_additive=0
  t_head=$(jq_field "$(release_dir "$target")/RELEASE.json" migration_head)
  applied=$(db_applied) || { echo "Veritabanı okunamadı."; return 1; }
  while read -r name; do
    [[ -z "$name" || ! "$name" > "$t_head" ]] && continue
    file=$(find_migration_file "$name")
    verdict=$(migration_compat "$name" "$file")
    if [[ "$verdict" == "additive" ]]; then
      seen_additive=1   # stays applied; everything older than it must be additive too
      continue
    fi
    if (( seen_additive )); then
      echo "$name 'breaking', ama ondan sonra 'additive' migration uygulanmış: kayıt sırası bozulmadan geri alınamaz (node-pg-migrate sırayı denetler). Yol: düzeltip ileri deploy."
      return 1
    fi
    down=$(find_down_file "$name")
    if [[ -z "$down" ]]; then
      echo "$name 'breaking' ve down dosyası yok (ya da '-- down: yok' ile bilerek bırakılmış). Yol: düzeltip ileri deploy, ya da yedekten dönüş."
      return 1
    fi
    printf '%s\t%s\n' "$name" "$down"
  done < <(printf '%s\n' "$applied" | sort -r)
}

run_schema_downs() {
  local plan="$1" name down rel tsx cli
  rel="$(release_dir "$(current_id)")"
  tsx="$rel/packages/db/node_modules/.bin/tsx"
  cli="$rel/packages/db/src/apply-down-cli.ts"
  while IFS=$'\t' read -r name down; do
    [[ -z "$name" ]] && continue
    info "Şema geri alınıyor: $name ← $down"
    # cwd = root-owned release dir (tsx looks for tsconfig.json from cwd) and no tsx cache in
    # /tmp (another local user could pre-create it) — code runs as the postgres superuser.
    if ! (cd "$rel/packages/db" && sudo -u postgres env PGHOST="$POS_PGHOST" PGDATABASE="$POS_DB_NAME" \
          TSX_DISABLE_CACHE=1 "$tsx" "$cli" "$name" "$down"); then
      die "Down başarısız: $name. Önceki down'lar tamamlandı; veritabanı head'i şimdi: $(db_head). Canlı kod artık KISMEN geri alınmış şemada çalışıyor. Sebebi giderip AYNI komutu tekrar çalıştırın (plan veritabanından yeniden hesaplanır, kaldığı yerden sürer)."
    fi
  done <<<"$plan"
}

cmd_rollback() {
  local target="${1:-}" sema_geri="${2:-0}" onay="${3:-0}" allow="${4:-0}" reason plan t0
  t0=$(now_ms)
  if [[ -z "$target" ]]; then
    target=$(previous_id)
    [[ -n "$target" ]] || die "Dönülecek önceki sürüm bulunamadı."
  fi
  require_release "$target"
  [[ "$target" != "$(current_id)" ]] || die "Bu sürüm zaten canlı: $target"
  info "Geri dönüş: $(current_id) → $target"
  local pending
  pending=$(pending_migrations "$(release_dir "$target")") || die "Veritabanı okunamadı — bekleyen migration'lar belirlenemiyor."
  [[ -z "$pending" ]] || die "Hedef sürümün uygulanmamış migration'ları var ($(echo "$pending" | tr '\n' ' ')) — bu geri dönüş değil, deploy."
  if ! reason=$(rollback_allowed "$target"); then
    printf '%s\n' "$reason"
    if [[ "$sema_geri" != "1" ]]; then
      if plan=$(sema_geri_plan "$target") && [[ -n "$plan" ]]; then
        warn "Down dosyaları mevcut — 'pos-release rollback $target --sema-geri' ile şema geri alınarak denenebilir (ADR-049)."
      fi
      die "Geri dönüş REDDEDİLDİ."
    fi
    # ADR-049 K4: schema first, then code. Unlike plain rollback, the service-hours lock applies
    # (down DDL takes locks); --servis-icinde overrides it only with the owner's approval (S1).
    require_outside_service "$allow"
    plan=$(sema_geri_plan "$target") || { printf '%s\n' "$plan"; die "Şema geri alma REDDEDİLDİ — hiçbir şey değiştirilmedi."; }
    [[ -n "$plan" ]] || die "Geri alınacak 'breaking' migration bulunamadı ama K5 kontrolü reddetti — elle inceleme gerekli."
    info "Geri alınacak şema değişiklikleri (yeniden eskiye):"
    while IFS=$'\t' read -r name down; do
      printf '    %s\n' "$name"
      grep -E '^--' "$down" | grep -v -- '-- down-for:' | sed 's/^/        /' | head -n 6
    done <<<"$plan"
    warn "Down yapıyı geri getirir, silinmiş VERİYİ getirmez (gerekirse yedekten yalnız o alan — ADR-049 K2)."
    [[ "$onay" == "1" ]] || die "Listeyi okuyup onaylamak için komutu --onay ile tekrar çalıştırın."
    take_backup
    run_schema_downs "$plan"
    ok "Şema geri alındı. Veritabanı head'i: $(db_head)"
    if ! reason=$(rollback_allowed "$target"); then
      printf '%s\n' "$reason"
      die "Şema geri alındı ama K5 kontrolü hâlâ reddediyor — kod değiştirilmedi, elle inceleme gerekli."
    fi
  fi
  [[ -n "$reason" ]] && printf '%s\n' "$reason"
  if activate_and_smoke "$target"; then
    ok "Geri dönüş tamam — toplam $(( ($(now_ms) - t0) / 1000 )) sn."
  else
    die "Geri dönülen sürümde de kontroller başarısız. Elle inceleme gerekli (pm2 logs $POS_PM2_APP)."
  fi
}

# --- deploy -------------------------------------------------------------------------------------
run_migrations() {
  local dir="$1"
  (
    set +x
    local owner_mode
    owner_mode=$(stat -c '%U %a' "$POS_SECRETS_FILE") || { echo "$POS_SECRETS_FILE okunamadı" >&2; exit 1; }
    [[ "$owner_mode" == "$(id -un) 600" ]] || { echo "$POS_SECRETS_FILE izinleri güvensiz ($owner_mode; beklenen: $(id -un) 600)" >&2; exit 1; }
    # shellcheck source=/dev/null
    source "$POS_SECRETS_FILE"
    [[ -n "${PG_MIGRATOR_PASSWORD:-}" ]] || { echo "PG_MIGRATOR_PASSWORD yok ($POS_SECRETS_FILE)" >&2; exit 1; }
    cd "$dir"
    # Password goes via PGPASSWORD, never inside the URL: an unencoded '/' '+' '=' would break URL
    # parsing and Node prints the whole URL (password included) in ERR_INVALID_URL (security review).
    PGPASSWORD="$PG_MIGRATOR_PASSWORD" \
      DATABASE_URL="postgresql://migrator@127.0.0.1:5432/${POS_DB_NAME}" \
      ./packages/db/node_modules/.bin/node-pg-migrate -m "$MIGRATIONS_REL" up
  )
}

take_backup() {
  info "Migration öncesi yedek alınıyor ($POS_BACKUP_UNIT)…"
  systemctl start "$POS_BACKUP_UNIT" || true
  local result
  result=$(systemctl show "$POS_BACKUP_UNIT" -p Result --value)
  [[ "$result" == "success" ]] || die "Yedek başarısız (Result=$result) — deploy DURDURULDU, canlı sistem etkilenmedi."
  ok "Yedek alındı (Result=success)."
}

cmd_deploy() {
  local rev="$1" allow="$2" breaking_ok="$3" prev new pending name file v breaking=0
  require_outside_service "$allow"
  prev=$(current_id)
  cmd_build "$rev"
  new="$BUILT_ID"

  pending=$(pending_migrations "$(release_dir "$new")") || die "Veritabanı okunamadı — bekleyen migration'lar belirlenemiyor."
  if [[ -n "$pending" ]]; then
    info "Uygulanacak migration'lar:"
    while read -r name; do
      file="$(release_dir "$new")/$MIGRATIONS_REL/$name.sql"
      v=$(migration_compat "$name" "$file")
      printf '    %-50s %s\n' "$name" "$v"
      [[ "$v" == "additive" ]] || breaking=1
    done <<<"$pending"
    if (( breaking )) && [[ "$breaking_ok" != "1" ]]; then
      die "'breaking' migration var: bu sürümden betikle geri dönülemez. Restoran kapalıyken --breaking-onay ile tekrar çalıştırın. (Hazırlanan sürüm duruyor: $new)"
    fi
    (( breaking )) && warn "BU SÜRÜMDEN GERİ DÖNÜŞ BETİKLE MÜMKÜN DEĞİL ('breaking' migration)."
    take_backup
    run_migrations "$(release_dir "$new")" || die "Migration başarısız — sürüm değiştirilmedi. Veritabanı durumunu kontrol edin: pos-release status"
    ok "Migration'lar uygulandı."
  else
    info "Bekleyen migration yok."
    # Deploying an older commit is a rollback in disguise → same K5 check (migration guard review).
    local reason
    if ! reason=$(rollback_allowed "$new"); then
      printf '%s\n' "$reason"
      die "Bu sürüm bugünkü veritabanıyla güvenli değil — deploy REDDEDİLDİ. (Hazırlanan sürüm duruyor: $new)"
    fi
  fi

  if activate_and_smoke "$new"; then
    ok "Deploy tamam: $new"
    cmd_prune
    return 0
  fi

  if [[ -z "$pending" && -n "$prev" ]]; then
    warn "Kontroller başarısız ve migration yoktu — otomatik olarak önceki sürüme ($prev) dönülüyor (S3)."
    activate_and_smoke "$prev" || die "Önceki sürümde de kontroller başarısız. Elle inceleme gerekli."
    die "Deploy geri alındı. Canlı sürüm yeniden: $prev"
  fi
  local reason=""
  if [[ -n "$prev" ]] && reason=$(rollback_allowed "$prev"); then
    printf '%s\n' "$reason"
    die "Kontroller başarısız. Migration uygulandığı için otomatik dönülmedi (S3); yukarıdaki listeye göre 'pos-release rollback' güvenli görünüyor — karar sizin."
  fi
  printf '%s\n' "$reason"
  die "Kontroller başarısız ve geri dönüş betikle güvenli değil. Düzeltip ileri deploy gerekli."
}

# --- prune --------------------------------------------------------------------------------------
cmd_prune() {
  local cur prev keep=() all id f
  cur=$(current_id)
  prev=$(previous_id)
  mapfile -t all < <(release_ids)
  # newest KEEP_RELEASES + current + previous are always kept
  local n=${#all[@]} i
  for ((i = 0; i < n; i++)); do
    id=${all[$i]}
    if (( i >= n - KEEP_RELEASES )) || [[ "$id" == "$cur" || "$id" == "$prev" ]]; then keep+=("$id"); continue; fi
    info "Eski sürüm siliniyor: $id"
    rm -rf "${RELEASES:?}/$id"
  done
  # Asset pool: remove files no kept release references.
  if [[ -d "$ASSET_POOL" ]]; then
    local wanted
    wanted=$(for id in "${keep[@]}"; do
      [[ -d "$RELEASES/$id/apps/web/dist/assets" ]] && ls -1 "$RELEASES/$id/apps/web/dist/assets"
    done | sort -u)
    for f in "$ASSET_POOL"/*; do
      [[ -e "$f" ]] || continue
      grep -qxF "$(basename "$f")" <<<"$wanted" || rm -f "$f"
    done
  fi
  # leftover half builds from a crashed run
  find "$RELEASES" -maxdepth 1 -name '.building-*' -mmin +60 -exec rm -rf {} + 2>/dev/null || true
  ok "Temizlik tamam (${#keep[@]} sürüm saklanıyor)."
}

# --- list / status ------------------------------------------------------------------------------
cmd_list() {
  local cur id mark
  cur=$(current_id)
  [[ -d "$RELEASES" ]] || { info "Henüz sürüm yok."; return 0; }
  release_ids | while read -r id; do
    mark="  "; [[ "$id" == "$cur" ]] && mark="▶ "
    printf '%s%-32s migration_head=%s\n' "$mark" "$id" "$(jq_field "$RELEASES/$id/RELEASE.json" migration_head)"
  done
}

cmd_status() {
  local cur
  cur=$(current_id)
  printf 'Canlı sürüm      : %s\n' "${cur:-yok}"
  [[ -n "$cur" ]] && printf 'Sürüm migration  : %s\n' "$(jq_field "$RELEASES/$cur/RELEASE.json" migration_head)"
  printf 'Veritabanı head  : %s\n' "$(db_head)"
  printf 'Önceki sürüm     : %s\n' "$(previous_id)"
  if in_service_window; then printf 'Servis saati     : EVET (deploy kilitli, rollback serbest)\n'; else printf 'Servis saati     : hayır\n'; fi
  printf 'pm2 (%s)    : %s\n' "$POS_PM2_APP" "$(pm2_restart_count 2>/dev/null || echo '?')"
}

cmd_self_install() {
  local id="$1" src
  require_release "$id"
  src="$(release_dir "$id")/apps/api/scripts/deploy"
  mkdir -p "$POS_ROOT/bin"
  install -m 0755 "$src/pos-release.sh" "$POS_ROOT/bin/pos-release"
  install -m 0700 "$src/run-api.sh" "$POS_ROOT/bin/run-api.sh"
  ok "bin/ güncellendi ($id)."
}

# --- main ---------------------------------------------------------------------------------------
main() {
  local cmd="${1:-}"; shift || true
  local allow=0 breaking_ok=0 sema_geri=0 onay=0 args=()
  for a in "$@"; do
    case "$a" in
      --servis-icinde) allow=1 ;;
      --breaking-onay) breaking_ok=1 ;;
      --sema-geri) sema_geri=1 ;;
      --onay) onay=1 ;;
      -*) die "Bilinmeyen seçenek: $a" ;;
      *) args+=("$a") ;;
    esac
  done
  case "$cmd" in
    build)        [[ ${#args[@]} -eq 1 ]] || die "Kullanım: pos-release build <commit>"; with_lock; cmd_build "${args[0]}" ;;
    deploy)       [[ ${#args[@]} -eq 1 ]] || die "Kullanım: pos-release deploy <commit>"; with_lock; cmd_deploy "${args[0]}" "$allow" "$breaking_ok" ;;
    activate)     [[ ${#args[@]} -eq 1 ]] || die "Kullanım: pos-release activate <sürüm>"; with_lock; cmd_activate "${args[0]}" "$allow" ;;
    rollback)     [[ ${#args[@]} -le 1 ]] || die "Kullanım: pos-release rollback [<sürüm>]"; with_lock; cmd_rollback "${args[0]:-}" "$sema_geri" "$onay" "$allow" ;;
    prune)        with_lock; cmd_prune ;;
    list)         cmd_list ;;
    status)       cmd_status ;;
    self-install) [[ ${#args[@]} -eq 1 ]] || die "Kullanım: pos-release self-install <sürüm>"; with_lock; cmd_self_install "${args[0]}" ;;
    ""|-h|--help|help) usage ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"
