#!/usr/bin/env bash
set -Eeuo pipefail

HUB="${HUB:-http://localhost:8080}"
NET="${NET:-}" # opzionale: testnet|mainnet (se il tuo hub lo usa via query)

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1" >&2; exit 1; }; }
need curl

HAS_JQ=0
if command -v jq >/dev/null 2>&1; then HAS_JQ=1; fi

trap 'echo "ERROR line $LINENO: $BASH_COMMAND" >&2' ERR

qs() {
  if [ -n "${NET:-}" ]; then
    echo "?network=$NET"
  else
    echo ""
  fi
}

rand_digits() {
  local n="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<PY
import secrets, string
n=int("$n")
print("".join(secrets.choice(string.digits) for _ in range(n)))
PY
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    node - <<NODE
const n = Number("$n");
let out = "";
for (let i=0;i<n;i++) out += Math.floor(Math.random()*10).toString();
console.log(out);
NODE
    return 0
  fi
  # fallback senza pipe/head: usa od e filtra (non perfetto ma evita SIGPIPE)
  od -An -N64 -tu1 /dev/urandom | tr -dc '0-9' | awk -v n="$n" '{s=s$0} END{print substr(s,1,n)}'
}

uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  elif command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
  else
    node - <<'NODE'
console.log(require('crypto').randomUUID())
NODE
  fi
}

curl_json() {
  local method="$1"; shift
  local url="$1"; shift
  local body tmp
  tmp="$(mktemp)"
  # non usare -f: vogliamo vedere il body anche in errore
  local code
  code="$(curl -sS -X "$method" -H "Content-Type: application/json" -o "$tmp" -w "%{http_code}" "$url" "$@")"
  body="$(cat "$tmp")"
  rm -f "$tmp"

  echo "$code" >&2
  printf "%s" "$body"
}

# --------- MAIN ---------
COMPANY_PREFIX="$(rand_digits 7)"
ITEM_REF="$(rand_digits 6)"
SERIAL="$(rand_digits 9)"
EPC_URI="urn:epc:id:sgtin:${COMPANY_PREFIX}.${ITEM_REF}.${SERIAL}"

EVENT_ID="$(uuid)"
EVENT_TIME="$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')"

echo "HUB=$HUB"
echo "NET=${NET:-"(default)"}"
echo "EPC_URI=$EPC_URI"
echo

# 1) Create / register GS1 twin
echo "==> Creating twin..."
RESP_TWIN="$(
  curl -sS -X POST "$HUB/twin$(qs)" \
    -H "Content-Type: application/json" \
    --data-binary @- <<JSON
{
  "epcUri": "$EPC_URI",
  "immutable": {
    "brand_owner_gln": "$(rand_digits 13)",
    "digital_link_uri": "https://example.com/dl/$SERIAL"
  },
  "mutablePatch": {
    "note": "created by gs1.sh"
  }
}
JSON
)"

if [ "$HAS_JQ" -eq 1 ]; then
  OBJECT_ID="$(echo "$RESP_TWIN" | jq -r '.objectId // empty')"
  ALREADY="$(echo "$RESP_TWIN" | jq -r '.alreadyRegistered // false')"
else
  OBJECT_ID="$(echo "$RESP_TWIN" | sed -n 's/.*"objectId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  ALREADY="?"
fi

if [ -z "${OBJECT_ID:-}" ]; then
  echo "Failed to create/resolve twin. Response:" >&2
  echo "$RESP_TWIN" >&2
  exit 1
fi

echo "GS1_RESOURCE_OBJECT_ID=$OBJECT_ID (alreadyRegistered=$ALREADY)"
echo

# 2) Append EPCIS ObjectEvent via /capture
echo "==> Capturing event..."
RESP_CAP="$(
  curl -sS -X POST "$HUB/capture$(qs)" \
    -H "Content-Type: application/json" \
    --data-binary @- <<JSON
{
  "eventList": [
    {
      "type": "ObjectEvent",
      "eventTime": "$EVENT_TIME",
      "eventTimeZoneOffset": "+00:00",
      "eventID": "$EVENT_ID",
      "action": "ADD",
      "bizStep": "urn:epcglobal:cbv:bizstep:commissioning",
      "disposition": "urn:epcglobal:cbv:disp:active",
      "epcList": ["$EPC_URI"],
      "readPoint": { "id": "urn:epc:id:sgln:${COMPANY_PREFIX}.00000.0" },
      "bizLocation": { "id": "urn:epc:id:sgln:${COMPANY_PREFIX}.00000.0" },
      "ilmd": { "note": "event from gs1.sh" }
    }
  ]
}
JSON
)"

if [ "$HAS_JQ" -eq 1 ]; then
  EVENT_OBJ_ID="$(echo "$RESP_CAP" | jq -r '.results[0].eventObjectId // empty')"
  TX_ID="$(echo "$RESP_CAP" | jq -r '.results[0].txId // empty')"
else
  EVENT_OBJ_ID=""
  TX_ID=""
fi

echo "GS1_EVENT_OBJECT_ID=${EVENT_OBJ_ID:-}"
echo "TX_ID=${TX_ID:-}"
echo

if [ "$HAS_JQ" -eq 1 ]; then
  echo "$RESP_CAP" | jq .
else
  echo "$RESP_CAP"
fi

cat > .gs1_last.json <<JSON
{
  "hub": "$HUB",
  "network": "${NET:-""}",
  "epcUri": "$EPC_URI",
  "resourceObjectId": "$OBJECT_ID",
  "eventId": "$EVENT_ID",
  "eventTime": "$EVENT_TIME",
  "eventObjectId": "${EVENT_OBJ_ID:-}",
  "txId": "${TX_ID:-}"
}
JSON

echo
echo "Saved: .gs1_last.json"