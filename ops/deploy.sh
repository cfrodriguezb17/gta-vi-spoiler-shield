#!/usr/bin/env bash
set -euo pipefail
: "${RAILWAY_TOKEN:?}" "${RAILWAY_PROJECT_ID:?}" "${CATALOG_URL:?}" "${TARGET_ENV:?}" "${GITHUB_SHA:?}"
printf '%s\n' "$GITHUB_SHA" > backend/revision.txt
export EXPECT_REVISION="$GITHUB_SHA"
railway=(bunx --package @railway/cli@5.75.0 railway)
for service in migrate encoder api; do
  args=(--project "$RAILWAY_PROJECT_ID" --environment "$TARGET_ENV" --service "$service")
  deployment=$("${railway[@]}" up "${args[@]}" --detach --json --message "$GITHUB_SHA" | jq -er '.deploymentId')
  complete=false
  for attempt in {1..90}; do
    status=$("${railway[@]}" deployment list "${args[@]}" --json | jq -r --arg id "$deployment" '.[] | select(.id == $id) | .status')
    case "$status" in
      SUCCESS|COMPLETED) complete=true; break ;;
      FAILED|CRASHED|REMOVED|SKIPPED) echo "$service deployment $status" >&2; exit 1 ;;
    esac
    sleep 5
  done
  if [[ $complete != true ]]; then echo "$service deployment timed out" >&2; exit 1; fi
done
bun ops/smoke.ts
