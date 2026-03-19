#!/usr/bin/env bash
set -Eeuo pipefail

# gs1-search.sh
# Interactive GS1 helper:
# - resource details
# - events details
# - create resource
# - create event
#
# Env:
#   HUB=http://localhost:8080
#   NET=testnet|mainnet   (optional; sent as ?network=...)
#   FULL=1                (optional; default 1 => returns full event objects)

HUB="${HUB:-http://localhost:8080}"
NET="${NET:-}"
FULL="${FULL:-1}"

INPUT="${1:-}"
LAST_JSON_FILE="last.json"
LEGACY_LAST_JSON_FILE=".gs1_last.json"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1" >&2; exit 1; }; }
need curl

HAS_JQ=0
if command -v jq >/dev/null 2>&1; then HAS_JQ=1; fi

trap 'echo "ERROR line $LINENO: $BASH_COMMAND" >&2' ERR

contains_word() {
  local value="$1"
  shift
  local item
  for item in "$@"; do
    if [ "$item" = "$value" ]; then
      return 0
    fi
  done
  return 1
}

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
    echo "$s"
  fi
}

print_json() {
  local payload="$1"
  if [ "$HAS_JQ" -eq 1 ]; then
    echo "$payload" | jq .
  else
    echo "$payload"
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

active_last_file() {
  if [ -f "$LAST_JSON_FILE" ]; then
    echo "$LAST_JSON_FILE"
  elif [ -f "$LEGACY_LAST_JSON_FILE" ]; then
    echo "$LEGACY_LAST_JSON_FILE"
  else
    echo ""
  fi
}

read_json_field() {
  local file="$1"
  local key="$2"
  if [ ! -f "$file" ]; then
    echo ""
    return 0
  fi

  if [ "$HAS_JQ" -eq 1 ]; then
    jq -r ".${key} // empty" "$file"
    return 0
  fi

  sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$file" | head -n 1
}

write_last_json() {
  local epc_uri="$1"
  local resource_object_id="$2"
  local event_id="$3"
  local event_time="$4"
  local event_object_id="$5"
  local tx_id="$6"
  local network_value="${NET:-}"

  cat > "$LAST_JSON_FILE" <<JSON
{
  "hub": "$HUB",
  "network": "$network_value",
  "epcUri": "$epc_uri",
  "resourceObjectId": "$resource_object_id",
  "eventId": "$event_id",
  "eventTime": "$event_time",
  "eventObjectId": "$event_object_id",
  "txId": "$tx_id"
}
JSON

  cat > "$LEGACY_LAST_JSON_FILE" <<JSON
{
  "hub": "$HUB",
  "network": "$network_value",
  "epcUri": "$epc_uri",
  "resourceObjectId": "$resource_object_id",
  "eventId": "$event_id",
  "eventTime": "$event_time",
  "eventObjectId": "$event_object_id",
  "txId": "$tx_id"
}
JSON
}

extract_company_prefix() {
  local epc="$1"
  local rest
  if [[ "$epc" == urn:epc:id:sgtin:* ]]; then
    rest="${epc#urn:epc:id:sgtin:}"
    echo "${rest%%.*}"
  else
    echo "$(rand_digits 7)"
  fi
}

fetch_resource() {
  local input="$1"
  local enc_input q url_res res
  enc_input="$(urlenc "$input")"
  q="$(qs_base)"
  url_res="$(join_q "$HUB/twin/$enc_input" "$q")"
  echo "==> GET $url_res" >&2
  res="$(curl -sS "$url_res")"
  print_json "$res"
}

fetch_events() {
  local input="$1"
  local enc_input qevt q url_evt evt
  enc_input="$(urlenc "$input")"
  q="$(qs_base)"
  qevt="$q"
  if [ "$FULL" = "1" ] || [ "$FULL" = "true" ]; then
    if [ -n "$qevt" ]; then qevt="${qevt}&full=1"; else qevt="full=1"; fi
  fi
  url_evt="$(join_q "$HUB/twin/$enc_input/events" "$qevt")"
  echo "==> GET $url_evt" >&2
  evt="$(curl -sS "$url_evt")"
  print_json "$evt"
}

create_resource_interactive() {
  local company_prefix item_ref serial default_epc epc_uri
  local default_gln brand_owner_gln default_dl digital_link_uri note mutable_note
  local q url body response object_id already_registered
  local prev_file prev_event_id prev_event_time prev_event_object_id prev_tx_id

  company_prefix="$(rand_digits 7)"
  item_ref="$(rand_digits 6)"
  serial="$(rand_digits 9)"
  default_epc="urn:epc:id:sgtin:${company_prefix}.${item_ref}.${serial}"
  default_gln="$(rand_digits 13)"
  default_dl="https://example.com/dl/${serial}"

  echo "Resource creation"
  read -r -p "EPC URI [$default_epc]: " epc_uri
  epc_uri="${epc_uri:-$default_epc}"

  read -r -p "Brand owner GLN [$default_gln]: " brand_owner_gln
  brand_owner_gln="${brand_owner_gln:-$default_gln}"

  read -r -p "Digital Link URI [$default_dl]: " digital_link_uri
  digital_link_uri="${digital_link_uri:-$default_dl}"

  note="created by gs1-search.sh"
  read -r -p "Mutable note [$note]: " mutable_note
  mutable_note="${mutable_note:-$note}"

  q="$(qs_base)"
  url="$(join_q "$HUB/twin" "$q")"
  body="$(cat <<JSON
{
  "epcUri": "$epc_uri",
  "immutable": {
    "brand_owner_gln": "$brand_owner_gln",
    "digital_link_uri": "$digital_link_uri"
  },
  "mutablePatch": {
    "note": "$mutable_note"
  }
}
JSON
)"

  echo
  echo "==> POST $url" >&2
  response="$(curl -sS -X POST "$url" -H "Content-Type: application/json" --data-binary "$body")"
  print_json "$response"

  object_id=""
  already_registered="false"
  if [ "$HAS_JQ" -eq 1 ]; then
    object_id="$(echo "$response" | jq -r '.objectId // empty')"
    already_registered="$(echo "$response" | jq -r '.alreadyRegistered // false')"
  else
    object_id="$(echo "$response" | sed -n 's/.*"objectId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  fi

  prev_file="$(active_last_file)"
  prev_event_id=""
  prev_event_time=""
  prev_event_object_id=""
  prev_tx_id=""
  if [ -n "$prev_file" ]; then
    prev_event_id="$(read_json_field "$prev_file" "eventId")"
    prev_event_time="$(read_json_field "$prev_file" "eventTime")"
    prev_event_object_id="$(read_json_field "$prev_file" "eventObjectId")"
    prev_tx_id="$(read_json_field "$prev_file" "txId")"
  fi

  write_last_json "$epc_uri" "$object_id" "$prev_event_id" "$prev_event_time" "$prev_event_object_id" "$prev_tx_id"
  INPUT="$epc_uri"

  echo
  echo "Resource created/resolved: objectId=${object_id:-"(not found in response)"} alreadyRegistered=$already_registered"
  echo "State saved in: $LAST_JSON_FILE (and compatibility copy $LEGACY_LAST_JSON_FILE)"
  echo
  echo "Equivalent curl:"
  echo "curl -sS -X POST \"$url\" -H \"Content-Type: application/json\" --data-binary @- <<'JSON'"
  echo "$body"
  echo "JSON"
}

create_event_interactive() {
  local epc_default_file epc_uri_default epc_uri
  local event_id_default event_id event_time_default event_time
  local action_default action biz_step_default biz_step disposition_default disposition
  local action_options biz_step_options disposition_options
  local company_prefix read_point_default read_point biz_location_default biz_location
  local ilmd_note_default ilmd_note
  local q url body response event_object_id tx_id
  local prev_file prev_resource_object_id

  epc_default_file="$LAST_JSON_FILE"
  if [ ! -f "$epc_default_file" ] && [ -f "$LEGACY_LAST_JSON_FILE" ]; then
    epc_default_file="$LEGACY_LAST_JSON_FILE"
  fi

  epc_uri_default=""
  if [ -f "$epc_default_file" ]; then
    epc_uri_default="$(read_json_field "$epc_default_file" "epcUri")"
  fi
  if [ -z "$epc_uri_default" ] && [ -n "$INPUT" ]; then
    epc_uri_default="$INPUT"
  fi

  if [ -n "$epc_uri_default" ]; then
    echo "Event creation (resource suggested from $epc_default_file: $epc_uri_default)"
    read -r -p "EPC URI [$epc_uri_default]: " epc_uri
    epc_uri="${epc_uri:-$epc_uri_default}"
  else
    echo "Event creation"
    read -r -p "Resource EPC URI: " epc_uri
  fi

  if [ -z "$epc_uri" ]; then
    echo "EPC URI is required to create an event." >&2
    return 1
  fi

  event_id_default="$(uuid)"
  event_time_default="$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')"
  action_default="ADD"
  biz_step_default="urn:epcglobal:cbv:bizstep:commissioning"
  disposition_default="urn:epcglobal:cbv:disp:active"
  action_options=(ADD OBSERVE DELETE)
  biz_step_options=(
    urn:epcglobal:cbv:bizstep:commissioning
    urn:epcglobal:cbv:bizstep:shipping
    urn:epcglobal:cbv:bizstep:receiving
    urn:epcglobal:cbv:bizstep:storing
  )
  disposition_options=(
    urn:epcglobal:cbv:disp:active
    urn:epcglobal:cbv:disp:in_transit
    urn:epcglobal:cbv:disp:in_progress
    urn:epcglobal:cbv:disp:inactive
  )
  company_prefix="$(extract_company_prefix "$epc_uri")"
  read_point_default="urn:epc:id:sgln:${company_prefix}.00000.0"
  biz_location_default="$read_point_default"
  ilmd_note_default="event from gs1-search.sh"

  read -r -p "Event ID [$event_id_default]: " event_id
  event_id="${event_id:-$event_id_default}"
  read -r -p "Event time UTC [$event_time_default]: " event_time
  event_time="${event_time:-$event_time_default}"

  echo "Allowed Action values: ADD, OBSERVE, DELETE"
  while true; do
    read -r -p "Action [$action_default]: " action
    action="${action:-$action_default}"
    if contains_word "$action" "${action_options[@]}"; then
      break
    fi
    echo "Invalid Action. Allowed: ADD, OBSERVE, DELETE"
  done

  echo "Suggested BizStep values:"
  echo "  - urn:epcglobal:cbv:bizstep:commissioning"
  echo "  - urn:epcglobal:cbv:bizstep:shipping"
  echo "  - urn:epcglobal:cbv:bizstep:receiving"
  echo "  - urn:epcglobal:cbv:bizstep:storing"
  while true; do
    read -r -p "BizStep [$biz_step_default]: " biz_step
    biz_step="${biz_step:-$biz_step_default}"
    if contains_word "$biz_step" "${biz_step_options[@]}"; then
      break
    fi
    echo "BizStep not in suggested list. Press Enter to accept default, or type one of the suggested values."
  done

  echo "Suggested Disposition values:"
  echo "  - urn:epcglobal:cbv:disp:active"
  echo "  - urn:epcglobal:cbv:disp:in_transit"
  echo "  - urn:epcglobal:cbv:disp:in_progress"
  echo "  - urn:epcglobal:cbv:disp:inactive"
  while true; do
    read -r -p "Disposition [$disposition_default]: " disposition
    disposition="${disposition:-$disposition_default}"
    if contains_word "$disposition" "${disposition_options[@]}"; then
      break
    fi
    echo "Disposition not in suggested list. Press Enter to accept default, or type one of the suggested values."
  done

  read -r -p "ReadPoint [$read_point_default]: " read_point
  read_point="${read_point:-$read_point_default}"
  read -r -p "BizLocation [$biz_location_default]: " biz_location
  biz_location="${biz_location:-$biz_location_default}"
  read -r -p "ILMD note [$ilmd_note_default]: " ilmd_note
  ilmd_note="${ilmd_note:-$ilmd_note_default}"

  q="$(qs_base)"
  url="$(join_q "$HUB/capture" "$q")"
  body="$(cat <<JSON
{
  "eventList": [
    {
      "type": "ObjectEvent",
      "eventTime": "$event_time",
      "eventTimeZoneOffset": "+00:00",
      "eventID": "$event_id",
      "action": "$action",
      "bizStep": "$biz_step",
      "disposition": "$disposition",
      "epcList": ["$epc_uri"],
      "readPoint": { "id": "$read_point" },
      "bizLocation": { "id": "$biz_location" },
      "ilmd": { "note": "$ilmd_note" }
    }
  ]
}
JSON
)"

  echo
  echo "==> POST $url" >&2
  response="$(curl -sS -X POST "$url" -H "Content-Type: application/json" --data-binary "$body")"
  print_json "$response"

  event_object_id=""
  tx_id=""
  if [ "$HAS_JQ" -eq 1 ]; then
    event_object_id="$(echo "$response" | jq -r '.results[0].eventObjectId // empty')"
    tx_id="$(echo "$response" | jq -r '.results[0].txId // empty')"
  fi

  prev_file="$(active_last_file)"
  prev_resource_object_id=""
  if [ -n "$prev_file" ]; then
    prev_resource_object_id="$(read_json_field "$prev_file" "resourceObjectId")"
  fi

  write_last_json "$epc_uri" "$prev_resource_object_id" "$event_id" "$event_time" "$event_object_id" "$tx_id"
  INPUT="$epc_uri"

  echo
  echo "Event saved in: $LAST_JSON_FILE (and compatibility copy $LEGACY_LAST_JSON_FILE)"
  echo
  echo "Equivalent curl:"
  echo "curl -sS -X POST \"$url\" -H \"Content-Type: application/json\" --data-binary @- <<'JSON'"
  echo "$body"
  echo "JSON"
}

if [ -z "$INPUT" ]; then
  LAST_FILE="$(active_last_file)"
  SUGGESTED_INPUT=""
  if [ -n "$LAST_FILE" ]; then
    SUGGESTED_INPUT="$(read_json_field "$LAST_FILE" "epcUri")"
    if [ -z "$SUGGESTED_INPUT" ]; then
      SUGGESTED_INPUT="$(read_json_field "$LAST_FILE" "resourceObjectId")"
    fi
  fi

  if [ -n "$SUGGESTED_INPUT" ]; then
    echo "Suggested URI from $LAST_FILE: $SUGGESTED_INPUT"
    read -r -p "Enter resource URI [default: $SUGGESTED_INPUT]: " INPUT
    INPUT="${INPUT:-$SUGGESTED_INPUT}"
  else
    read -r -p "Enter resource URI (you can leave it empty): " INPUT
  fi
fi

echo "HUB=$HUB"
echo "NET=${NET:-"(default)"}"
echo "GS1_INPUT=${INPUT:-"(not set)"}"
echo

while true; do
  echo "What do you want to do?"
  echo "  1) Resource details"
  echo "  2) Event details"
  echo "  3) Both"
  echo "  4) Change URI"
  echo "  5) Create resource (random defaults)"
  echo "  6) Create event (defaults from last.json)"
  echo "  0) Exit"
  read -r -p "Choice [3]: " CHOICE
  CHOICE="${CHOICE:-3}"
  echo

  case "$CHOICE" in
    1)
      if [ -z "$INPUT" ]; then echo "Set a URI first (option 4)." >&2; else fetch_resource "$INPUT"; fi
      ;;
    2)
      if [ -z "$INPUT" ]; then echo "Set a URI first (option 4)." >&2; else fetch_events "$INPUT"; fi
      ;;
    3)
      if [ -z "$INPUT" ]; then
        echo "Set a URI first (option 4)." >&2
      else
        fetch_resource "$INPUT"
        echo
        fetch_events "$INPUT"
      fi
      ;;
    4)
      read -r -p "New resource URI: " NEW_INPUT
      if [ -n "$NEW_INPUT" ]; then
        INPUT="$NEW_INPUT"
        echo "GS1_INPUT updated to: $INPUT"
      else
        echo "URI unchanged."
      fi
      ;;
    5)
      create_resource_interactive
      ;;
    6)
      create_event_interactive
      ;;
    0)
      exit 0
      ;;
    *)
      echo "Invalid choice: $CHOICE"
      ;;
  esac

  echo
done
