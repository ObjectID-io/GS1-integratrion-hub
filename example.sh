#!/usr/bin/env bash
set -euo pipefail

HUB="http://localhost:8080"
NET="testnet"   # testnet | mainnet

EPC_URI="urn:epc:id:sgtin:0614141.112345.401"
GTIN="00614141123458"
SERIAL="401"
BRAND_OWNER_GLN="0614141073463"

# 1) CREA UNA GS1 RESOURCE (DIGITAL TWIN)
CREATE_RES=$(
  curl -sS -X POST "$HUB/twin?network=$NET" \
    -H "Content-Type: application/json" \
    -d "{
      \"epcUri\": \"${EPC_URI}\",
      \"immutable\": {
        \"gtin\": \"${GTIN}\",
        \"serial_number\": \"${SERIAL}\",
        \"brand_owner_gln\": \"${BRAND_OWNER_GLN}\"
      },
      \"mutablePatch\": {
        \"note\": \"created by GS1 integration hub\"
      }
    }"
)

echo "CREATE_RES=$CREATE_RES"

# Prova ad estrarre resourceId/id dal JSON (adatta i campi se il tuo output è diverso)
RESOURCE_ID=$(echo "$CREATE_RES" | jq -r '.resourceId // .resource_id // .id // .objectId // empty')
if [[ -z "${RESOURCE_ID}" ]]; then
  echo "ERRORE: non riesco a ricavare RESOURCE_ID dalla response. Stampa sopra e adatta il jq."
  exit 1
fi
echo "RESOURCE_ID=$RESOURCE_ID"

# 2) AGGIUNGI UN EVENTO EPCIS (ObjectEvent di esempio)
curl -sS -X POST "$HUB/twin/event?network=$NET" \
  -H "Content-Type: application/json" \
  -d "{
    \"resourceId\": \"${RESOURCE_ID}\",
    \"event\": {
      \"type\": \"ObjectEvent\",
      \"eventTime\": \"2026-02-26T10:15:30.000Z\",
      \"eventTimeZoneOffset\": \"+01:00\",
      \"action\": \"OBSERVE\",
      \"bizStep\": \"urn:epcglobal:cbv:bizstep:shipping\",
      \"disposition\": \"urn:epcglobal:cbv:disp:in_transit\",
      \"epcList\": [\"${EPC_URI}\"],
      \"readPoint\": { \"id\": \"urn:epc:id:sgln:0614141.07346.1234\" },
      \"bizLocation\": { \"id\": \"urn:epc:id:sgln:0614141.07346.0\" }
    }
  }" | jq .

# 3) LEGGI LA RISORSA (due varianti comuni)

# 3a) by resourceId (REST style)
curl -sS "$HUB/twin/${RESOURCE_ID}?network=$NET" | jq .

# 3b) by epcUri (query style)
curl -sS --get "$HUB/twin" --data-urlencode "network=$NET" --data-urlencode "epcUri=$EPC_URI" | jq .

# 4) LEGGI GLI EVENTI (due varianti comuni)

# 4a) eventi by resourceId (REST style)
curl -sS "$HUB/twin/${RESOURCE_ID}/events?network=$NET" | jq .

# 4b) eventi by epcUri (query style)
curl -sS --get "$HUB/twin/events" --data-urlencode "network=$NET" --data-urlencode "epcUri=$EPC_URI" | jq .


