"""Contract fakes: Banking Hub on :9101, Plaid on :9102. They REJECT anything that deviates from the
documented request shapes, so passing tests mean the Java live transports send what Fiserv/Plaid expect."""
import base64, json, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KEY, SECRET, ORG = "test-key", "test-secret", "PRMOrg10"
TOKEN = "fake-bearer-123"
log = []

def ok(**body):
    return {"Status": {"StatusCode": "0", "StatusDesc": "Success", "Severity": "Info", "SvcProviderName": "Premier"}, **body}

class Fiserv(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0)); raw = self.rfile.read(n).decode()
        if self.path == "/fts-apim/oauth2/v2":
            expect = "Basic " + base64.b64encode(f"{KEY}:{SECRET}".encode()).decode()
            ctype = self.headers.get("Content-Type", "")
            if self.headers.get("Authorization") != expect: return self.send(401, {"error": "bad basic auth"})
            if not ctype.startswith("application/x-www-form-urlencoded") or raw != "grant_type=client_credentials":
                return self.send(400, {"error": "bad token body", "got": raw, "ctype": ctype})
            log.append("token"); return self.send(200, {"access_token": TOKEN, "expires_in": "899000", "token_type": "Bearer"})
        if self.headers.get("Authorization") != "Bearer " + TOKEN: return self.send(401, {"error": "bad bearer"})
        try:
            efx = json.loads(self.headers.get("EFXHeader", ""))
        except Exception:
            return self.send(400, ok() | {"Status": {"Severity": "Error", "StatusCode": "400", "StatusDesc": "EFXHeader missing or not JSON"}})
        if efx.get("OrganizationId") != ORG or not efx.get("TrnId"):
            return self.send(400, {"Status": {"Severity": "Error", "StatusCode": "400", "StatusDesc": "EFXHeader.OrganizationId wrong"}})
        body = json.loads(raw)
        log.append(self.path)
        if self.path == "/banking/efx/v1/acctservice/acctmgmt/accounts/secured":
            k = body["AcctSel"]["AcctKeys"]
            if k["AcctId"] == "000BAD":
                return self.send(200, {"Status": {"StatusCode": "1120", "StatusDesc": "Account not found", "Severity": "Error", "SvcProviderName": "Premier"}})
            return self.send(200, ok(AcctRec={"AcctKeys": k, "DepositAcctInfo": {"Nickname": "From Fiserv", "ProductIdent": "SAV",
                "AcctBal": [{"BalType": "Ledger", "CurAmt": {"Amt": 1000.25}}, {"BalType": "Avail", "CurAmt": {"Amt": 990.25}}]},
                "AcctStatus": {"AcctStatusCode": "Open"}}))
        if self.path == "/banking/efx/v1/accttranservice/acctmgmt/acctTrn/secured":
            assert "AcctTrnSel" in body and "RecCtrlIn" in body
            return self.send(200, ok(RecCtrlOut={"SentRecCount": 1}, AcctTrnRec=[{"AcctTrnKeys": {"AcctTrnIdent": "77"},
                "AcctTrnInfo": {"DrCrType": "Debit", "PostedDt": "2026-10-18", "TrnAmt": {"Amt": 12.34}, "Desc": ["COFFEE"], "MemoPostInd": False}}]))
        if self.path == "/banking/efx/v1/xferservice/payments/transfers":
            x = body["XferInfo"]
            assert x["FromAcctRef"]["AcctKeys"]["AcctId"] and x["CurAmt"]["Amt"] > 0
            return self.send(201, ok(XferStatusRec={"XferKeys": {"AcctKeys": x["FromAcctRef"]["AcctKeys"]},
                "XferStatus": {"XferStatusCode": "Valid", "EffDt": "2026-10-19"}}))
        return self.send(404, {"Status": {"Severity": "Error", "StatusCode": "404", "StatusDesc": "unknown path " + self.path}})

class Plaid(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        if body.get("client_id") != "pc-id" or body.get("secret") != "pc-secret":
            return self.send(400, {"error_type": "INVALID_INPUT", "error_code": "INVALID_API_KEYS", "error_message": "bad keys", "display_message": None})
        if self.headers.get("Plaid-Version") != "2020-09-14": return self.send(400, {"error_code": "BAD_VERSION", "error_message": "missing version"})
        log.append("plaid" + self.path)
        p = self.path
        if p == "/link/token/create":
            assert body["user"]["client_user_id"] and body["products"] == ["auth"] and body["country_codes"] == ["US"]
            return self.send(200, {"link_token": "link-sandbox-abc", "expiration": "2026-10-20T06:00:00Z"})
        if p == "/sandbox/public_token/create":
            assert body["institution_id"] == "ins_109508"
            return self.send(200, {"public_token": "public-sandbox-xyz"})
        if p == "/item/public_token/exchange":
            if body["public_token"] != "public-sandbox-xyz":
                return self.send(400, {"error_code": "INVALID_PUBLIC_TOKEN", "error_message": "bad", "display_message": None})
            return self.send(200, {"access_token": "access-sandbox-1", "item_id": "item-1"})
        accts = [{"account_id": "a1", "name": "Plaid Checking", "mask": "0000", "subtype": "checking", "balances": {"available": 100, "current": 110}}]
        if p == "/accounts/balance/get":
            return self.send(200, {"accounts": accts, "item": {"item_id": "item-1"}})
        if p == "/auth/get":
            assert body["options"]["account_ids"] == ["a1"]
            return self.send(200, {"accounts": accts, "numbers": {"ach": [{"account_id": "a1", "account": "1111222233330000", "routing": "011401533"}]}})
        return self.send(400, {"error_code": "NOT_FOUND", "error_message": p})

if __name__ == "__main__":
    f = ThreadingHTTPServer(("127.0.0.1", 9101), Fiserv)
    pl = ThreadingHTTPServer(("127.0.0.1", 9102), Plaid)
    threading.Thread(target=pl.serve_forever, daemon=True).start()
    print("fakes up", flush=True)
    f.serve_forever()
