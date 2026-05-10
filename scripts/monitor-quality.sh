#!/usr/bin/env bash
set -euo pipefail

SECRETS_FILE="${HOME}/.config/opencode/.secrets"
SONAR_API="https://sonarcloud.io/api"
DEEPSOURCE_API="https://api.deepsource.com/graphql/"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

if [ -f "$SECRETS_FILE" ]; then
    source "$SECRETS_FILE"
fi

if [ -z "${SONAR_TOKEN:-}" ] || [ "$SONAR_TOKEN" = "YOUR_SONARCLOUD_TOKEN_HERE" ]; then
    echo -e "${RED}❌ SONAR_TOKEN not configured${NC}"
    echo "   Add your token to: $SECRETS_FILE"
    exit 1
fi

if [ -z "${DEEPSOURCE_TOKEN:-}" ] || [ "$DEEPSOURCE_TOKEN" = "YOUR_DEEPSOURCE_TOKEN_HERE" ]; then
    echo -e "${RED}❌ DEEPSOURCE_TOKEN not configured${NC}"
    echo "   Add your token to: $SECRETS_FILE"
    exit 1
fi

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  opencode-mem0 Quality Monitoring${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""

# SonarCloud
echo -e "${BLUE}📊 SonarCloud Metrics${NC}"
echo "───────────────────────────────────────────"

SONAR_TMP=$(mktemp)
curl -s -H "Authorization: Bearer $SONAR_TOKEN" \
    "${SONAR_API}/measures/component?component=ZeR020_opencode-mem0&metricKeys=coverage,bugs,vulnerabilities,code_smells,duplicated_lines_density,security_hotspots,ncloc,cognitive_complexity,violations,alert_status&branch=main" > "$SONAR_TMP"

if grep -q '"errors"' "$SONAR_TMP"; then
    echo -e "${RED}❌ Failed to fetch SonarCloud data${NC}"
else
    cat "$SONAR_TMP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
m = {x['metric']: x['value'] for x in d['component']['measures']}
status = m.get('alert_status', 'N/A')
status_icon = '✅' if status == 'OK' else '❌'
print(f'Quality Gate:     {status_icon} {status}')
print(f'Coverage:         {m.get(\"coverage\", \"N/A\")}%')
print(f'Bugs:             {m.get(\"bugs\", \"N/A\")}')
print(f'Vulnerabilities:  {m.get(\"vulnerabilities\", \"N/A\")}')
print(f'Code Smells:      {m.get(\"code_smells\", \"N/A\")}')
print(f'Duplications:     {m.get(\"duplicated_lines_density\", \"N/A\")}%')
print(f'Complexity:       {m.get(\"cognitive_complexity\", \"N/A\")}')
print(f'Lines of Code:    {m.get(\"ncloc\", \"N/A\")}')
print(f'Security Hotspots: {m.get(\"security_hotspots\", \"N/A\")}')
"
fi
rm -f "$SONAR_TMP"

echo ""

# DeepSource
echo -e "${BLUE}📊 DeepSource Metrics${NC}"
echo "───────────────────────────────────────────"

DEEPSOURCE_TMP=$(mktemp)
curl -s -X POST "$DEEPSOURCE_API" \
    -H "Authorization: Bearer $DEEPSOURCE_TOKEN" \
    -H "Content-Type: application/json" \
    --data '{"query": "query { repository(login: \"ZeR020\", name: \"opencode-mem0\", vcsProvider: GITHUB) { name analysisRuns(first: 1) { edges { node { status commitOid createdAt } } } issues(first: 1) { totalCount } } }"}' > "$DEEPSOURCE_TMP"

if grep -q '"errors"' "$DEEPSOURCE_TMP"; then
    echo -e "${RED}❌ Failed to fetch DeepSource data${NC}"
else
    cat "$DEEPSOURCE_TMP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = d['data']['repository']
run = r['analysisRuns']['edges'][0]['node']
issues = r['issues']['totalCount']
status = run['status']
status_icon = '✅' if status == 'SUCCESS' else '⚠️'
print(f'Status:        {status_icon} {status}')
print(f'Issues:        {issues}')
print(f'Last Commit:   {run[\"commitOid\"][:8]}')
print(f'Analysis Date: {run[\"createdAt\"][:10]}')
"
fi
rm -f "$DEEPSOURCE_TMP"

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Monitoring complete!${NC}"
