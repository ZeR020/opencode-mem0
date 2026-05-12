#!/bin/bash
# scripts/lint-deepsource.sh
# Local pre-push linting script that catches common DeepSource JavaScript analyzer issues
# Usage: ./scripts/lint-deepsource.sh
# Run before every push to prevent DeepSource failures

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0

echo "🔍 Running local DeepSource-equivalent checks..."
echo ""

# 1. Check for async functions without await (JS-0116)
echo "1️⃣  Checking for async functions without await (JS-0116)..."
# Use rg to find async function declarations, then check if they contain await
ASYNC_NO_AWAIT=$(rg -n '^\s*async\s+(function|export\s+async\s+function)\s+\w+' src/ --type ts -A 100 | \
  awk '/^\s*async\s+(function|export\s+async\s+function)\s+\w+/{fn=$0; has_await=0} /await /{has_await=1} /^\s*}/||/^\s*async\s+(function|export\s+async\s+function)\s+\w+/{if(fn && !has_await) print fn}' 2>/dev/null || true)

if [ -n "$ASYNC_NO_AWAIT" ]; then
  echo -e "${RED}  Found async functions without await:${NC}"
  echo "$ASYNC_NO_AWAIT" | head -20
  ERRORS=$((ERRORS + 1))
else
  echo -e "${GREEN}  ✓ No async-without-await issues found${NC}"
fi

# 2. Check for var declarations (JS-0239)
echo "2️⃣  Checking for var declarations (JS-0239)..."
VAR_DECLS=$(rg -n '^\s*var\s+' src/ --type ts | grep -v 'node_modules' | grep -v 'dist/' | head -20 || true)
if [ -n "$VAR_DECLS" ]; then
  echo -e "${RED}  Found var declarations:${NC}"
  echo "$VAR_DECLS"
  ERRORS=$((ERRORS + 1))
else
  echo -e "${GREEN}  ✓ No var declarations found${NC}"
fi

# 3. Check for loose equality (== / !=) outside of null checks (JS- lint rules)
echo "3️⃣  Checking for loose equality operators..."
LOOSE_EQ=$(rg -n '==\s' src/ --type ts | grep -v '===' | grep -v '!== ' | grep -v '== null' | grep -v '!= null' | head -20 || true)
if [ -n "$LOOSE_EQ" ]; then
  echo -e "${RED}  Found loose equality:${NC}"
  echo "$LOOSE_EQ"
  ERRORS=$((ERRORS + 1))
else
  echo -e "${GREEN}  ✓ No loose equality found${NC}"
fi

# 4. Check for console usage outside logger (JS-E1009)
echo "4️⃣  Checking for console.* outside logger..."
CONSOLE_USAGE=$(rg -n 'console\.(log|warn|error|debug|info)\(' src/ --type ts | grep -v 'tests/' | grep -v 'logger' | grep -v 'skipcq' | head -20 || true)
if [ -n "$CONSOLE_USAGE" ]; then
  echo -e "${RED}  Found console usage:${NC}"
  echo "$CONSOLE_USAGE"
  ERRORS=$((ERRORS + 1))
else
  echo -e "${GREEN}  ✓ No console usage outside logger${NC}"
fi

# 5. Check for string concatenation with + (JS-0246 / JS-W1041)
echo "5️⃣  Checking for string concatenation with + (JS-W1041)..."
STRING_CONCAT=$(rg -n '["'"'"'].*\+.*["'"'"']|["'"'"'].*\+\s*\w+|\w+\s*\+.*["'"'"']' src/ --type ts | grep -v 'tests/' | grep -v 'skipcq' | head -20 || true)
if [ -n "$STRING_CONCAT" ]; then
  echo -e "${YELLOW}  Found potential string concatenation (may be intentional):${NC}"
  echo "$STRING_CONCAT"
  # This is a warning, not an error
else
  echo -e "${GREEN}  ✓ No string concatenation issues${NC}"
fi

# 6. Check for catch blocks without error handling (JS-2486 equivalent)
echo "6️⃣  Checking for empty catch blocks..."
EMPTY_CATCH=$(rg -n 'catch\s*\([^)]*\)\s*\{\s*\}' src/ --type ts | head -20 || true)
if [ -n "$EMPTY_CATCH" ]; then
  echo -e "${RED}  Found empty catch blocks:${NC}"
  echo "$EMPTY_CATCH"
  ERRORS=$((ERRORS + 1))
else
  echo -e "${GREEN}  ✓ No empty catch blocks${NC}"
fi

# 7. Check for non-null assertions (JS-0339)
echo "7️⃣  Checking for non-null assertions (!) without skipcq..."
NON_NULL=$(rg -n '![.;)]' src/ --type ts | grep -v 'skipcq' | grep -v 'tests/' | grep -v 'node_modules/' | head -20 || true)
if [ -n "$NON_NULL" ]; then
  echo -e "${YELLOW}  Found non-null assertions (may need skipcq):${NC}"
  echo "$NON_NULL"
  # Warning only
else
  echo -e "${GREEN}  ✓ No unannotated non-null assertions${NC}"
fi

# 8. Check for explicit any types without skipcq (JS-0323)
echo "8️⃣  Checking for explicit any types without skipcq..."
EXPLICIT_ANY=$(rg -n ':\s*any\b' src/ --type ts | grep -v 'skipcq' | grep -v 'tests/' | head -20 || true)
if [ -n "$EXPLICIT_ANY" ]; then
  echo -e "${YELLOW}  Found explicit any types (may need skipcq):${NC}"
  echo "$EXPLICIT_ANY"
  # Warning only - too many to fix at once
else
  echo -e "${GREEN}  ✓ No unannotated any types${NC}"
fi

# Summary
echo ""
echo "========================================"
if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}✅ All critical DeepSource checks passed!${NC}"
  echo "   (Warnings are non-blocking)"
  exit 0
else
  echo -e "${RED}❌ Found $ERRORS critical DeepSource issue(s)${NC}"
  echo "   Fix before pushing to avoid post-push failures"
  exit 1
fi
