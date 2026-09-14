#!/usr/bin/env bash
# Adds an operator to a *deployed* environment, or moves an existing one's role.
#
#   ./infra/staff-add.sh staging asaf@example.com ADMIN
#   ./infra/staff-add.sh prod    someone@example.com OPERATOR
#
# Locally this is `npm run staff:add -- <email> <ROLE>` and nothing more, because
# a laptop can reach the local database. A deployed environment cannot be reached
# that way, deliberately, and `run-job.sh` carries the argument and the flags that
# follow from it -- this file held both until slice 6.7 needed a second job of the
# same shape.
#
# The email and the role ARE arguments, unlike anything in set-secret.sh. That is
# not an exception to ADR-0003: the rule is that a credential value never lands in
# argv, in shell history or in a process listing, and this row carries no
# credential at all -- the credential is Google's (ADR-0005). An operator's
# address is not a secret; it is the allowlist entry that makes a sign-in possible.
set -euo pipefail

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

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
"$HERE/run-job.sh" "$ENV" staff-add src/staff-add.ts "$EMAIL" "$ROLE"

printf '\n▸ Added\n'
echo "  environment: $ENV"
echo "  operator:    $EMAIL · $ROLE"
echo
echo "The row is the whole authorisation. Nothing has to reach that address: they"
echo "sign in with Google at the environment's /staff/login, and the account is"
echo "linked to their Google subject on first sign-in."
