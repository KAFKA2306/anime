set -euo pipefail
m=$(mktemp);now=$(date -u +'%Y-%m-%dT%H:%M:%SZ');run="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
jq --arg c "$GITHUB_SHA" --arg t "$now" --arg u "$run" --slurpfile b browser-report.json '.browser_e2e=$b[0]|.browser_verification_commit=$c|.browser_verified_at=$t|.browser_workflow_run=$u|.checks+= ["real Chromium tag click, URL transition, exact-match ranking and 390px responsive layout"]|.checks|=unique' verification/live-pages.json >"$m"
e=$(base64 -w0 "$m");s=$(gh api "repos/$GITHUB_REPOSITORY/contents/verification/live-pages.json?ref=main" --jq .sha)
gh api --method PUT "repos/$GITHUB_REPOSITORY/contents/verification/live-pages.json" -f message="Record browser E2E verification" -f content="$e" -f branch=main -f sha="$s" --jq .commit.html_url
