#!/usr/bin/env bash
# Runs one of this repository's own scripts against a *deployed* environment, as
# a one-off Cloud Run job, and removes the job afterwards.
#
#   ./infra/run-job.sh staging staff-add src/staff-add.ts someone@example.com ADMIN
#   ./infra/run-job.sh staging seed-doctypes src/seed-doctypes.ts
#
# Why a job at all, rather than pointing the local script at staging: DATABASE_URL
# is a unix-socket connection string held in Secret Manager and readable only by
# that environment's runtime service account, so reaching it from a laptop would
# mean pulling the credential out of the perimeter first. Slice 1.6 argued that
# trade away for migrations and the same argument holds for every script here.
# The job runs the *same* code, unchanged: the image the environment is serving,
# its runtime service account, the database URL mounted rather than read.
#
# This file exists because slice 6.7 needed a second job of exactly this shape and
# `staff-add.sh` already held the first. A second literal copy of the
# secret-mounting flags is the thing that drifts, and it drifts silently, because
# both copies go on working while they disagree. So the flags are written once
# here and the callers are thin: they validate their own arguments -- which must
# fail in a second, before a job is built and scheduled -- and delegate.
#
# The job is removed when the run finishes, pass or fail. Anyone who could run it
# could already read the database secret directly, so it grants no privilege that
# was not there -- but a permanently named button that writes to a deployed
# database is worth the two seconds it costs to take away. Migrations keep their
# job because the deploy recreates it on every merge and the ledger makes
# re-running it a no-op.
set -euo pipefail

PROJECT="${PROJECT:-dona-v5}"
REGION="${REGION:-me-west1}"
IMAGE="${IMAGE:-me-west1-docker.pkg.dev/$PROJECT/dona/app}"

ENV="${1:-}"
SUFFIX="${2:-}"
shift 2 2>/dev/null || true

usage() {
  echo "usage: $0 <staging|prod> <job-suffix> <script.ts> [arg ...]" >&2
  echo "example: $0 staging seed-doctypes src/seed-doctypes.ts" >&2
  exit 2
}

case "$ENV" in
staging | prod) ;;
*) usage ;;
esac
[[ -n "$SUFFIX" ]] || usage
[[ "$#" -ge 1 ]] || usage

# gcloud splits --args on commas, so an argument carrying one would silently
# become two. No caller needs it; refusing is cheaper than a quoting rule nobody
# reads.
for arg in "$@"; do
  if [[ "$arg" == *,* ]]; then
    echo "$0: argument contains a comma, which --args would split: $arg" >&2
    exit 2
  fi
done
ARGS="$(
  IFS=,
  echo "$*"
)"

JOB="dona-$ENV-$SUFFIX"
RUNTIME_EMAIL="app-$ENV@$PROJECT.iam.gserviceaccount.com"

say() { printf '\n▸ %s\n' "$1"; }

say "Running $JOB on $IMAGE:$ENV"
STATUS=0
gcloud run jobs deploy "$JOB" \
  --image "$IMAGE:$ENV" \
  --region "$REGION" \
  --project "$PROJECT" \
  --service-account "$RUNTIME_EMAIL" \
  --set-cloudsql-instances "$PROJECT:$REGION:dona-$ENV" \
  --set-secrets "DATABASE_URL=$ENV-database-url:latest" \
  --command node \
  --args "$ARGS" \
  --max-retries 0 \
  --task-timeout 5m \
  --execute-now \
  --wait \
  --quiet || STATUS=$?

# What the script itself printed is the record -- `created 2, updated 20` is the
# sentence that says staging declared no identifier before this run, and
# `Done.` is not. gcloud does not stream a job's task output, so it is read back
# from Cloud Logging here rather than left to a second command nobody runs.
# Ingestion lags the exit by a few seconds, so this retries; it never fails the
# run, because a missing log line is a reporting problem and the write already
# happened either way.
EXECUTION="$(
  gcloud run jobs executions list \
    --job "$JOB" --region "$REGION" --project "$PROJECT" \
    --limit 1 --sort-by='~createTime' --format='value(name)' 2>/dev/null || true
)"
if [[ -n "$EXECUTION" ]]; then
  say "Job output — execution $EXECUTION"
  for attempt in 1 2 3; do
    OUTPUT="$(
      gcloud logging read \
        "resource.type=\"cloud_run_job\" labels.\"run.googleapis.com/execution_name\"=\"$EXECUTION\"" \
        --project "$PROJECT" --limit 50 --freshness=1h \
        --format='value(textPayload)' 2>/dev/null || true
    )"
    [[ -n "$OUTPUT" ]] && break
    sleep 5
  done
  if [[ -n "${OUTPUT:-}" ]]; then
    # Logging returns newest first; the job printed oldest first. `tail -r` is
    # BSD's and `tac` is GNU's, so neither is written here.
    echo "$OUTPUT" | awk '{ line[NR] = $0 } END { for (i = NR; i > 0; i--) print line[i] }'
  else
    echo "  no log lines yet — gcloud logging read ... execution_name=\"$EXECUTION\"" >&2
  fi
fi

# Always attempt the removal, whether the run succeeded or not: a failed run
# leaves the same standing button as a successful one.
say "Removing the job"
gcloud run jobs delete "$JOB" --region "$REGION" --project "$PROJECT" --quiet 2>/dev/null ||
  echo "  WARNING: $JOB is still there -- remove it by hand" >&2

if [[ "$STATUS" -ne 0 ]]; then
  echo "$JOB failed -- the job's own output is above, and its logs are in Cloud Logging" >&2
  exit "$STATUS"
fi
