#!/usr/bin/env bash
# End-to-end test for pos-release.sh (ADR-047 PR-2) against a fake root with stub binaries.
# Runs on Linux (CI: .github/workflows/pos-release.yml). Exercises the real script — no mocks of its
# own logic — only the outside world (git repo, pnpm, psql, pm2, systemctl, curl) is faked.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/pos-release.sh"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

export POS_ROOT="$T/srv"
export POS_GIT_DIR="$T/bare.git"
export POS_SECRETS_FILE="$T/secrets.env"
export POS_SMOKE_WAIT_SECS=2
export STUB_DB="$T/db-applied"
export STUB_PM2="$T/pm2-restarts"
STUBS="$T/stubs"
PNPM_V="9.15.9"
mkdir -p "$STUBS" "$POS_ROOT/shared" "$POS_ROOT/bin"
# Like prod at cutover: the DB already sits at 072 (legacy, unlabelled = breaking).
printf '001_init\n072_last_legacy\n' >"$STUB_DB"
echo 0 >"$STUB_PM2"
# Password with URL-hostile characters (security review): must work and never be printed.
echo "PG_MIGRATOR_PASSWORD='te/st+only='" >"$POS_SECRETS_FILE"
chmod 600 "$POS_SECRETS_FILE"
echo 'VITE_API_URL=/api' >"$POS_ROOT/shared/web.env.production"

pass=0
check() { # check <description> <command...>
  local d="$1"; shift
  if "$@"; then pass=$((pass + 1)); echo "  ok  $d"; else echo "  FAIL $d"; exit 1; fi
}
current() { basename "$(readlink "$POS_ROOT/current")"; }
count_files() { find "$1" -mindepth 1 -maxdepth 1 | wc -l; }
count_releases() { find "$POS_ROOT/releases" -mindepth 1 -maxdepth 1 -type d -name '*Z-*' ! -name '.building-*' | wc -l; }
conf() { printf 'KEEP_RELEASES=%s\nSERVICE_START_HOUR=%s\nSERVICE_END_HOUR=%s\n' "$1" "$2" "$3" >"$POS_ROOT/shared/release.conf"; }
run() { local rc=0; "$SCRIPT" "$@" >"$T/out" 2>&1 || rc=$?; cat "$T/out" >>"$T/all"; return "$rc"; }
out_has() { grep -qF -- "$1" "$T/out"; }

# --- stubs --------------------------------------------------------------------------------------
cat >"$STUBS/pnpm" <<EOF
#!/usr/bin/env bash
[[ "\$1" == "--store-dir" ]] && shift 2
case "\$*" in
  -v) echo "$PNPM_V" ;;
  install*)
    mkdir -p node_modules packages/db/node_modules/.bin apps/api/node_modules/.bin
    cat >packages/db/node_modules/.bin/node-pg-migrate <<'MIG'
#!/usr/bin/env bash
[[ "\$PGPASSWORD" == "te/st+only=" ]] || { echo "PGPASSWORD missing" >&2; exit 1; }
[[ "\$DATABASE_URL" == postgresql://migrator@* && "\$DATABASE_URL" != *te/st* ]] || { echo "password inside URL" >&2; exit 1; }
for f in packages/db/migrations/*.sql; do n=\$(basename "\$f" .sql); grep -qxF "\$n" "\$STUB_DB" || echo "\$n" >>"\$STUB_DB"; done
MIG
    chmod +x packages/db/node_modules/.bin/node-pg-migrate ;;
  *shared-types*) : ;;
  *web*build*)
    [[ -n "\${STUB_BUILD_FAIL:-}" ]] && { echo "vite failed" >&2; exit 1; }
    mkdir -p apps/web/dist/assets
    h=\$(sha1sum package.json packages/db/migrations/* README 2>/dev/null | sha1sum | cut -c1-8)
    echo "<script src=/assets/app-\$h.js>" >apps/web/dist/index.html
    echo "app" >"apps/web/dist/assets/app-\$h.js" ;;
  *) echo "pnpm stub: unexpected \$*" >&2; exit 1 ;;
esac
EOF
cat >"$STUBS/sudo" <<'EOF'
#!/usr/bin/env bash
[[ -n "${STUB_DB_FAIL:-}" ]] && { echo "psql: connection refused" >&2; exit 2; }
sql="${@: -1}"
if [[ "$sql" == *DESC* ]]; then sort "$STUB_DB" | tail -n1; else sort "$STUB_DB"; fi
EOF
cat >"$STUBS/systemctl" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  start) [[ -n "${STUB_BACKUP_FAIL:-}" ]] && exit 1; touch "$STUB_DB.backup-taken" ;;
  show) if [[ -n "${STUB_BACKUP_FAIL:-}" ]]; then echo exit-code; else echo success; fi ;;
esac
EOF
cat >"$STUBS/pm2" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  restart) echo $(( $(cat "$STUB_PM2") + 1 )) >"$STUB_PM2" ;;
  jlist) printf '[{"name":"pos-api","pm2_env":{"status":"online","restart_time":%s}}]\n' "$(cat "$STUB_PM2")" ;;
esac
EOF
cat >"$STUBS/curl" <<'EOF'
#!/usr/bin/env bash
url=""; code=0
for a in "$@"; do [[ "$a" == http* ]] && url="$a"; [[ "$a" == "%{http_code}" ]] && code=1; done
live=$(basename "$(readlink "$POS_ROOT/current")")
if [[ -n "${STUB_SMOKE_FAIL_SHA:-}" && "$live" == *"$STUB_SMOKE_FAIL_SHA" ]]; then
  (( code )) && echo 500 || echo "Bad Gateway"; exit 0
fi
if (( code )); then [[ "$url" == */api/* ]] && echo 401 || echo 200; exit 0; fi
case "$url" in *health*) echo '{"status":"ok"}' ;; *socket.io*) echo '0{"sid":"x"}' ;; *) echo '<html>' ;; esac
EOF
chmod +x "$STUBS"/*
export PATH="$STUBS:$PATH"

# --- fake source repo ---------------------------------------------------------------------------
W="$T/work"
mkdir -p "$W/packages/db/migrations" "$W/apps/web" "$W/apps/api/scripts/deploy"
cd "$W"
git init -q -b main
git config user.email t@t && git config user.name t
printf '{"name":"x","packageManager":"pnpm@%s"}\n' "$PNPM_V" >package.json
echo 'lockfileVersion: 9' >pnpm-lock.yaml
echo '{"name":"@restoran-pos/web"}' >apps/web/package.json # git keeps no empty dirs
echo 'CREATE TABLE a (id int);' >packages/db/migrations/001_init.sql
echo 'ALTER TABLE a ADD b int;' >packages/db/migrations/072_last_legacy.sql
cp "$SCRIPT" "$HERE/run-api.sh" apps/api/scripts/deploy/
echo v1 >README
git add -A && git commit -qm c1 && C1=$(git rev-parse HEAD)
printf -- '-- add c\n-- rollback-compat: additive\nALTER TABLE a ADD c int;\n' >packages/db/migrations/073_add_c.sql
git add -A && git commit -qm c2 && C2=$(git rev-parse HEAD)
printf -- '-- drop b\n-- rollback-compat: breaking\nALTER TABLE a DROP b;\n' >packages/db/migrations/074_drop_b.sql
git add -A && git commit -qm c3 && C3=$(git rev-parse HEAD)
echo v4 >README
git add -A && git commit -qm c4 && C4=$(git rev-parse HEAD)
git clone -q --bare "$W" "$POS_GIT_DIR"
cd "$T"

conf 5 0 0 # service window never active

echo "== deploy + migrations"
run deploy "$C1" || { cat "$T/out"; exit 1; }
R1=$(current)
check "c1 is live" [ "${R1##*-}" = "${C1:0:7}" ]
check "no pending migrations → no backup" [ ! -f "$STUB_DB.backup-taken" ]
check "RELEASE.json migration_head" grep -q '"migration_head": "072_last_legacy"' "$POS_ROOT/releases/$R1/RELEASE.json"
check "web env copied into release" [ -f "$POS_ROOT/releases/$R1/apps/web/.env.production" ]
check "assets added to pool" [ "$(count_files "$POS_ROOT/shared/web-assets")" = 1 ]
sleep 1
run deploy "$C2" || { cat "$T/out"; exit 1; }
R2=$(current)
check "c2 is live" [ "${R2##*-}" = "${C2:0:7}" ]
check "073 applied" grep -qx 073_add_c "$STUB_DB"
check "backup taken before migrations" [ -f "$STUB_DB.backup-taken" ]
check "pool keeps old + new assets" [ "$(count_files "$POS_ROOT/shared/web-assets")" = 2 ]

echo "== unreadable DB → rollback refused (fail closed)"
export STUB_DB_FAIL=1
if run rollback; then echo "  FAIL rollback with unreadable DB should fail"; exit 1; fi
unset STUB_DB_FAIL
check "refused when DB unreadable" out_has "okunamadı"
check "still c2" [ "$(current)" = "$R2" ]

echo "== rollback over an additive migration"
run rollback || { cat "$T/out"; exit 1; }
check "rolled back to c1" [ "$(current)" = "$R1" ]
check "rollback printed duration" out_has "Geri dönüş tamam"
run activate "$R2" || { cat "$T/out"; exit 1; }
check "activate c2 again" [ "$(current)" = "$R2" ]

echo "== breaking migration needs explicit consent"
sleep 1
if run deploy "$C3"; then echo "  FAIL deploy without --breaking-onay should fail"; exit 1; fi
check "refused without --breaking-onay" out_has "breaking"
check "live unchanged" [ "$(current)" = "$R2" ]
check "074 not applied" bash -c "! grep -qx 074_drop_b '$STUB_DB'"
sleep 1
run deploy "$C3" --breaking-onay || { cat "$T/out"; exit 1; }
R3=$(current)
check "c3 live after consent" [ "${R3##*-}" = "${C3:0:7}" ]

echo "== rollback across a breaking migration is refused"
if run rollback; then echo "  FAIL rollback across breaking should fail"; exit 1; fi
check "rollback refused" out_has "REDDEDİLDİ"
check "still c3" [ "$(current)" = "$R3" ]
if run activate "$R2"; then echo "  FAIL activate of older release across breaking should fail"; exit 1; fi
check "activate-as-rollback refused" [ "$(current)" = "$R3" ]
sleep 1
if run deploy "$C2"; then echo "  FAIL deploy of an older commit across breaking should fail"; exit 1; fi
check "deploy-as-rollback refused" out_has "deploy REDDEDİLDİ"
check "still c3 after deploy-as-rollback" [ "$(current)" = "$R3" ]

echo "== failed smoke without migration → automatic rollback (S3)"
sleep 1
export STUB_SMOKE_FAIL_SHA="${C4:0:7}"
if run deploy "$C4"; then echo "  FAIL smoke failure should fail deploy"; exit 1; fi
unset STUB_SMOKE_FAIL_SHA
check "auto-rolled back to c3" [ "$(current)" = "$R3" ]
check "auto rollback announced" out_has "otomatik olarak önceki sürüme"
run status || { cat "$T/out"; exit 1; }
check "broken c4 never becomes 'previous'" bash -c "! grep 'Önceki sürüm' '$T/out' | grep -q '${C4:0:7}'"

echo "== failed build leaves nothing behind"
before=$(count_files "$POS_ROOT/releases")
export STUB_BUILD_FAIL=1
if run build "$C4"; then echo "  FAIL build should fail"; exit 1; fi
unset STUB_BUILD_FAIL
check "no new release dir" [ "$(count_files "$POS_ROOT/releases")" = "$before" ]
check "no half build left" bash -c "! ls -a '$POS_ROOT/releases' | grep -q building"
check "live unchanged" [ "$(current)" = "$R3" ]

echo "== backup failure stops before migration"
rm -f "$STUB_DB.backup-taken"
cd "$W" && printf -- '-- rollback-compat: additive\nSELECT 1;\n' >packages/db/migrations/075_x.sql && git add -A && git commit -qm c5 && C5=$(git rev-parse HEAD) && git push -q "$POS_GIT_DIR" main && cd "$T"
sleep 1
export STUB_BACKUP_FAIL=1
if run deploy "$C5"; then echo "  FAIL deploy should stop on backup failure"; exit 1; fi
unset STUB_BACKUP_FAIL
check "075 not applied" bash -c "! grep -qx 075_x '$STUB_DB'"
check "live unchanged" [ "$(current)" = "$R3" ]

echo "== secrets file with loose permissions stops migrations"
chmod 644 "$POS_SECRETS_FILE"
sleep 1
if run deploy "$C5"; then echo "  FAIL deploy with world-readable secrets should fail"; exit 1; fi
chmod 600 "$POS_SECRETS_FILE"
check "refused: insecure secrets file" out_has "izinleri güvensiz"
check "075 still not applied" bash -c "! grep -qx 075_x '$STUB_DB'"
check "live unchanged" [ "$(current)" = "$R3" ]

echo "== service window"
conf 5 0 24 # always in service
if run activate "$R1"; then echo "  FAIL activate in service window should fail"; exit 1; fi
check "activate refused in service hours" out_has "Servis saatinde"
if run deploy "$C5"; then echo "  FAIL deploy in service window should fail"; exit 1; fi
check "deploy refused in service hours" out_has "Servis saatinde"
run status || { cat "$T/out"; exit 1; }
check "status shows service lock" out_has "deploy kilitli"
conf 5 0 0

echo "== prune keeps N + current + previous; asset pool follows"
conf 2 0 0
run prune || { cat "$T/out"; exit 1; }
n=$(count_releases)
check "at most 4 releases kept (2 newest + current + previous)" [ "$n" -le 4 ]
check "current kept" [ -f "$POS_ROOT/releases/$(current)/RELEASE.json" ]
check "previous (c2, from history) kept" [ -d "$POS_ROOT/releases/$R2" ]
check "oldest (c1) pruned" [ ! -d "$POS_ROOT/releases/$R1" ]
for a in "$POS_ROOT"/shared/web-assets/*; do
  check "pooled asset $(basename "$a") belongs to a kept release" bash -c "ls '$POS_ROOT'/releases/*/apps/web/dist/assets/$(basename "$a") >/dev/null 2>&1"
done

echo "== self-install"
run self-install "$(current)" || { cat "$T/out"; exit 1; }
check "bin/pos-release installed" [ -x "$POS_ROOT/bin/pos-release" ]
check "bin/run-api.sh installed 0700" [ "$(stat -c %a "$POS_ROOT/bin/run-api.sh")" = 700 ]

echo "== secrets never printed"
check "migrator password not in any output" bash -c "! grep -rqF 'te/st+only=' '$T/all' '$POS_ROOT/shared' '$POS_ROOT/releases'"

echo "PASS ($pass checks)"
