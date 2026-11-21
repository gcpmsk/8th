#!/usr/bin/env bash
# Dograh के मौजूदा 5 agents को नई JSON से "जगह पर" update + publish करता है.
# फ़ायदा: Agent ID / UUID नहीं बदलते -> App Settings और Inbound workflow दोबारा नहीं भरना.
#
# इस्तेमाल (Termux / Linux / Mac):
#   export DOGRAH_URL="https://140-245-7-25.sslip.io"
#   export DOGRAH_KEY="<Dograh API key>"
#   export HOOK_URL="https://n8n.satyamgold.com/webhook/sg-call?k=<असली hook key>"
#   export ID_OUT=13 ID_IN=20 ID_NEW=16 ID_SUP=17 ID_ALERT=18     # Voice Agents list का पहला नंबर
#   bash scripts/dograh-update.sh
#
# कोई step fail हो तो HTTP code + जवाब दिखता है. Dograh के UI में कुछ नहीं बिगड़ता.
set -u
: "${DOGRAH_URL:?DOGRAH_URL भरें}" "${DOGRAH_KEY:?DOGRAH_KEY भरें}" "${HOOK_URL:?HOOK_URL भरें}"
cd "$(dirname "$0")/.."
H=(-H "X-API-Key: $DOGRAH_KEY" -H "Content-Type: application/json")
CURL=(curl -sk --max-time 60)

upd() {  # $1=ID  $2=file
  local id="$1" f="$2"
  [ -z "$id" ] && { echo "SKIP $f (ID नहीं दिया)"; return; }
  echo "== $f -> agent #$id"
  python3 - "$f" "$HOOK_URL" > /tmp/dg_body.json <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
s=json.dumps(d,ensure_ascii=False).replace('https://n8n.satyamgold.com/webhook/sg-call?k=REPLACE_HOOK_KEY',sys.argv[2])
print(s)
PY
  "${CURL[@]}" -o /dev/null -w "  draft:   HTTP %{http_code}\n" -X POST "${H[@]}" "$DOGRAH_URL/api/v1/workflow/$id/create-draft"
  "${CURL[@]}" -o /tmp/dg_put.txt -w "  update:  HTTP %{http_code}\n" -X PUT "${H[@]}" --data @/tmp/dg_body.json "$DOGRAH_URL/api/v1/workflow/$id"
  "${CURL[@]}" -o /tmp/dg_pub.txt -w "  publish: HTTP %{http_code}\n" -X POST "${H[@]}" --data '{"version_name":"v2 call-end fix","change_description":"End Call fix"}' "$DOGRAH_URL/api/v1/workflow/$id/publish"
  grep -q '"detail"' /tmp/dg_put.txt /tmp/dg_pub.txt 2>/dev/null && { echo "  ⚠️ जवाब:"; head -c 400 /tmp/dg_put.txt; echo; head -c 400 /tmp/dg_pub.txt; echo; }
}
upd "${ID_OUT:-}"   dograh/1-outgoing-customer.json
upd "${ID_IN:-}"    dograh/2-incoming-all.json
upd "${ID_NEW:-}"   dograh/3-new-customer-lead.json
upd "${ID_SUP:-}"   dograh/4-wheat-supplier.json
upd "${ID_ALERT:-}" dograh/5-owner-stock-alert.json
echo "पूरा. Dograh -> Voice Agents में हर agent खोलकर एक बार जाँच लें कि Published दिख रहा है."
