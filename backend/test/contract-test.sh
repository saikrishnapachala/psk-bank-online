#!/usr/bin/env bash
# Verifies the LIVE Fiserv and Plaid transports against local fakes that enforce the documented
# request contracts (Basic-auth token call, Bearer + EFXHeader JSON, EFX bodies, Plaid keys + version).
# Needs: JDK 21+, python3, curl. Run from anywhere: backend/test/contract-test.sh
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -I test/fake_providers.py > /tmp/psk-fakes.log 2>&1 &
FAKES=$!
trap 'kill $FAKES 2>/dev/null; kill ${SVC:-0} 2>/dev/null || true' EXIT
sleep 1
rm -rf out && javac -d out $(find src -name '*.java')

export FISERV_MODE=live FISERV_HOST_URL=http://127.0.0.1:9101/banking/efx/v1 \
  FISERV_TOKEN_URL=http://127.0.0.1:9101/fts-apim/oauth2/v2 FISERV_API_KEY=test-key FISERV_API_SECRET=test-secret \
  FISERV_ORG_ID=PRMOrg10 "FISERV_DEMO_ACCOUNTS=SDA:0001112223:Sandbox Savings;DDA:000BAD:Bad Account" \
  PLAID_MODE=live PLAID_BASE_URL=http://127.0.0.1:9102 PLAID_CLIENT_ID=pc-id PLAID_SECRET=pc-secret PORT=8082 \
  BFF_SHARED_SECRET=contract-test

echo "== --check (expects 1 OK, 1 REJECTED)"
java -cp out com.pskbank.demo.App --check || true

java -cp out com.pskbank.demo.App > /tmp/psk-contract-svc.log 2>&1 &
SVC=$!
sleep 2
H=(-H "X-Internal-Token: contract-test" -H "X-User-Id: u-alex" -H "Content-Type: application/json")
pass=0; fail=0
expect() { if echo "$2" | grep -q "$3"; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1: $2"; fail=$((fail+1)); fi; }
expect "account inquiry mapped"   "$(curl -s "${H[@]}" localhost:8082/api/accounts)" '"available":990.25'
expect "EFX error surfaced"       "$(curl -s "${H[@]}" localhost:8082/api/accounts)" 'Account not found (EFX 1120)'
expect "history mapped"           "$(curl -s "${H[@]}" 'localhost:8082/api/accounts/acc-1/transactions?days=30')" '"amount":-12.34'
expect "transfer accepted"        "$(curl -s "${H[@]}" -H 'Idempotency-Key: c1' -d '{"fromId":"acc-1","toId":"acc-2","amount":5}' localhost:8082/api/transfers/internal)" '"coreStatusCode":"Valid"'
expect "plaid link token"         "$(curl -s "${H[@]}" -X POST localhost:8082/api/plaid/link-token)" 'link-sandbox-abc'
expect "plaid sandbox link"       "$(curl -s "${H[@]}" -X POST localhost:8082/api/plaid/sandbox-link)" '"accountCount":1'
EXT=$(curl -s "${H[@]}" localhost:8082/api/plaid/accounts | python3 -c "import json,sys; print(json.load(sys.stdin)['accounts'][0]['id'])")
expect "plaid auth + funding"     "$(curl -s "${H[@]}" -H 'Idempotency-Key: c2' -d "{\"externalId\":\"$EXT\",\"toId\":\"acc-1\",\"amount\":50}" localhost:8082/api/transfers/external)" 'PENDING_ACH_SIMULATED'
echo "== $pass passed, $fail failed"
[ "$fail" -eq 0 ]
