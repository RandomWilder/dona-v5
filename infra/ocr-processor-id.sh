#!/usr/bin/env bash
# Prints the Document AI OCR processor id for one environment (staging|prod),
# or nothing if it has not been created yet. Look-up only — bootstrap.sh creates.
#
# The gcloud documentai surface is a component the default SDK does not ship,
# so this talks to the same REST host the adapter uses.
set -euo pipefail

ENV="${1:-}"
case "$ENV" in
staging | prod) ;;
*)
  echo "usage: $0 <staging|prod>" >&2
  exit 2
  ;;
esac

PROJECT="${PROJECT:-dona-v5}"
LOCATION="${DOCUMENT_AI_LOCATION:-eu}"
DISPLAY="dona-ocr-$ENV"
TOKEN="$(gcloud auth print-access-token)"
HOST="https://${LOCATION}-documentai.googleapis.com"

curl -sS -H "Authorization: Bearer ${TOKEN}" \
  "${HOST}/v1/projects/${PROJECT}/locations/${LOCATION}/processors" |
  python3 -c "
import json, sys
wanted = sys.argv[1]
body = json.load(sys.stdin)
if 'error' in body:
    sys.exit(0)
for processor in body.get('processors', []):
    if processor.get('displayName') == wanted:
        name = processor.get('name') or ''
        print(name.rsplit('/', 1)[-1])
        break
" "$DISPLAY"
