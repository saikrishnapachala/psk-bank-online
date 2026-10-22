#!/usr/bin/env bash
# One-command deploy to Render's free plan via the Render API.
# Creates (or updates) two web services from this repo:
#   psk-bank-api     Java banking service (Docker)    - gets the Fiserv keys from backend/.env
#   psk-bank-online  Next.js UI + BFF (Node)          - gets the API URL and the shared secret
# Secrets are read locally and sent only to Render. Nothing is printed except the demo password.
#
# Usage:  deploy/render-deploy.sh            (asks for your Render API key, hidden)
#         deploy/render-deploy.sh --redeploy (rebuild both from the latest main; settings and password unchanged)
#         DRY_RUN=1 deploy/render-deploy.sh  (prints the plan, calls nothing)
# Get an API key: Render dashboard > Account settings > API Keys > Create API Key.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="${REPO:-https://github.com/saikrishnapachala/psk-bank-online}"
BRANCH="${BRANCH:-main}"
REGION="${REGION:-oregon}"
API=https://api.render.com/v1

env_get() { grep -E "^$1=" backend/.env | head -1 | cut -d= -f2-; }
FISERV_API_KEY=$(env_get FISERV_API_KEY); FISERV_API_SECRET=$(env_get FISERV_API_SECRET)
[ -n "$FISERV_API_KEY" ] && [ -n "$FISERV_API_SECRET" ] || { echo "FISERV_API_KEY / FISERV_API_SECRET missing in backend/.env"; exit 1; }
acct() { env_get "ACCOUNTS_$1"; }

BFF_SECRET=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)
DEMO_PASSWORD="${DEMO_PASSWORD:-psk-$(openssl rand -hex 3)}"

api_env=$(python3 - "$FISERV_API_KEY" "$FISERV_API_SECRET" "$BFF_SECRET" "$(acct u-alex)" "$(acct u-jordan)" "$(acct u-sam)" <<'PY'
import json, sys
k, s, bff, a, j, m = sys.argv[1:]
env = {
  "BFF_SHARED_SECRET": bff, "FISERV_MODE": "live", "FISERV_API_KEY": k, "FISERV_API_SECRET": s,
  "FISERV_ORG_ID": "999990301", "FISERV_HOST_URL": "https://bankinghub-cert.fiservapis.com/banking/efx/v1",
  "FISERV_TOKEN_URL": "https://bankinghub-cert.fiservapis.com/fts-apim/oauth2/v2", "FISERV_CHANNEL": "WEB",
  "FISERV_CLIENT_APP_NAME": "PSK-Bank-Online-Demo", "PLAID_MODE": "mock",
  "DEMO_USERS": "u-alex:Alex Morgan,u-jordan:Jordan Lee,u-sam:Sam Patel",
  "ACCOUNTS_U_ALEX": a, "ACCOUNTS_U_JORDAN": j, "ACCOUNTS_U_SAM": m,
  "TRANSFER_LIMIT_USD": "25000", "MEMBER_TRANSFER_LIMIT_USD": "5000", "MEMBER_DAILY_LIMIT_USD": "10000",
  "TRANSFERS_PER_MINUTE": "6",
}
print(json.dumps([{"key": k, "value": v} for k, v in env.items()]))
PY
)

if [ "${DRY_RUN:-}" = 1 ]; then
  echo "DRY RUN: would create psk-bank-api (docker, free, $REGION) and psk-bank-online (node, free) from $REPO@$BRANCH"
  echo "API env keys: $(echo "$api_env" | python3 -c 'import sys,json;print(", ".join(e["key"] for e in json.load(sys.stdin)))')"
  exit 0
fi

if [ -z "${RENDER_API_KEY:-}" ]; then read -r -s -p "Render API key: " RENDER_API_KEY; echo; fi
call() { # method path [json] -> body on stdout; fails loudly on HTTP errors
  local out code
  out=$(curl -sS -w $'\n%{http_code}' -X "$1" "$API$2" -H "Authorization: Bearer $RENDER_API_KEY" \
        -H "Accept: application/json" -H "Content-Type: application/json" ${3:+-d "$3"})
  code=${out##*$'\n'}; out=${out%$'\n'*}
  if [ "$code" -ge 300 ]; then echo "Render API $1 $2 -> HTTP $code: $out" >&2; return 1; fi
  printf '%s' "$out"
}
py() { python3 -c "import sys,json; d=json.load(sys.stdin); $1"; }

OWNER=$(call GET "/owners?limit=1" | py 'print(d[0]["owner"]["id"])')
echo "Render workspace: $OWNER"

if [ "${1:-}" = "--redeploy" ]; then
  for name in psk-bank-api psk-bank-online; do
    id=$(call GET "/services?name=$name&limit=1" | py 'print(d[0]["service"]["id"] if d else "")')
    [ -n "$id" ] || { echo "  $name not found; run without --redeploy first"; exit 1; }
    call POST "/services/$id/deploys" '{"clearCache":"do_not_clear"}' >/dev/null
    echo "  redeploying $name from the latest $BRANCH"
  done
  echo "Builds take ~5-10 minutes. Same URLs, same password."
  exit 0
fi

# Find a service by name, or create it. Prints "id url".
ensure() {
  local name=$1 body=$2 found
  found=$(call GET "/services?name=$name&limit=1" | py 'print(d[0]["service"]["id"] if d else "")')
  if [ -n "$found" ]; then
    echo "  $name exists ($found), updating env vars" >&2
    call PUT "/services/$found/env-vars" "$(echo "$body" | py 'print(json.dumps(d["envVars"]))')" >/dev/null
    call POST "/services/$found/deploys" '{}' >/dev/null
    call GET "/services/$found" | py 'print(d["id"], d["serviceDetails"]["url"])'
  else
    echo "  creating $name" >&2
    call POST "/services" "$body" | py 's=d["service"]; print(s["id"], s["serviceDetails"]["url"])'
  fi
}

api_body=$(python3 - "$OWNER" "$REPO" "$BRANCH" "$REGION" "$api_env" <<'PY'
import json, sys
owner, repo, branch, region, env = sys.argv[1:]
print(json.dumps({
  "type": "web_service", "name": "psk-bank-api", "ownerId": owner, "repo": repo, "branch": branch, "autoDeploy": "yes",
  "envVars": json.loads(env),
  "serviceDetails": {"runtime": "docker", "plan": "free", "region": region, "healthCheckPath": "/health",
                     "envSpecificDetails": {"dockerfilePath": "./backend/Dockerfile", "dockerContext": "./backend"}},
}))
PY
)
read -r API_ID API_URL < <(ensure psk-bank-api "$api_body") || true
[ -n "${API_URL:-}" ] || { echo "Could not create psk-bank-api (see the Render API error above)."; exit 1; }
echo "API service: $API_URL"

web_body=$(python3 - "$OWNER" "$REPO" "$BRANCH" "$REGION" "$API_URL" "$BFF_SECRET" "$SESSION_SECRET" "$DEMO_PASSWORD" <<'PY'
import json, sys
owner, repo, branch, region, api_url, bff, session, pw = sys.argv[1:]
env = {"NODE_VERSION": "22", "BACKEND_URL": api_url, "BACKEND_SHARED_SECRET": bff, "SESSION_SECRET": session,
       "DEMO_PASSWORD": pw, "DEMO_USERS": "alex:u-alex:Alex Morgan,jordan:u-jordan:Jordan Lee,sam:u-sam:Sam Patel"}
print(json.dumps({
  "type": "web_service", "name": "psk-bank-online", "ownerId": owner, "repo": repo, "branch": branch, "autoDeploy": "yes",
  "rootDir": "web", "envVars": [{"key": k, "value": v} for k, v in env.items()],
  "serviceDetails": {"runtime": "node", "plan": "free", "region": region, "healthCheckPath": "/login",
                     "envSpecificDetails": {"buildCommand": "npm ci && npm run build", "startCommand": "npm start"}},
}))
PY
)
read -r WEB_ID WEB_URL < <(ensure psk-bank-online "$web_body") || true
[ -n "${WEB_URL:-}" ] || { echo "Could not create psk-bank-online (see the Render API error above)."; exit 1; }

cat <<EOF

Deploy started. First build takes ~5-10 minutes; watch it at https://dashboard.render.com
  App:  $WEB_URL
  API:  $API_URL/health
  Sign in as alex, jordan or sam with password: $DEMO_PASSWORD
EOF
