#!/usr/bin/env bash
# Is the service actually serving? One definition, used by both deploy
# workflows and by hand.
#
#   ./infra/smoke.sh https://dona-prod-xxxx.me-west1.run.app
#   ./infra/smoke.sh --portal http://tenant.localhost:3000
#
# Checks db:up as well as ok:true — a process that boots but cannot reach
# Postgres is "deployed but silently broken" (docs/pipeline.md §5), and must fail
# the deploy rather than pass it.
#
# --portal also requires the web app manifest to answer 200. Only the tenant
# audience serves it, so a 404 means the hostname is answering as the office.
set -euo pipefail

PORTAL=0
if [[ "${1:-}" == "--portal" ]]; then
  PORTAL=1
  shift
fi

URL="${1:-}"
if [[ -z "$URL" ]]; then
  echo "usage: $0 [--portal] <service-url>" >&2
  exit 2
fi

ATTEMPTS="${SMOKE_ATTEMPTS:-10}"
DELAY="${SMOKE_DELAY:-3}"
# health, or the last manifest status when that is what failed.
FAIL="health"
MANIFEST_CODE=""

for attempt in $(seq 1 "$ATTEMPTS"); do
  BODY="$(curl -fsS --max-time 10 "$URL/health" 2>/dev/null)" || BODY=''
  if [[ "$BODY" == *'"ok":true'* && "$BODY" == *'"db":"up"'* ]]; then
    if [[ "$PORTAL" -eq 1 ]]; then
      CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$URL/manifest.webmanifest" 2>/dev/null || echo '000')"
      if [[ "$CODE" != "200" ]]; then
        FAIL="manifest"
        MANIFEST_CODE="$CODE"
        echo "  attempt $attempt/$ATTEMPTS: manifest ${CODE}" >&2
        [[ "$attempt" -lt "$ATTEMPTS" ]] && sleep "$DELAY"
        continue
      fi
      echo "smoke ok — $URL/health → $BODY; manifest 200"
      exit 0
    fi
    echo "smoke ok — $URL/health → $BODY"
    exit 0
  fi
  FAIL="health"
  echo "  attempt $attempt/$ATTEMPTS: ${BODY:-<no response>}" >&2
  [[ "$attempt" -lt "$ATTEMPTS" ]] && sleep "$DELAY"
done

if [[ "$FAIL" == "manifest" ]]; then
  echo "SMOKE FAILED — $URL/manifest.webmanifest returned ${MANIFEST_CODE}, want 200" >&2
else
  echo "SMOKE FAILED — $URL/health never returned ok:true with db:up" >&2
fi
exit 1
