#!/usr/bin/env bash
# Permanently removes a tier-2 document, or the whole corpus. This is the
# documented command slice 1.12's acceptance bar names, and it has been run.
#
#   ./infra/corpus-delete.sh lease-0417.pdf     one named document
#   ./infra/corpus-delete.sh --all              the whole corpus, on its removal date
#
# Three things make it a deletion path rather than a delete:
#
#   1. It refuses any bucket that is not the corpus bucket. The application's
#      gs://dona-v5-<env>-docs holds signed contracts and is versioned precisely
#      so a delete is recoverable; pointing this script at it would be the one
#      mistake it must be impossible to make in a hurry.
#   2. It verifies afterwards, and the verification includes the soft-deleted
#      listing. Cloud Storage keeps deleted objects for a soft-delete window by
#      default, and an object recoverable for seven days has not been deleted.
#      infra/corpus-bucket.sh sets that window to zero; this script is what
#      proves it took.
#   3. It exits non-zero if anything is still there. The proof is the exit code,
#      not a listing somebody read — the same standing infra/rollback.sh gets
#      from ending in infra/smoke.sh.
#
# Record the removal on tasks/fuses.md the day it is run.
set -euo pipefail

PROJECT="${PROJECT:-dona-v5}"
BUCKET="${CORPUS_BUCKET:-dona-v5-corpus-2026-09-06}"

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "usage: $0 <object-name|--all>" >&2
  exit 2
fi

# The refusal, before anything else runs. A corpus bucket is named for what it
# is and when it was created; nothing else may be handed to this script, however
# the name arrived in the argument list.
case "$BUCKET" in
dona-v5-corpus-*) ;;
*)
  echo "refusing: $BUCKET is not a corpus bucket. This script deletes permanently." >&2
  exit 2
  ;;
esac

if [[ "$TARGET" == "--all" ]]; then
  PREFIX="gs://$BUCKET/**"
  WHAT="the whole corpus in gs://$BUCKET"
else
  PREFIX="gs://$BUCKET/$TARGET"
  WHAT="gs://$BUCKET/$TARGET"
fi

echo "▸ Deleting $WHAT"
# `|| true` on the delete alone: an object that is already absent is the outcome
# this script exists to produce, and the verification below is what decides
# whether it holds. A missing object must not be an error; a surviving one must.
gcloud storage rm --recursive "$PREFIX" --project "$PROJECT" 2>/dev/null || true

echo "▸ Verifying"
# Listing a bucket that holds nothing is an error in gcloud, and so is asking a
# bucket with no soft-delete policy for its soft-deleted versions -- and both of
# those are the outcome this script wants. Every *other* failure is not, and a
# `|| true` that flattens all three would report "permanently removed" for an
# expired credential. So the two benign messages are named, and anything else
# fails the script closed.
listing() {
  local out rc
  out="$(gcloud storage ls "$@" --project "$PROJECT" 2>&1)" && rc=0 || rc=$?
  if [[ $rc -eq 0 ]]; then
    printf '%s' "$out"
    return 0
  fi
  case "$out" in
  *"matched no objects"*) return 0 ;;
  # Set to zero by infra/corpus-bucket.sh. A bucket that keeps nothing cannot be
  # asked what it kept, and that refusal is the control working.
  *"Soft delete policy is required"*) return 0 ;;
  *)
    echo "  could not verify the listing -- refusing to report a deletion:" >&2
    echo "$out" >&2
    return 3
    ;;
  esac
}

LIVE="$(listing "$PREFIX")" || exit 1
SOFT="$(listing "$PREFIX" --soft-deleted)" || exit 1

FAILED=0
if [[ -n "$LIVE" ]]; then
  echo "  STILL LIVE:" >&2
  echo "$LIVE" >&2
  FAILED=1
fi
if [[ -n "$SOFT" ]]; then
  # The failure this check exists for: the object is gone from every listing a
  # person would look at, and Cloud Storage will restore it on request.
  echo "  STILL RECOVERABLE (soft-deleted, not deleted):" >&2
  echo "$SOFT" >&2
  echo "  fix the bucket first: ./infra/corpus-bucket.sh" >&2
  FAILED=1
fi

if [[ "$FAILED" == 1 ]]; then
  echo "✖ $WHAT was NOT permanently removed" >&2
  exit 1
fi

echo "✔ $WHAT is permanently removed — absent from the live and the soft-deleted listings"
echo "  record the date on tasks/fuses.md"
