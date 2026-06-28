#!/bin/bash
# scripts/check-sonarcloud-gate.sh
# Pre-push check: queries SonarCloud API for the current Quality Gate status
# and warns if any condition is failing. Run before pushing to avoid post-push
# SonarCloud gate failures.
#
# Usage: bash scripts/check-sonarcloud-gate.sh
# Requires: curl, python3, network access to sonarcloud.io
# Note: This checks the LAST analysis result. After pushing, a new analysis
# will run and may change the status. The goal is to catch known failures
# before pushing, not to predict the exact post-push state.

set -e

PROJECT_KEY="ZeR020_opencode-mem0"
BRANCH="main"
SONAR_API="https://sonarcloud.io/api"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🔍 Checking SonarCloud Quality Gate status..."

# Fetch gate status
GATE_JSON=$(curl -s "${SONAR_API}/qualitygates/project_status?projectKey=${PROJECT_KEY}&branch=${BRANCH}" 2>/dev/null || true)

if [ -z "$GATE_JSON" ]; then
  echo -e "${YELLOW}  ⚠️  Could not reach SonarCloud API (offline?). Skipping gate check.${NC}"
  exit 0
fi

# Parse gate status
STATUS=$(echo "$GATE_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('projectStatus', {}).get('status', 'UNKNOWN'))
" 2>/dev/null || echo "UNKNOWN")

if [ "$STATUS" = "UNKNOWN" ]; then
  echo -e "${YELLOW}  ⚠️  Could not parse SonarCloud gate response. Skipping.${NC}"
  exit 0
fi

if [ "$STATUS" = "OK" ]; then
  echo -e "${GREEN}  ✅ SonarCloud Quality Gate: PASS${NC}"
  exit 0
fi

# Gate is ERROR — show failing conditions
echo -e "${RED}  ❌ SonarCloud Quality Gate: FAIL${NC}"
echo ""
echo "  Failing conditions:"

echo "$GATE_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
conditions = d.get('projectStatus', {}).get('conditions', [])
rating_map = {'1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'E'}
for c in conditions:
    if c.get('status') != 'OK':
        mk = c.get('metricKey', '?')
        actual = c.get('actualValue', '?')
        thresh = c.get('errorThreshold', '?')
        if 'rating' in mk:
            actual = rating_map.get(actual, actual)
            thresh = rating_map.get(thresh, thresh)
            print(f'    ❌ {mk}: {actual} (threshold: {thresh})')
        else:
            print(f'    ❌ {mk}: {actual}% (threshold: {thresh}%)')
" 2>/dev/null

echo ""
echo -e "${YELLOW}  Fix the failing conditions before pushing to avoid gate failures.${NC}"
echo "  Dashboard: https://sonarcloud.io/dashboard?id=${PROJECT_KEY}&branch=${BRANCH}"

# Non-blocking: warn but don't prevent the push
exit 0
