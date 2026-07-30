#!/usr/bin/env bash
set -Eeuo pipefail

publish_failed_callback() {
  local exit_code=$?
  trap - ERR
  python3 scripts/publish-results.py failed "Analyzer workflow exited with code ${exit_code}" || true
  exit "${exit_code}"
}
trap 'publish_failed_callback' ERR

validate_repository_url() {
  [[ "$repository_url" =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(\.git)?$ ]]
}

validate_commit_sha() {
  [[ "$source_version" =~ ^[0-9a-fA-F]{40}$ ]]
}

validate_upload_digest() {
  [[ "$source_version" =~ ^[0-9a-fA-F]{64}$ ]]
}

if [[ ! "$mode" =~ ^(full|incremental|review)$ ]]; then
  echo "Invalid analysis mode" >&2
  exit 2
fi
if [[ ! "$source_type" =~ ^(github|upload)$ ]]; then
  echo "Invalid source_type" >&2
  exit 2
fi

python3 scripts/publish-results.py running
rm -rf source source.zip artifacts
mkdir -p artifacts

if [[ "$source_type" == "github" ]]; then
  if ! validate_repository_url || ! validate_commit_sha; then
    echo "GitHub sources require a canonical repository URL and immutable 40-character commit SHA" >&2
    exit 2
  fi
  clone_url="$repository_url"
  if [[ -n "${SOURCE_REPOSITORY_TOKEN:-}" ]]; then
    clone_url="${repository_url/https:\/\/github.com/https:\/\/x-access-token:${SOURCE_REPOSITORY_TOKEN}@github.com}"
  fi
  # Fetch source only. No dependency installation, build, tests, hooks, or project scripts run.
  git -c advice.detachedHead=false clone --filter=blob:none --no-tags --no-checkout "$clone_url" source
  unset clone_url SOURCE_REPOSITORY_TOKEN
  git -C source checkout --detach "$source_version"
  actual_version="$(git -C source rev-parse HEAD)"
  if [[ "$actual_version" != "$source_version" ]]; then
    echo "Checked-out commit does not match requested source_version" >&2
    exit 3
  fi
  rm -rf source/.git
  PYTHONPATH=analyzer/src python3 -m ua_analyzer analyze \
    --source source \
    --output artifacts \
    --project-id "$project_id" \
    --source-version "$source_version"
else
  if ! validate_upload_digest || [[ ! "$source_url" =~ ^https:// ]]; then
    echo "Upload sources require an HTTPS source URL and 64-character SHA-256 digest" >&2
    exit 2
  fi
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --max-filesize 104857600 "$source_url" --output source.zip
  actual_digest="$(sha256sum source.zip | awk '{print $1}')"
  if [[ "$actual_digest" != "${source_version,,}" ]]; then
    echo "Downloaded ZIP digest does not match source_version" >&2
    exit 3
  fi
  PYTHONPATH=analyzer/src python3 -m ua_analyzer analyze \
    --archive \
    --source source.zip \
    --output artifacts \
    --project-id "$project_id" \
    --source-version "$source_version"
fi

python3 scripts/publish-results.py completed
trap - ERR
