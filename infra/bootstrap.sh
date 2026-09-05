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
  # Point-in-time recovery is deliberately not enabled yet (week 6 item).
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

gcloud sql databases describe "$DB_NAME" \
  --instance "$SQL_INSTANCE" --project "$PROJECT" >/dev/null 2>&1 ||
  gcloud sql databases create "$DB_NAME" \
    --instance "$SQL_INSTANCE" --project "$PROJECT"

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
for secret in "$SECRET" "$OPENAI_SECRET"; do
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
# rather than in power; scoping run.admin per service is a week-6 hardening
# item (it can only be bound after the service exists).
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

# Re-applied every run rather than only at creation: these three are the
# controls that matter, and a re-run is how a console click gets corrected.
#   public access prevention — the bucket can never be made public, even by
#     someone who wants to; it is not a default that can be toggled off per
#     object.
#   uniform bucket-level access — no per-object ACLs, so access is decided in
#     one place that can be read at a glance.
#   versioning — an overwrite or a delete is recoverable, which matters when
#     the object is the only copy of a signed contract.
gcloud storage buckets update "gs://$DOCS_BUCKET" \
  --uniform-bucket-level-access \
  --public-access-prevention \
  --versioning \
  --project "$PROJECT" >/dev/null

# On this bucket alone — never a project-level storage role, so app-staging
# cannot read prod's documents.
#
# objectCreator is the grant slice 7.0 deferred "until the slice that needs it";
# slice 11.2 is that slice, and the admin lease upload is what needs it. Note
# what is still *not* granted: objectAdmin, which carries delete. The app can
# write a new object and read one, and it cannot destroy a signed contract —
# which matters while there is no retention rule and no deletion path (week 6).
for role in roles/storage.objectViewer roles/storage.objectCreator; do
  gcloud storage buckets add-iam-policy-binding "gs://$DOCS_BUCKET" \
    --member "serviceAccount:$RUNTIME_EMAIL" \
    --role "$role" \
    --project "$PROJECT" >/dev/null
done

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
echo "  docs bucket:  gs://$DOCS_BUCKET"
