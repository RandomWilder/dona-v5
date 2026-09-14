#!/usr/bin/env bash
# Applies the document-type catalogue to a *deployed* environment.
#
#   ./infra/seed-doctypes.sh staging
#
# Locally this is `npm run seed:doctypes` and nothing more. It is in no workflow,
# on purpose (AGENTS.md): the catalogue is data, a deploy is code, and a deploy
# that quietly rewrote the catalogue would make a field declaration impossible to
# date. So it is run deliberately, by a person, and the run is recorded.
#
# Slice 6.7 is the run that made this file necessary. The two identifier fields
# 6.4 added are seed rows, so staging's `lease` type declared no ת.ז. at all and
# the second half of the week's demo -- one party, two tenancies, matched on an
# identifier -- would have read as broken rather than as unseeded.
#
# The catalogue apply is idempotent and never deletes: types and fields are
# upserted by code, and a field that is gone from the catalogue is deactivated
# rather than dropped. Running it twice is a no-op that prints zeros, which is
# what makes it safe to run against an environment that is serving.
set -euo pipefail

ENV="${1:-}"
case "$ENV" in
staging | prod) ;;
*)
  echo "usage: $0 <staging|prod>" >&2
  exit 2
  ;;
esac

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
"$HERE/run-job.sh" "$ENV" seed-doctypes src/seed-doctypes.ts

printf '\n▸ Applied\n'
echo "  environment: $ENV"
echo
echo "The counts the job printed are the record -- 'created' on a first run and"
echo "'updated' on every one after it. A field's effective_from is what dates a"
echo "declaration, not the day this was run."
