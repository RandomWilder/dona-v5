#!/usr/bin/env bash
# Provisions the tier-2 corpus bucket. Idempotent — safe to re-run, and re-runs
# are how a console click gets corrected.
#
#   ./infra/corpus-bucket.sh
#
# This is NOT gs://dona-v5-<env>-docs. That bucket belongs to the application
# (infra/bootstrap.sh): it is versioned so an overwrite of a signed contract is
# recoverable, and app-<env> can read and write it. This one is the opposite
# shape on purpose, because the two hold data with opposite obligations.
#
# What lives here: the real documents from Dona Dom (SPEC.md, "The corpus, in
# three tiers", tier 2). They measure OCR accuracy against scans, handwriting
# and signatures, and they do nothing else. They never enter the repository.
#
# Four properties, and each one is a decision:
#
#   dated name          The bucket carries the date it was created, so "remove
#                       the corpus" is one bucket and not a search of a project.
#                       It is also what keeps fuse F7 cheap: the GCP project is
#                       org-less, the move into an organisation must not happen
#                       while real tenant data is sitting in it, and deleting one
#                       named bucket is a one-line answer to that.
#   versioning OFF      A versioned bucket keeps the bytes after a delete. That
#                       is right for a contract and wrong for a corpus with a
#                       removal date: "permanently removed" would be false.
#   soft-delete 0       Same failure, one layer down and on by default. Cloud
#                       Storage retains deleted objects for a soft-delete window
#                       unless the window is zero, and an object recoverable for
#                       seven days has not been deleted.
#   lifecycle 90 days   The exposure has an end date from the day it starts,
#                       whether or not anybody remembers to run the delete.
#
# No service account is granted anything on it. The application never reads this
# bucket — which is stronger than binding a role per bucket, and it is why
# nothing in src/ knows this name.
set -euo pipefail

PROJECT="${PROJECT:-dona-v5}"
REGION="${REGION:-me-west1}"
# Overridable so the name can be re-derived when a second corpus lands under its
# own date, and so this script can be exercised without touching the real one.
BUCKET="${CORPUS_BUCKET:-dona-v5-corpus-2026-09-06}"
RETENTION_DAYS="${CORPUS_RETENTION_DAYS:-90}"

say() { printf '\n▸ %s\n' "$1"; }

say "Tier-2 corpus bucket gs://$BUCKET (project $PROJECT, region $REGION)"

gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT" >/dev/null 2>&1 ||
  gcloud storage buckets create "gs://$BUCKET" \
    --location="$REGION" \
    --uniform-bucket-level-access \
    --public-access-prevention \
    --project "$PROJECT"

# Re-applied on every run, not only at creation.
gcloud storage buckets update "gs://$BUCKET" \
  --uniform-bucket-level-access \
  --public-access-prevention \
  --no-versioning \
  --clear-soft-delete \
  --project "$PROJECT" >/dev/null

say "Lifecycle — delete at $RETENTION_DAYS days"
LIFECYCLE="$(mktemp)"
trap 'rm -f "$LIFECYCLE"' EXIT
cat >"$LIFECYCLE" <<JSON
{
  "rule": [
    {
      "action": { "type": "Delete" },
      "condition": { "age": $RETENTION_DAYS }
    }
  ]
}
JSON
gcloud storage buckets update "gs://$BUCKET" \
  --lifecycle-file="$LIFECYCLE" --project "$PROJECT" >/dev/null

# SPEC.md, Security defaults: every read of tenant data is logged, not only every
# command. The application-level line over the isolation join is slice 2.3's and
# cannot be honest before `party` exists. What is true today is that every read of
# a tier-2 object is logged — which is a Cloud Audit Logs data-access config, and
# it belongs beside the bucket it protects rather than in a document.
#
# The config is project-level (Cloud Storage has no per-bucket audit config), so
# it is applied read-modify-write and a re-run is a no-op. It also lights up the
# two docs buckets, which is a gain and not a side effect. Cost: data-access log
# volume is billed past the free tier — small at this project's size, and named
# here rather than discovered on a bill.
say "Audit logging — storage.googleapis.com DATA_READ + DATA_WRITE"
POLICY="$(mktemp)"
UPDATED="$(mktemp)"
trap 'rm -f "$LIFECYCLE" "$POLICY" "$UPDATED"' EXIT
gcloud projects get-iam-policy "$PROJECT" --format=json >"$POLICY"
STATE="$(python3 - "$POLICY" "$UPDATED" <<'PYEOF'
import json, sys

policy = json.load(open(sys.argv[1]))
configs = policy.setdefault('auditConfigs', [])
storage = next(
    (c for c in configs if c.get('service') == 'storage.googleapis.com'), None
)
if storage is None:
    storage = {'service': 'storage.googleapis.com', 'auditLogConfigs': []}
    configs.append(storage)
have = {c.get('logType') for c in storage.setdefault('auditLogConfigs', [])}
missing = sorted({'DATA_READ', 'DATA_WRITE'} - have)
storage['auditLogConfigs'].extend({'logType': one} for one in missing)
json.dump(policy, open(sys.argv[2], 'w'))
print('changed' if missing else 'unchanged')
PYEOF
)"
# Written back only when it would change something. A set-iam-policy that rewrites
# an identical policy still bumps the etag and still writes an admin audit entry,
# and "a re-run is a no-op" is a claim this slice has to be able to make by
# diffing rather than by asserting.
if [[ "$STATE" == changed ]]; then
  gcloud projects set-iam-policy "$PROJECT" "$UPDATED" --format=none >/dev/null
  echo "  storage audit config: added"
else
  echo "  storage audit config: already present"
fi

say "Done"
echo "  bucket:     gs://$BUCKET"
echo "  retention:  $RETENTION_DAYS days, by lifecycle rule"
echo "  deletion:   ./infra/corpus-delete.sh <object|--all>"
echo "  record the arrival and removal dates on tasks/fuses.md the day the corpus lands"
