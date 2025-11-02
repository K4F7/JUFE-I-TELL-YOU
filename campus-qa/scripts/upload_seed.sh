#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${BUCKET:-}" ]]; then
  echo "Usage: BUCKET=gs://campus-qa-docs ./scripts/upload_seed.sh" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEED_DIR="${ROOT_DIR}/../seed"

gsutil -m rsync -r "${SEED_DIR}" "${BUCKET%/}/seed"
