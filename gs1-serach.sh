#!/usr/bin/env bash
set -Eeuo pipefail

# gs1-search.sh
# Usage:
#   ./gs1-search.sh "urn:epc:id:sgtin:5940405.342100.783477617"
# Env:
#   HUB=http://localhost:8080
#   NET=testnet|mainnet   (optional; sent as ?network=...)
#   FULL=1                (optional; default 1)

HUB="${HUB:-http://localhost:8080}"
NET="${NET:-}"
FULL="${FULL:-1}"

INPUT="${1:-}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1" >&2; exit 1; }; }
need curl

HAS_JQ=0
if command -v jq >/dev/null 2>&1; then HAS_JQ=1; fi

trap 'echo "ERROR line $LINENO: $BASH_COMMAND" >&2' ERR

qs() {
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
    # fallback minimale: non perfetto ma evita crash
    echo "$s"
  fi
}

# fallback: se non passi argomento, prova .gs1_last.json (epcUri)
if [ -z "$INPUT" ] && [ "$HAS_JQ" -eq 1 ] && [ -f .gs1_last.json ]; then
  INPUT="$(jq -r '.epcUri // empty' .gs1_last.json)"
fi

if [ -z "$INPUT" ]; then
  echo "Usage: $0 \"urn:epc:id:...\"  (or have .gs1_last.json + jq)" >&2
  exit 1
fi

# Determine resource objectId
RID=""
if [[ "$INPUT" =~ ^0x[0-9a-fA-F]+$ ]]; then
  RID="$INPUT"
  EPC=""
else
  EPC="$INPUT"
  ENC_EPC="$(urlenc "$EPC")"
  Q="$(qs)"
  if [ -n "$Q" ]; then Q="${Q}&epcUri=${ENC_EPC}"; else Q="epcUri=${ENC_EPC}"; fi

  URL_RESOLVE="$(join_q "$HUB/twin/resolve" "$Q")"
  echo "==> GET $URL_RESOLVE" >&2
  RESOLVE_JSON="$(curl -sS "$URL_RESOLVE")"

  if [ "$HAS_JQ" -eq 1 ]; then
    RID="$(echo "$RESOLVE_JSON" | jq -r '.objectId // empty')"
  else
    RID="$(echo "$RESOLVE_JSON" | sed -n 's/.*"objectId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  fi

  if [ -z "$RID" ]; then
    echo "Resolve failed. Response:" >&2
    echo "$RESOLVE_JSON" >&2
    exit 1
  fi
fi

echo "HUB=$HUB"
echo "NET=${NET:-"(default)"}"
echo "GS1_INPUT=$INPUT"
echo "RESOURCE_OBJECT_ID=$RID"
echo

# 1) Resource
URL_RES="$(join_q "$HUB/twin/$RID" "$(qs)")"
echo "==> GET $URL_RES" >&2
RES="$(curl -sS "$URL_RES")"
if [ "$HAS_JQ" -eq 1 ]; then echo "$RES" | jq .; else echo "$RES"; fi

echo
# 2) Events
Q="$(qs)"
if [ "$FULL" = "1" ] || [ "$FULL" = "true" ]; then
  if [ -n "$Q" ]; then Q="${Q}&full=1"; else Q="full=1"; fi
fi

URL_EVT="$(join_q "$HUB/twin/$RID/events" "$Q")"
echo "==> GET $URL_EVT" >&2
EVT="$(curl -sS "$URL_EVT")"
if [ "$HAS_JQ" -eq 1 ]; then echo "$EVT" | jq .; else echo "$EVT"; fi