#!/usr/bin/env bash
# Clears mock documents out of a non-production docs bucket. Slice 3.3.
#
#   ./infra/docs-delete.sh --all                     everything in gs://dona-v5-staging-docs
#   ./infra/docs-delete.sh unit/019a…/lease/         one flat's leases
#
# **This is the half slice 3.2 deliberately left to a human.** The application has no `delete` on its
# object port and the runtime account has no `objectAdmin`, and both of those stay true: a signed
# contract is not something the software may destroy. What was never in question is whether a person
# with owner credentials can — 3.2's staging verification proved they can, by removing the probe
# object by hand. This script is that act written down, so clearing a staging bucket full of tier-1
# specimens is one reviewed command rather than an improvised one.
#
# **It is the inverse of infra/corpus-delete.sh and asserts the opposite thing**, which is worth
# stating because the two files look alike. That script exists to prove a tier-2 document is gone
# *permanently*, so it fails if anything is still recoverable and the corpus bucket's soft-delete
# window is zeroed to make that reachable. Here the seven-day window is a control chosen on purpose
# (3.2), and a script that cleared mock data by widening the blast radius on a bucket that will one
# day hold real contracts would be trading a control for tidiness. So this one removes the live
# objects and their noncurrent versions, leaves the window alone, and *reports* what is still
# recoverable instead of failing on it.
#
# Three refusals, before anything runs:
#
#   1. The bucket must be a docs bucket, by name.
#   2. It must not be prod. Nothing in this repository deletes from gs://dona-v5-prod-docs, and the
#      day that is genuinely needed it should be an act somebody performs with their own hands and
#      their own reason, not a flag on a script that already existed.
#   3. It asks, and the answer has to be the bucket's own name. A y/n on a destructive command is a
#      reflex; typing the bucket is reading it.
set -euo pipefail

PROJECT="${PROJECT:-dona-v5}"
ENV="${ENV:-staging}"
BUCKET="${DOCS_BUCKET:-$PROJECT-$ENV-docs}"

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "usage: $0 <path-prefix|--all>" >&2
  echo "       ENV=staging by default; DOCS_BUCKET overrides the whole name" >&2
  exit 2
fi

case "$BUCKET" in
*-prod-docs)
  echo "refusing: $BUCKET is the production document store." >&2
  echo "  This script does not delete real tenant documents, with any flag." >&2
  exit 2
  ;;
"$PROJECT"-*-docs) ;;
*)
  echo "refusing: $BUCKET is not a $PROJECT docs bucket." >&2
  exit 2
  ;;
esac

if [[ "$TARGET" == "--all" ]]; then
  PREFIX="gs://$BUCKET/**"
  WHAT="everything in gs://$BUCKET"
else
  PREFIX="gs://$BUCKET/${TARGET%/}/**"
  WHAT="gs://$BUCKET/${TARGET%/}/"
fi

echo "▸ About to remove $WHAT"
echo "  live objects and every noncurrent version, in $PROJECT."
echo "  The bucket's seven-day soft-delete window is NOT touched — what this removes"
echo "  stays restorable by a human for seven days, which is the control working."
echo
printf 'Type the bucket name to confirm: '
read -r ANSWER
if [[ "$ANSWER" != "$BUCKET" ]]; then
  echo "✖ not confirmed — nothing was removed" >&2
  exit 1
fi

echo "▸ Removing"
# `|| true` on the delete alone, for corpus-delete.sh's reason: an object that is already absent is
# the outcome this script exists to produce, and the listing below is what decides whether it holds.
gcloud storage rm --recursive --all-versions "$PREFIX" --project "$PROJECT" 2>/dev/null || true

echo "▸ Verifying"
listing() {
  local out rc
  out="$(gcloud storage ls --recursive "$@" --project "$PROJECT" 2>&1)" && rc=0 || rc=$?
  if [[ $rc -eq 0 ]]; then
    printf '%s' "$out"
    return 0
  fi
  case "$out" in
  # An empty bucket is an error in gcloud, and it is the outcome wanted here. Every other failure is
  # not: a `|| true` covering all of them would report a clean bucket for an expired credential.
  *"matched no objects"*) return 0 ;;
  *)
    echo "  could not verify the listing — refusing to report a deletion:" >&2
    echo "$out" >&2
    return 3
    ;;
  esac
}

LIVE="$(listing "$PREFIX" --all-versions)" || exit 1
if [[ -n "$LIVE" ]]; then
  echo "  STILL PRESENT:" >&2
  echo "$LIVE" >&2
  echo "✖ $WHAT was not cleared" >&2
  exit 1
fi

SOFT="$(listing "$PREFIX" --soft-deleted)" || exit 1
echo "✔ $WHAT is cleared — no live object and no noncurrent version remains"
if [[ -n "$SOFT" ]]; then
  # Said out loud rather than treated as a failure. This is the difference between this script and
  # corpus-delete.sh, and a reader who confuses the two would draw the wrong conclusion from silence.
  echo "  Still restorable for seven days by a human, by design:"
  echo "$SOFT" | sed 's/^/    /'
fi
