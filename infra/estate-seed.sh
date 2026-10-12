#!/usr/bin/env bash
# Seeds one building on staging from a building plan file on this laptop.
#
#   ./infra/estate-seed.sh staging ~/dona-buildings/ramle-103.json
#   ./infra/estate-seed.sh staging ~/dona-buildings/ramle-103.json --update
#
# The file is the director's working file and is never stored by the system: it travels gzipped and
# base64-encoded as the argument of a one-off job (infra/run-job.sh, which deletes the job), so the
# database credential stays inside the perimeter. The list job runs first and writes nothing; the
# apply job runs only after a y on this laptop. Prod is refused, here and inside the job.
# SPEC-estate.md, "Seeding a building from a developer sheet".
set -euo pipefail

ENV="${1:-}"
FILE="${2:-}"
shift 2 2>/dev/null || true

usage() {
  echo "usage: $0 staging <plan.json> [--update]" >&2
  exit 2
}

[[ "$ENV" == "staging" ]] || usage
[[ -n "$FILE" && -f "$FILE" ]] || usage
UPDATE=()
for arg in "$@"; do
  case "$arg" in
  --update) UPDATE=(--update) ;;
  *) usage ;;
  esac
done

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD="$(gzip -c "$FILE" | base64 | tr -d '\n')"

# A job argument is not a file upload. 32 KB of gzip is a building several times Ramle 103's size;
# past that, split the file rather than find the limit by failing.
if [[ "${#PAYLOAD}" -gt 32768 ]]; then
  echo "refusing: $FILE is ${#PAYLOAD} bytes encoded, over the 32768 a job argument carries here" >&2
  exit 2
fi

"$HERE/run-job.sh" "$ENV" estate-seed src/estate-seed.ts list --plan-b64 "$PAYLOAD" ${UPDATE[@]+"${UPDATE[@]}"}

printf 'Seed this building on staging? [y/N] '
read -r ANSWER
case "$ANSWER" in
y | Y | yes | YES) ;;
*)
  echo "✖ not confirmed — nothing was written"
  exit 1
  ;;
esac

"$HERE/run-job.sh" "$ENV" estate-seed src/estate-seed.ts apply --plan-b64 "$PAYLOAD" ${UPDATE[@]+"${UPDATE[@]}"}
