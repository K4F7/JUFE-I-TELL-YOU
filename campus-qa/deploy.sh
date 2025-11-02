#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID is required}"
: "${REGION:=asia-northeast1}"
: "${GCS_BUCKET:?GCS_BUCKET is required (e.g. gs://campus-qa-docs)}"
: "${SERVICE_ACCOUNT:?SERVICE_ACCOUNT is required}"
: "${ARTIFACT_REPO:=campus-qa}"
ADMIN_TOKEN="${ADMIN_TOKEN:-$(openssl rand -hex 24)}"

BACKEND_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO}/campus-qa-api"
FRONTEND_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO}/campus-qa-web"

pushd "$(dirname "$0")" >/dev/null
ROOT_DIR="$(pwd)"

export PROJECT_ID REGION GCS_BUCKET SERVICE_ACCOUNT ARTIFACT_REPO ADMIN_TOKEN

printf '\n==> Ensuring Artifact Registry repository %s exists\n' "$ARTIFACT_REPO"
gcloud artifacts repositories describe "$ARTIFACT_REPO" --project "$PROJECT_ID" --location "$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$ARTIFACT_REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Campus QA images"

printf '\n==> Building backend image %s\n' "$BACKEND_IMAGE"
gcloud builds submit "${ROOT_DIR}/backend" \
  --tag "${BACKEND_IMAGE}:latest"

printf '\n==> Building frontend image %s\n' "$FRONTEND_IMAGE"
gcloud builds submit "${ROOT_DIR}" \
  --file "${ROOT_DIR}/cloudrun-frontend/Dockerfile" \
  --tag "${FRONTEND_IMAGE}:latest"

printf '\n==> Deploying Cloud Run backend service\n'
gcloud run deploy campus-qa-api \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --image "${BACKEND_IMAGE}:latest" \
  --service-account "$SERVICE_ACCOUNT" \
  --allow-unauthenticated \
  --set-env-vars "PROJECT_ID=${PROJECT_ID},REGION=${REGION},GCS_BUCKET=${GCS_BUCKET},FIRESTORE_COLLECTION=chunks,TOPK=5,RAG_MAX_CONTEXT=2500,GEMINI_MODEL=${GEMINI_MODEL:-gemini-1.5-pro},ADMIN_TOKEN=${ADMIN_TOKEN}"

printf '\n==> Deploying Cloud Run frontend service\n'
gcloud run deploy campus-qa-web \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --image "${FRONTEND_IMAGE}:latest" \
  --allow-unauthenticated

API_URL=$(gcloud run services describe campus-qa-api --project "$PROJECT_ID" --region "$REGION" --format 'value(status.url)')
WEB_URL=$(gcloud run services describe campus-qa-web --project "$PROJECT_ID" --region "$REGION" --format 'value(status.url)')

cat <<INFO

Deployment complete.
API URL: ${API_URL}
Frontend URL: ${WEB_URL}
Admin token (store securely!): ${ADMIN_TOKEN}

INFO

popd >/dev/null
