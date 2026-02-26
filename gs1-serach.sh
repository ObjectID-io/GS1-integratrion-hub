#!/usr/bin/env bash
set -Eeuo pipefail

# gs1-search.sh
# Usage:
#   ./gs1-search.sh "<GS1 resource id>"     e.g. "urn:epc:id:sgtin:5940405.342100.783477617"
#   ./gs1-search.sh "0x<resourceObjectId>"  also works (hub accepts both)
#
# Env:
#   HUB=http://localhost:8080
#   NET=testnet|mainnet   (optional; sent as ?network=...)
#   FULL=1                (optional; default 1 => returns full event objects)
#
# Requires: curl (jq optional)

HUB="${HUB:-http://localhost:8080}"
NET="${NET:-}"
FULL="${FULL:-1}"

INPUT="${1:-}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1" >&2; exit 1; }; }
need curl

HAS_JQ=0
if command -v jq >/dev/null 2>&1; then HAS_JQ=1; fi

trap 'echo "ERROR line $LINENO: $BASH_COMMAND" >&2' ERR

qs_base() {
  if [ -n "${NET:-}" ]; then
    echo "network=$NET"
  else
    echo ""
  fi
}

join_q() {
  local base="$1"
  local q="$2"
  if [ -z "$q" ]; then
    echo "$base"
  elif [[ "$base" == *\?* ]]; then
    echo "${base}&${q}"
  else
    echo "${base}?${q}"
  fi
}

urlenc() {
  local s="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<PY
import urllib.parse
print(urllib.parse.quote("""$s""", safe=""))
PY
  elif command -v node >/dev/null 2>&1; then
    node - <<NODE
console.log(encodeURIComponent(${s@Q}));
NODE
  elif [ "$HAS_JQ" -eq 1 ]; then
    printf '%s' "$s" | jq -sRr @uri
  else
    # minimal fallback
    echo "$s"
  fi
}

# if no arg, try .gs1_last.json (epcUri)
if [ -z "$INPUT" ] && [ "$HAS_JQ" -eq 1 ] && [ -f .gs1_last.json ]; then
  INPUT="$(jq -r '.epcUri // empty' .gs1_last.json)"
fi

if [ -z "$INPUT" ]; then
  echo "Usage: $0 \"urn:epc:id:...\"  (or have .gs1_last.json + jq)" >&2
  exit 1
fi

ENC_INPUT="$(urlenc "$INPUT")"
Q="$(qs_base)"

echo "HUB=$HUB"
echo "NET=${NET:-"(default)"}"
echo "GS1_INPUT=$INPUT"
echo

# 1) Resource (hub accepts either objectId or GS1 id)
URL_RES="$(join_q "$HUB/twin/$ENC_INPUT" "$Q")"
echo "==> GET $URL_RES" >&2
RES="$(curl -sS "$URL_RES")"
if [ "$HAS_JQ" -eq 1 ]; then echo "$RES" | jq .; else echo "$RES"; fi

echo
# 2) Events (hub accepts either objectId or GS1 id)
QEVT="$Q"
if [ "$FULL" = "1" ] || [ "$FULL" = "true" ]; then
  if [ -n "$QEVT" ]; then QEVT="${QEVT}&full=1"; else QEVT="full=1"; fi
fi

URL_EVT="$(join_q "$HUB/twin/$ENC_INPUT/events" "$QEVT")"
echo "==> GET $URL_EVT" >&2
EVT="$(curl -sS "$URL_EVT")"
if [ "$HAS_JQ" -eq 1 ]; then echo "$EVT" | jq .; else echo "$EVT"; fi