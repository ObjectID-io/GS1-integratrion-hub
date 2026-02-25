#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OPENAPI_DIR="$ROOT_DIR/openapi"
OUT_DIR="$ROOT_DIR/src/generated"

mkdir -p "$OPENAPI_DIR" "$OUT_DIR"

OPENAPI_URL="https://raw.githubusercontent.com/gs1/EPCIS/master/REST%20Bindings/openapi.yaml"
OPENAPI_FILE="$OPENAPI_DIR/epcis-openapi.yaml"

echo "Downloading EPCIS OpenAPI..."
curl -L "$OPENAPI_URL" -o "$OPENAPI_FILE"

echo "Generating TypeScript types..."
# openapi-typescript outputs a .d.ts file
npx openapi-typescript "$OPENAPI_FILE" -o "$OUT_DIR/epcis-openapi.d.ts"

echo "Done: $OUT_DIR/epcis-openapi.d.ts"
