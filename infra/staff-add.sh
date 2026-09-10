#!/usr/bin/env bash
# Adds an operator to a *deployed* environment, or moves an existing one's role.
#
#   ./infra/staff-add.sh staging asaf@example.com ADMIN
#   ./infra/staff-add.sh prod    someone@example.com OPERATOR
#
# Locally this is `npm run staff:add -- <email> <ROLE>` and nothing more, because
# a laptop can reach the local database. A deployed environment cannot be reached
# that way, deliberately: DATABASE_URL is a unix-socket connection string held in
# Secret Manager and readable only by that environment's runtime service account,
# so pointing the local script at staging would mean pulling the credential out of
# the perimeter first. Slice 1.6 argued that trade away for migrations and the
# same argument holds here.
#
# So the script runs the *same* `src/staff-add.ts`, unchanged, as a one-off Cloud
# Run job: the image the environment is serving, its runtime service account, the
# database URL mounted rather than read. This is flag for flag the shape
# .github/workflows/deploy.yml already uses for migrations.
#
# The email and the role ARE arguments, unlike anything in set-secret.sh. That is
# not an exception to ADR-0003: the rule is that a credential value never lands in
# argv, in shell history or in a process listing, and this row carries no
# credential at all -- the credential is Google's (ADR-0005). An operator's
# address is not a secret; it is the allowlist entry that makes a sign-in possible.
#
# The job is deleted when the run finishes. Anyone who could run it could already
# read the database secret directly, so it grants no privilege that was not there
# -- but a permanently named button that writes an ADMIN row is worth the two
# seconds it costs to remove. Migrations keep their job because the deploy
# recreates it on every merge and the ledger makes re-running it a no-op.
set -euo pipefail

PROJECT="${PROJECT:-dona-v5}"
REGION="${REGION:-me-west1}"
IMAGE="${IMAGE:-me-west1-docker.pkg.dev/$PROJECT/dona/app}"

ENV="${1:-}"
EMAIL="${2:-}"
ROLE="${3:-}"

usage() {
  echo "usage: $0 <staging|prod> <email> <ADMIN|OPERATOR|VIEWER>" >&2
  echo "example: $0 staging asaf@example.com ADMIN" >&2
  exit 2
}

case "$ENV" in
staging | prod) ;;
*) usage ;;
esac
# A bad address or role should fail here, in a second, rather than after a job
# has been built and scheduled. src/staff-add.ts checks both again anyway -- it is
# the one that has to be right when it is run by hand.
[[ "$EMAIL" == *@*.* ]] || usage
case "$ROLE" in
ADMIN | OPERATOR | VIEWER) ;;
*) usage ;;
esac

JOB="dona-$ENV-staff-add"
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
  --args "src/staff-add.ts,$EMAIL,$ROLE" \
  --max-retries 0 \
  --task-timeout 5m \
  --execute-now \
  --wait \
  --quiet || STATUS=$?

# Always attempt the removal, whether the row was written or not: a failed run
# leaves the same standing button as a successful one.
say "Removing the job"
gcloud run jobs delete "$JOB" --region "$REGION" --project "$PROJECT" --quiet 2>/dev/null ||
  echo "  WARNING: $JOB is still there -- remove it by hand" >&2

if [[ "$STATUS" -ne 0 ]]; then
  echo "staff-add failed -- the job's own output is above, and its logs are in Cloud Logging" >&2
  exit "$STATUS"
fi

say "Added"
echo "  environment: $ENV"
echo "  operator:    $EMAIL · $ROLE"
echo
echo "The row is the whole authorisation. Nothing has to reach that address: they"
echo "sign in with Google at the environment's /staff/login, and the account is"
echo "linked to their Google subject on first sign-in."
