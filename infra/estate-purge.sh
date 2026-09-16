#!/usr/bin/env bash
# Lists or applies an operator purge of one Building or one Unit on staging.
# Screens still have no delete. Prod is refused.
#
#   ./infra/estate-purge.sh staging list --address "הרב קוק" --city "כפר סבא"
#   ./infra/estate-purge.sh staging apply --building <id>
#
# List is a job that writes nothing. Apply prints the list, asks y/n here on the
# laptop, then runs the apply job. Bytes are a second step: the job prints
# prefixes for ./infra/docs-delete.sh.
set -euo pipefail

ENV="${1:-}"
MODE="${2:-}"
shift 2 2>/dev/null || true

usage() {
  echo "usage: $0 staging list --address <street> [--city <city>]" >&2
  echo "       $0 staging list --building <id>|--unit <id>" >&2
  echo "       $0 staging apply --building <id>|--unit <id>" >&2
  exit 2
}

[[ "$ENV" == "staging" ]] || usage
case "$MODE" in
list | apply) ;;
*) usage ;;
esac

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$MODE" == "list" ]]; then
  "$HERE/run-job.sh" "$ENV" estate-purge src/estate-purge.ts list "$@"
  exit 0
fi

echo "▸ Listing what apply would remove"
"$HERE/run-job.sh" "$ENV" estate-purge src/estate-purge.ts list "$@"
printf 'Purge the listed place on staging? [y/n] '
read -r ANSWER
case "$ANSWER" in
y | Y | yes | YES) ;;
*)
  echo "✖ not confirmed — nothing was removed"
  exit 1
  ;;
esac

"$HERE/run-job.sh" "$ENV" estate-purge src/estate-purge.ts apply --yes "$@"
echo
echo "Rows are gone. If prefixes printed above, clear bytes with:"
echo "  ./infra/docs-delete.sh <prefix>"
echo "  (type the staging docs bucket to confirm)"
