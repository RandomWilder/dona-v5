#!/usr/bin/env bash
# Resets staging to an empty system: every data row, then every object in the docs bucket.
#
#   npm run staging:reset                  asks y/N, then resets and verifies
#   npm run staging:reset -- --yes         no prompt
#   npm run staging:reset -- --dry-run     per-table counts, writes nothing
#
# Made on 12 Oct 2026, when staging's mock buildings and leases gave way to the three pilot
# projects' real data, and meant to be run again whenever staging needs a clean start. It is one
# command because staging is a dev environment. The guard that matters is inside the job: it refuses
# any DATABASE_URL that does not name dona-staging, so this command cannot reach prod, whatever the
# flags. What survives (the migration ledger, settings, the catalogues, the staff accounts) and why
# is in src/staging-reset-plan.ts.
#
# One job does the before-count, the truncate and the after-check in one transaction, and prints
# all three. A wiped table that is not at zero rolls the whole thing back. The bucket is emptied
# afterwards by infra/docs-delete.sh, which verifies the listing itself. Deleted objects stay
# restorable for seven days through the bucket's soft-delete, by design.
#
# Cloud Logging is not touched. Logs age out under the project's retention.
set -euo pipefail

YES=0
DRY=0
for arg in "$@"; do
  case "$arg" in
  --yes) YES=1 ;;
  --dry-run) DRY=1 ;;
  *)
    echo "usage: $0 [--yes|--dry-run]" >&2
    exit 2
    ;;
  esac
done

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BUCKET="dona-v5-staging-docs"

if [[ "$DRY" -eq 1 ]]; then
  "$HERE/run-job.sh" staging staging-reset src/staging-reset.ts list
  exit 0
fi

if [[ "$YES" -ne 1 ]]; then
  printf 'Empty staging: every data row and gs://%s. Staff and catalogues stay. [y/N] ' "$BUCKET"
  read -r ANSWER
  case "$ANSWER" in
  y | Y | yes | YES) ;;
  *)
    echo "✖ not confirmed — nothing was removed" >&2
    exit 1
    ;;
  esac
fi

"$HERE/run-job.sh" staging staging-reset src/staging-reset.ts apply

echo
echo "▸ Rows are gone. Now the bytes."
ENV=staging CONFIRM_BUCKET="$BUCKET" "$HERE/docs-delete.sh" --all

echo
echo "✔ staging is empty — wipe tables at 0 (job output above), bucket cleared"
