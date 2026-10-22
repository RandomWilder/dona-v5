#!/usr/bin/env bash
# Roll a Cloud Run service back to its previous revision. One command, no
# rebuild, no CI wait — this is what you run at 2am.
#
#   ./infra/rollback.sh prod                      # previous ready revision
#   ./infra/rollback.sh prod dona-prod-00007-abc  # a specific revision
#   ./infra/rollback.sh staging                   # both staging services
#
# Staging pins each service to its own previous ready revision. Both targets
# are chosen before either service is moved, so a portal with nowhere to go
# does not leave the office already rolled back. A named revision is applied
# to the service it belongs to; the other still goes to its own previous. A
# portal service that does not exist yet is reported and skipped. Production
# is one service, as before.
#
# Deliberately not interactive: hesitating is the expensive part of an
# incident, and rolling back is the safe direction. It refuses to act only
# when it cannot work out where to go.
#
# After this runs, traffic is PINNED to the chosen revision — the service is
# no longer following "latest". Roll forward with the command it prints.
set -euo pipefail

ENV="${1:-}"
case "$ENV" in
staging | prod) ;;
*)
  echo "usage: $0 <staging|prod> [revision]" >&2
  exit 2
  ;;
esac

PROJECT="${PROJECT:-dona-v5}"
REGION="${REGION:-me-west1}"
TARGET="${2:-}"

# The revision to pin. Does not move traffic. Sets CHOSEN and SERVING_NOW.
# macOS bash has no nameref, so the caller copies those before the next call.
choose_target() {
  local service="$1"
  local target="$2"
  local serving ready seen rev

  serving="$(gcloud run services describe "$service" \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.traffic[0].revisionName)')"
  if [[ -z "$serving" ]]; then
    echo "cannot determine the revision $service is currently serving" >&2
    exit 1
  fi

  if [[ -z "$target" ]]; then
    ready="$(gcloud run revisions list --service "$service" \
      --region "$REGION" --project "$PROJECT" \
      --sort-by='~metadata.creationTimestamp' \
      --filter='status.conditions.type=Ready AND status.conditions.status=True' \
      --format='value(metadata.name)')"
    seen=''
    while IFS= read -r rev; do
      [[ -z "$rev" ]] && continue
      if [[ -n "$seen" ]]; then
        target="$rev"
        break
      fi
      [[ "$rev" == "$serving" ]] && seen=1
    done <<<"$ready"
  fi

  if [[ -z "$target" ]]; then
    echo "no previous ready revision to roll $service back to (serving: $serving)" >&2
    echo "ready revisions:" >&2
    echo "${ready:-<none>}" >&2
    exit 1
  fi

  CHOSEN="$target"
  SERVING_NOW="$serving"
}

pin_target() {
  local service="$1"
  local serving="$2"
  local target="$3"
  echo "▸ $service: $serving → $target"
  gcloud run services update-traffic "$service" \
    --to-revisions "$target=100" \
    --region "$REGION" --project "$PROJECT" --quiet
}

# A rollback that lands on a broken revision is not a rollback.
smoke_service() {
  local service="$1"
  local url
  url="$(gcloud run services describe "$service" \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)')"
  "$(dirname "$0")/smoke.sh" "$url"
}

# The portal is the tenant audience only on the hosts that revision was given.
# The service's primary address can be a different name, so smoke those hosts.
smoke_portal_revision() {
  local revision="$1"
  local json hosts host
  json="$(gcloud run revisions describe "$revision" \
    --region "$REGION" --project "$PROJECT" --format=json)"
  hosts="$(printf '%s' "$json" | node -e '
    const doc = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const env = (((doc.spec || {}).containers || [])[0] || {}).env || [];
    const row = env.find((item) => item.name === "TENANT_HOST");
    process.stdout.write(row && row.value ? row.value : "");
  ')"
  if [[ -z "$hosts" ]]; then
    echo "revision $revision has no tenant host — cannot smoke the portal" >&2
    exit 1
  fi
  for host in ${hosts//,/ }; do
    "$(dirname "$0")/smoke.sh" --portal "https://${host}"
  done
}

if [[ "$ENV" == "prod" ]]; then
  choose_target "dona-prod" "$TARGET"
  pin_target "dona-prod" "$SERVING_NOW" "$CHOSEN"
  LANDED="$CHOSEN"
  smoke_service "dona-prod"
  cat <<MSG

▸ dona-prod is now serving $LANDED, and traffic is PINNED to it.
  The next tag deploy un-pins it automatically (release.yml ends with
  --to-latest). To roll forward by hand:

    gcloud run services update-traffic dona-prod --to-latest --region $REGION --project $PROJECT
MSG
  exit 0
fi

OFFICE="dona-staging"
PORTAL="dona-staging-portal"
OFFICE_TARGET=""
PORTAL_TARGET=""
if [[ -n "$TARGET" ]]; then
  if [[ "$TARGET" == "$PORTAL-"* ]]; then
    PORTAL_TARGET="$TARGET"
  else
    OFFICE_TARGET="$TARGET"
  fi
fi

# Choose both targets before either pin. A portal that cannot move must not
# leave the office already on its previous revision.
choose_target "$OFFICE" "$OFFICE_TARGET"
OFFICE_LANDED="$CHOSEN"
OFFICE_SERVING="$SERVING_NOW"

# A missing service is skipped. Any other failure (auth, project, region) still
# stops the rollback — skipping those would leave the portal on the new revision.
PORTAL_ERR="$(mktemp)"
if gcloud run services describe "$PORTAL" \
  --region "$REGION" --project "$PROJECT" \
  --format='value(metadata.name)' >/dev/null 2>"$PORTAL_ERR"; then
  choose_target "$PORTAL" "$PORTAL_TARGET"
  PORTAL_LANDED="$CHOSEN"
  PORTAL_SERVING="$SERVING_NOW"
elif [[ "$(cat "$PORTAL_ERR")" == *"Cannot find service"* || "$(cat "$PORTAL_ERR")" == *"NOT_FOUND"* ]]; then
  PORTAL_LANDED=""
  echo "▸ $PORTAL does not exist yet — skipped"
else
  cat "$PORTAL_ERR" >&2
  rm -f "$PORTAL_ERR"
  exit 1
fi
rm -f "$PORTAL_ERR"

pin_target "$OFFICE" "$OFFICE_SERVING" "$OFFICE_LANDED"
if [[ -n "$PORTAL_LANDED" ]]; then
  pin_target "$PORTAL" "$PORTAL_SERVING" "$PORTAL_LANDED"
fi
smoke_service "$OFFICE"
if [[ -n "$PORTAL_LANDED" ]]; then
  smoke_portal_revision "$PORTAL_LANDED"
fi

if [[ -n "$PORTAL_LANDED" ]]; then
  cat <<MSG

▸ $OFFICE is now serving $OFFICE_LANDED, and traffic is PINNED to it.
▸ $PORTAL is now serving $PORTAL_LANDED, and traffic is PINNED to it.
  The next staging deploy un-pins both (deploy.yml takes traffic to latest
  on each). To roll forward by hand:

    gcloud run services update-traffic $OFFICE --to-latest --region $REGION --project $PROJECT
    gcloud run services update-traffic $PORTAL --to-latest --region $REGION --project $PROJECT
MSG
else
  cat <<MSG

▸ $OFFICE is now serving $OFFICE_LANDED, and traffic is PINNED to it.
▸ $PORTAL was not rolled: it does not exist yet.
  The next staging deploy un-pins $OFFICE (deploy.yml takes traffic to latest).
  To roll forward by hand:

    gcloud run services update-traffic $OFFICE --to-latest --region $REGION --project $PROJECT
MSG
fi
