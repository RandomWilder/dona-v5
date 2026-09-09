#!/usr/bin/env bash
# Provisions one environment on GCP. Idempotent — safe to re-run.
# Infrastructure lives here rather than in console clicks so it is reproducible.
#
#   ./infra/bootstrap.sh staging
#   ./infra/bootstrap.sh prod
#
# staging and prod are the same shape, deliberately: separate Cloud SQL
# instance, separate secret, separate document bucket, separate runtime and
# deploy identities, nothing shared but the image registry and the Workload
# Identity pool. Why prod does not share staging's instance:
# docs/decisions/ADR-0001-prod-database-isolation.md
#
# The Cloud Run service itself is created by the first deploy, not here.
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
REGION="${REGION:-me-west1}"
GITHUB_REPO="${GITHUB_REPO:-RandomWilder/dona-v5}"

REPO=dona
SQL_INSTANCE="dona-$ENV"
DB_NAME=dona
DB_USER=dona
SECRET="$ENV-database-url"
# v3 also created four staff seed secrets here -- a first operator and a
# read-only viewer, email and password each. Slice 1.5 does not: v5 has no
# src/staff/ and no seeding code, and the auth gap v5 must close is Identity
# Platform with enforced MFA (docs/from-v3.md, Tier 2), so v3's email+password
# pair may never be built at all. A generated credential sitting in Secret
# Manager that nothing reads and no rotation flow owns is worse than an absent
# one. The slice that builds staff auth creates what its own mechanism needs.

# Slice 12.2. Not created here and deliberately: bootstrap generates the
# passwords it owns, and this one is a third party's -- it arrives through
# infra/set-secret.sh, which is the single way a credential enters this system.
# What bootstrap owns is the *grant*, so a re-run cannot leave the runtime
# account able to reach a key it is supposed to read, or able to reach one it
# is not.
OPENAI_SECRET="$ENV-openai-api-key"

# Slice 5.1, and this is what discharges 1.5's deliberate omission above. That
# comment says the slice that builds staff auth creates exactly what its own
# mechanism needs -- so what arrives here is one API key and no seeded
# operator. The first operator is invited by a human who can already reach the
# database (`npm run staff:invite`), which is why there is still no credential
# in this file that nothing reads.
IDENTITY_SECRET="$ENV-identity-api-key"
IDENTITY_KEY_ID="dona-identity-$ENV"
DOCS_BUCKET="$PROJECT-$ENV-docs"
RUNTIME_SA="app-$ENV"
DEPLOY_SA="deploy-$ENV"
POOL=github-pool
PROVIDER=github-provider

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
RUNTIME_EMAIL="$RUNTIME_SA@$PROJECT.iam.gserviceaccount.com"
DEPLOY_EMAIL="$DEPLOY_SA@$PROJECT.iam.gserviceaccount.com"
CONNECTION_NAME="$PROJECT:$REGION:$SQL_INSTANCE"

say() { printf '\n▸ %s\n' "$1"; }

say "Environment: $ENV (project $PROJECT, region $REGION)"

# R8 says this project is created under an organisation. It is not, and no
# organisation exists to create it under (slice 1.5, fuse F7). Checked on every
# run rather than recorded once, because the ordering it protects is absolute
# and easy to lose: an @donadom.co.il -- or any destination-domain -- identity
# must exist BEFORE the move, or constraints/iam.allowedPolicyMemberDomains
# locks the current gmail.com owner out of the project; and the move must
# happen BEFORE real tenant data lands, so it stays an admin task rather than a
# data-custody event (docs/from-v3.md). Not fatal: nothing in week 1 is blocked
# by it, and a project move preserves project id, resources, data and IAM
# whenever it happens.
PROJECT_PARENT="$(gcloud projects describe "$PROJECT" --format='value(parent.id)')"
if [[ -z "$PROJECT_PARENT" ]]; then
  printf '\n  !! %s has no organisation. R8 is not satisfied -- see fuse F7.\n' "$PROJECT"
  printf '     Move it before real tenant data lands, and not before an identity\n'
  printf '     on the destination domain exists.\n'
else
  echo "  organisation/folder: $PROJECT_PARENT"
fi

say "Enabling APIs"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  documentai.googleapis.com \
  identitytoolkit.googleapis.com \
  apikeys.googleapis.com \
  --project "$PROJECT"

say "Artifact Registry (shared by both environments)"
gcloud artifacts repositories describe "$REPO" \
  --location "$REGION" --project "$PROJECT" >/dev/null 2>&1 ||
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker \
    --location "$REGION" \
    --description="dona-v5 container images" \
    --project "$PROJECT"

# Prod keeps backups; staging is disposable and does not pay for them.
BACKUP_FLAGS=(--no-backup)
if [[ "$ENV" == prod ]]; then
  # 02:00 UTC ≈ 05:00 Israel — off-peak for a Tel Aviv tenancy product.
  # Point-in-time recovery is deliberately not enabled yet. Re-homed to week 12
  # on 9 Sep 2026 at the weeks-5-8 decomposition: it said "week 6", and week 6
  # is the policy module. Prod answers 503 by design until the first pilot tag,
  # so PITR bought in week 6 pays to recover an empty database. It belongs
  # beside the prod restart, before the first tag that reaches real tenants.
  BACKUP_FLAGS=(
    --backup
    --backup-start-time=02:00
    --retained-backups-count=7
    --maintenance-window-day=SUN
    --maintenance-window-hour=3
  )
fi

# --edition=ENTERPRISE is required: me-west1 defaults new instances to
# ENTERPRISE_PLUS, which rejects shared-core tiers like db-f1-micro.
say "Cloud SQL $SQL_INSTANCE (first run takes several minutes)"
gcloud sql instances describe "$SQL_INSTANCE" --project "$PROJECT" >/dev/null 2>&1 ||
  gcloud sql instances create "$SQL_INSTANCE" \
    --database-version=POSTGRES_16 \
    --edition=ENTERPRISE \
    --tier=db-f1-micro \
    --region="$REGION" \
    --storage-size=10GB \
    --storage-type=SSD \
    --availability-type=zonal \
    "${BACKUP_FLAGS[@]}" \
    --project "$PROJECT"

# A STOPPED instance answers "Invalid request since instance is not running" to
# both `databases describe` and `databases create`, so the describe-or-create
# pair below fails outright rather than being a no-op -- and `set -e` then kills
# the whole run before the service accounts, the bucket and the WIF binding,
# every one of which works perfectly well against a stopped instance.
#
# Found at slice 3.2, and it is 1.5's own cost lever biting: 1.5 stopped
# dona-prod until week 12 (--activation-policy=NEVER) because prod has nothing to
# serve and nobody to serve it, which quietly made the script's headline claim --
# "Idempotent -- safe to re-run" -- false for prod for as long as that saving
# lasts. The version that discovers this is the version that needed to reapply a
# bucket control to prod and could not.
#
# So the state is checked rather than inferred from an error, and a stopped
# instance skips the database step LOUDLY and lets the rest of the run finish.
# Skipping quietly would be the worse failure: the database step is the one that
# creates something, and "it was already there" and "we never looked" must not
# print the same way.
SQL_STATE="$(gcloud sql instances describe "$SQL_INSTANCE" \
  --project "$PROJECT" --format='value(state)')"
if [[ "$SQL_STATE" != RUNNABLE ]]; then
  echo "  !! $SQL_INSTANCE is $SQL_STATE, not RUNNABLE — skipping the database step."
  echo "     Everything after this point does not need the instance. To finish it:"
  echo "     gcloud sql instances patch $SQL_INSTANCE --activation-policy=ALWAYS --project $PROJECT"
else
  gcloud sql databases describe "$DB_NAME" \
    --instance "$SQL_INSTANCE" --project "$PROJECT" >/dev/null 2>&1 ||
    gcloud sql databases create "$DB_NAME" \
      --instance "$SQL_INSTANCE" --project "$PROJECT"
fi

say "Database user and connection secret"
if gcloud secrets describe "$SECRET" --project "$PROJECT" >/dev/null 2>&1; then
  echo "  secret already exists — leaving password untouched"
else
  # Generated here and handed straight to Secret Manager: never echoed, never
  # written to a file, never committed.
  DB_PASSWORD="$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 32)"
  gcloud sql users create "$DB_USER" \
    --instance "$SQL_INSTANCE" --password "$DB_PASSWORD" --project "$PROJECT" >/dev/null 2>&1 ||
    gcloud sql users set-password "$DB_USER" \
      --instance "$SQL_INSTANCE" --password "$DB_PASSWORD" --project "$PROJECT" >/dev/null
  # node-postgres reads ?host=... as a unix socket directory, which is how
  # Cloud Run reaches Cloud SQL.
  printf 'postgres://%s:%s@/%s?host=/cloudsql/%s' \
    "$DB_USER" "$DB_PASSWORD" "$DB_NAME" "$CONNECTION_NAME" |
    gcloud secrets create "$SECRET" \
      --data-file=- --replication-policy=automatic --project "$PROJECT"
  unset DB_PASSWORD
fi

say "Identity Platform — enforced MFA, TOTP, no public sign-up"
# Slice 5.1. Two things are created here and neither is an operator.
#
# **The config is per PROJECT and not per environment**, because staging and
# prod share one project today. So a staging operator is a prod operator, and
# that is a real fact rather than an oversight: prod answers 503 by design
# until the first pilot tag, and separating the two is either an Identity
# Platform tenant or a second project. It is carried to **week 12**, beside the
# prod restart and the organisation move (fuse F7), where it is decided once
# with the rest of the prod hardening rather than twice.
#
# **mfa.state = MANDATORY is one half of "enforced, not offered".** The other
# half is src/staff/, which refuses any ID token carrying no
# `firebase.sign_in_second_factor` claim -- and that half is the one with a
# test behind it, because a console setting is not something this repository
# can assert (SPEC-staff.md).
#
# **disabledUserSignup is what makes the API key safe to hold.** An Identity
# Platform API key is a browser key by design; with public sign-up off, holding
# it is not holding an account. Accounts are created only through the admin
# endpoint, under the runtime service account's ADC, from the invite flow.
# **The state name is MANDATORY and not ENFORCED**, which this script learned the
# hard way at 5.1: the first run PATCHed "ENFORCED", Identity Platform answered
# 400 INVALID_ARGUMENT, curl exited 0 because an HTTP error is not a transport
# error, and the output was thrown away -- so a bootstrap that printed nothing
# but success left MFA DISABLED. That is slice 1.2's lesson in a different
# costume: a step that cannot fail the run is decoration. Hence --fail-with-body
# below, and hence the read-back after it, which is the only part that proves
# anything.
IDENTITY_HOST=https://identitytoolkit.googleapis.com
identity_curl() {
  curl -sS --fail-with-body -X "$1" \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "Content-Type: application/json" \
    -H "X-Goog-User-Project: $PROJECT" \
    "${@:2}"
}

# Idempotent: initializeAuth fails with ALREADY_EXISTS on a project that has it,
# which is the state every run after the first is in. **The one call here whose
# failure is expected**, and the only one allowed to swallow its own output.
identity_curl POST "$IDENTITY_HOST/v2/projects/$PROJECT/identityPlatform:initializeAuth" \
  -d '{}' >/dev/null 2>&1 || true

identity_curl PATCH \
  "$IDENTITY_HOST/admin/v2/projects/$PROJECT/config?updateMask=mfa,client.permissions,signIn.email" \
  -d '{
        "mfa": {
          "state": "MANDATORY",
          "providerConfigs": [
            { "state": "ENABLED", "totpProviderConfig": { "adjacentIntervals": 1 } }
          ]
        },
        "client": { "permissions": { "disabledUserSignup": true } },
        "signIn": { "email": { "enabled": true, "passwordRequired": true } }
      }' >/dev/null

# Read it back and refuse to continue if it did not take. The application half of
# "enforced, not offered" has a test behind it (src/staff/routes.test.ts); this
# half has only this line, so this line has to be an assertion rather than a
# hope.
IDENTITY_STATE="$(identity_curl GET "$IDENTITY_HOST/admin/v2/projects/$PROJECT/config" |
  python3 -c 'import json,sys; c=json.load(sys.stdin); print(c.get("mfa",{}).get("state","MISSING"), c.get("client",{}).get("permissions",{}).get("disabledUserSignup"))')"
if [[ "$IDENTITY_STATE" != "MANDATORY True" ]]; then
  echo "  !! Identity Platform did not take the config: mfa/sign-up = $IDENTITY_STATE" >&2
  exit 1
fi
echo "  mfa: MANDATORY (TOTP) · public sign-up: disabled"

if gcloud secrets describe "$IDENTITY_SECRET" --project "$PROJECT" >/dev/null 2>&1; then
  echo "  $IDENTITY_SECRET already exists — leaving the key untouched"
else
  # Restricted to the one API it is for, so a leaked key is a key that can call
  # identitytoolkit and nothing else. Created and read in the same breath and
  # piped straight into Secret Manager: never an argv, never a file, never a log
  # (ADR-0003).
  gcloud services api-keys create \
    --key-id "$IDENTITY_KEY_ID" \
    --display-name "dona identity ($ENV)" \
    --api-target=service=identitytoolkit.googleapis.com \
    --project "$PROJECT" >/dev/null 2>&1 || true
  gcloud services api-keys get-key-string \
    "projects/$PROJECT_NUMBER/locations/global/keys/$IDENTITY_KEY_ID" \
    --project "$PROJECT" --format='value(keyString)' |
    tr -d '\n' |
    gcloud secrets create "$IDENTITY_SECRET" \
      --data-file=- --replication-policy=automatic --project "$PROJECT"
fi

say "Service accounts"
for sa in "$RUNTIME_SA" "$DEPLOY_SA"; do
  gcloud iam service-accounts describe "$sa@$PROJECT.iam.gserviceaccount.com" \
    --project "$PROJECT" >/dev/null 2>&1 ||
    gcloud iam service-accounts create "$sa" \
      --display-name "$sa" --project "$PROJECT"
done

# Runtime: reach the database, read its own secret. Nothing else. The secret
# binding is per-secret, so app-staging cannot read prod's connection URL.
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member "serviceAccount:$RUNTIME_EMAIL" \
  --role roles/cloudsql.client --condition=None >/dev/null
for secret in "$SECRET" "$OPENAI_SECRET" "$IDENTITY_SECRET"; do
  # The model key may not exist yet -- a fresh environment has no OpenAI key
  # until someone runs set-secret.sh, and that is not an error worth failing a
  # bootstrap over. The deploy will mount it when it is there; until then the
  # boot line reads `embeddings: unconfigured`, which is the loud version of
  # missing.
  gcloud secrets describe "$secret" --project "$PROJECT" >/dev/null 2>&1 || {
    echo "  $secret does not exist yet — ./infra/set-secret.sh $ENV ${secret#"$ENV-"}"
    continue
  }
  gcloud secrets add-iam-policy-binding "$secret" \
    --member "serviceAccount:$RUNTIME_EMAIL" \
    --role roles/secretmanager.secretAccessor --project "$PROJECT" >/dev/null
done

# Deploy: push images, roll revisions, act as the runtime account. These are
# project-level today, so deploy-staging and deploy-prod differ in audit trail
# rather than in power; scoping run.admin per service is slice 8.4 on
# tasks/roadmap.md (it can only be bound after the service exists, and the
# services exist from 1.6).
for role in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member "serviceAccount:$DEPLOY_EMAIL" \
    --role "$role" --condition=None >/dev/null
done

say "Private document store gs://$DOCS_BUCKET"
# Real lease PDFs live here: tenant names, government ID numbers, phone
# numbers, bank details and signature images. That is sensitive personal data,
# not merely personal, so the bucket is created closed and re-closed on every
# run. Same region as everything else, which also keeps Israeli tenants' data
# in Israel.
gcloud storage buckets describe "gs://$DOCS_BUCKET" --project "$PROJECT" >/dev/null 2>&1 ||
  gcloud storage buckets create "gs://$DOCS_BUCKET" \
    --location="$REGION" \
    --uniform-bucket-level-access \
    --public-access-prevention \
    --project "$PROJECT"

# Re-applied every run rather than only at creation: these four are the controls
# that matter, and a re-run is how a console click gets corrected.
#   public access prevention — the bucket can never be made public, even by
#     someone who wants to; it is not a default that can be toggled off per
#     object.
#   uniform bucket-level access — no per-object ACLs, so access is decided in
#     one place that can be read at a glance.
#   versioning — an overwrite or a delete is recoverable, which matters when
#     the object is the only copy of a signed contract.
#   soft delete, 7 days — stated at slice 3.2 rather than inherited. It was on
#     by default and slice 1.5 recorded that as an open observation: a
#     "permanently removed" claim and a seven-day recovery window are not the
#     same statement, and somebody had to decide which one this bucket makes.
#     Here the answer is the OPPOSITE of the corpus bucket's. infra/corpus-
#     bucket.sh clears the window (1.12) because a corpus has a removal date and
#     recoverability would make its deletion path a lie; a signed contract has no
#     removal date, and the window is a second layer under versioning. A control
#     that is only a vendor default is a control nobody chose.
gcloud storage buckets update "gs://$DOCS_BUCKET" \
  --uniform-bucket-level-access \
  --public-access-prevention \
  --versioning \
  --soft-delete-duration=7d \
  --project "$PROJECT" >/dev/null

# On this bucket alone — never a project-level storage role, so app-staging
# cannot read prod's documents.
#
# **Not granted, and this is the whole of slice 3.2's acceptance bar:**
# objectAdmin, which carries delete. The app can write a new object and read one,
# and it cannot destroy a signed contract. There is no delete method in
# src/kernel/objects.ts either, so the property holds twice — and 3.2 proves this
# half by going around the missing method, issuing a raw DELETE as
# $RUNTIME_EMAIL and recording the refusal (src/docs-probe.ts).
#
# What this does NOT cover, and 1.5 said so first: the bucket's legacy
# projectEditor / projectOwner bindings carry legacyObjectOwner, and that does
# include delete. The application cannot destroy a contract; a human with project
# editor still can. That is inherent to a GCS bucket in a project with basic
# roles rather than something this script chose, and it is owned at **week 8**
# on tasks/roadmap.md -- the same IAM pass as 1.5's run.admin scoping, in the
# week whose demo is trying to break isolation.
for role in roles/storage.objectViewer roles/storage.objectCreator; do
  gcloud storage buckets add-iam-policy-binding "gs://$DOCS_BUCKET" \
    --member "serviceAccount:$RUNTIME_EMAIL" \
    --role "$role" \
    --project "$PROJECT" >/dev/null
done

# Read back and printed rather than assumed. A re-run that reapplies four
# controls silently looks identical to a re-run that reapplied nothing, and the
# output is read every time while the document is read when somebody remembers
# to (slice 1.5's reason for the organisation warning).
gcloud storage buckets describe "gs://$DOCS_BUCKET" --project "$PROJECT" \
  --format='value[separator="  "](
    format("uniform={0}", uniform_bucket_level_access),
    format("public_access_prevention={0}", public_access_prevention),
    format("versioning={0}", versioning_enabled),
    format("soft_delete={0}", soft_delete_policy.retentionDurationSeconds)
  )' | sed 's/^/  /'
echo "  $RUNTIME_SA: objectViewer + objectCreator, and NOT objectAdmin"

# Document AI does not serve me-west1. Closest residency that hosts OCR_PROCESSOR
# is eu (eu-documentai.googleapis.com). Processor id is environment, like
# DOCS_BUCKET; the version is a config_settings row.
#
# The gcloud documentai surface is a component this SDK does not ship, so this
# talks to the REST API the adapter itself uses — same host, same resource.
say "Document AI OCR processor (eu)"
OCR_DISPLAY="dona-ocr-$ENV"
OCR_LOCATION=eu
OCR_HOST="https://${OCR_LOCATION}-documentai.googleapis.com"
OCR_PARENT="projects/${PROJECT}/locations/${OCR_LOCATION}"
OCR_TOKEN="$(gcloud auth print-access-token)"
ocr_list() {
  curl -sS -H "Authorization: Bearer $OCR_TOKEN" \
    "${OCR_HOST}/v1/${OCR_PARENT}/processors"
}
OCR_NAME="$(ocr_list | python3 -c "
import json, sys
wanted = sys.argv[1]
body = json.load(sys.stdin)
if 'error' in body:
    sys.exit(0)
for processor in body.get('processors', []):
    if processor.get('displayName') == wanted:
        print(processor.get('name', ''))
        break
" "$OCR_DISPLAY")"
if [[ -z "$OCR_NAME" ]]; then
  OCR_NAME="$(curl -sfS -X POST \
    -H "Authorization: Bearer $OCR_TOKEN" \
    -H "Content-Type: application/json; charset=utf-8" \
    "${OCR_HOST}/v1/${OCR_PARENT}/processors" \
    -d "{\"type\":\"OCR_PROCESSOR\",\"displayName\":\"${OCR_DISPLAY}\"}" |
    python3 -c "import json,sys; print(json.load(sys.stdin).get('name',''))")"
fi
OCR_PROCESSOR_ID="${OCR_NAME##*/}"
if [[ -z "$OCR_PROCESSOR_ID" ]]; then
  echo "  failed to create or find processor $OCR_DISPLAY" >&2
  exit 1
fi
echo "  name:     $OCR_NAME"
echo "  id:       $OCR_PROCESSOR_ID"
echo "  location: $OCR_LOCATION"

# apiUser can call process. editor can create and delete processors — not granted.
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$RUNTIME_EMAIL" \
  --role=roles/documentai.apiUser \
  --condition=None >/dev/null
# Deploy looks the processor up by display name at revision time.
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$DEPLOY_EMAIL" \
  --role=roles/documentai.viewer \
  --condition=None >/dev/null
echo "  $RUNTIME_SA: documentai.apiUser (not editor)"
echo "  $DEPLOY_SA: documentai.viewer"

say "Workload Identity Federation (no long-lived keys)"
gcloud iam workload-identity-pools describe "$POOL" \
  --location=global --project "$PROJECT" >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools create "$POOL" \
    --location=global --display-name="GitHub Actions" --project "$PROJECT"

# The attribute condition is the security control: without it, any repository
# on GitHub could mint a token for this project.
gcloud iam workload-identity-pools providers describe "$PROVIDER" \
  --workload-identity-pool="$POOL" --location=global --project "$PROJECT" >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --workload-identity-pool="$POOL" \
    --location=global \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository == '$GITHUB_REPO'" \
    --project "$PROJECT"

gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_EMAIL" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository/$GITHUB_REPO" \
  --project "$PROJECT" >/dev/null

say "Done — values used by .github/workflows/"
echo "  provider:     projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER"
echo "  deploy SA:    $DEPLOY_EMAIL"
echo "  runtime SA:   $RUNTIME_EMAIL"
echo "  sql instance: $CONNECTION_NAME"
echo "  secret:       $SECRET"
echo "  identity:     $IDENTITY_SECRET (mfa MANDATORY, TOTP, sign-up off)"
echo "  docs bucket:  gs://$DOCS_BUCKET"
echo "  ocr processor: ${OCR_PROCESSOR_ID:-unset} ($OCR_LOCATION)"
