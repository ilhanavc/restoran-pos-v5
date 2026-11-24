#!/usr/bin/env bash
# PM2 entry for pos-api (ADR-047 K2). Installed to /srv/restoran-pos/bin/ by `pos-release self-install`;
# it lives OUTSIDE any release so PM2 never pins a resolved release path — every start re-reads `current`.
# Holds no secrets: the environment comes from /etc/restoran-pos/api.env.
set -a
# shellcheck source=/dev/null
source /etc/restoran-pos/api.env
set +a
cd /srv/restoran-pos/current/apps/api
exec ./node_modules/.bin/tsx src/index.ts
