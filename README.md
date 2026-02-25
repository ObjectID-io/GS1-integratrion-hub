# integration-hub-gs1

TypeScript/Express hub exposing **GS1 EPCIS 2.0-like REST endpoints** and forwarding events into **ObjectID**.

This version is intentionally **simple and strict**:

- **Mono-tenant**: the hub uses a single ObjectID signer (seed/DID) configured via `.env`.
- **No API key auth**: intended to run inside the customer VPN / private network.
- Calls the **oid_gs1::OIDGs1IHub Move module** directly via `@iota/iota-sdk`.
- **No auto-create on capture**: if an EPCIS event refers to a product twin that was not created/registered, capture returns an error.

## Endpoints

- `POST /twin` (alias `POST /gs1/twin`)
  - Creates (idempotently, via local mapping) a `GS1Resource` and registers it into the shared `GS1Registry`
  - Persists a local mapping `epcUri/sgtin -> resourceId` in `./data/gs1-twins.json`

- `POST /capture` (alias `POST /epcis/capture`)
  - Captures EPCIS events and updates the on-chain `GS1Resource` state:
    - `set_last_event`
    - `update_current_context`
    - `set_parent_sscc` (when present)
  - **Requires** the twin to be already registered via `POST /twin`

- `GET /health`

Optional (disabled by default):

- `GET /debug/signer`
- `GET /debug/owned-objects`

## Quick start

```bash
cp .env.example .env
npm i
npm run dev
```

## Configuration

Required:

- `OID_SEED_HEX`
- `OID_DID`
- `OID_GS1_PACKAGE_ID` (on-chain Move package id)
- `OID_GS1_REGISTRY_ID` (shared `GS1Registry` object id)

Optional:

- `OID_NETWORK` (default `mainnet`)
- `OID_RPC_URL` (if you want to override the RPC URL after bootstrap)
- `OID_PACKAGE_ID` (override the core ObjectID Move package id)
- `GRAPHQL_PROVIDER` (used to discover the credit policy object)
- `OID_CREDIT_POLICY_ID` (skip GraphQL policy discovery)
- `OID_CREDIT_TOKEN_ID` / `OID_CONTROLLER_CAP_ID` (skip owned-object discovery)
- `DATA_DIR` (default `./data`)
- `MAPPING_FILE` (override full path to mapping file)
- `ALLOW_CALLER_DID_HEADER` (default `true`)

### DLVC (linked domain) rule

All write operations require a valid DLVC (linked domain) in the `ControllerCap`.
The Move module checks this on-chain (`linked_domain(cap)` must be non-empty).

## Create twin (required before capture)

Request:

```json
{
  "epcUri": "urn:epc:id:sgtin:0614141.112345.400",
  "immutable": { "brand_owner_gln": "..." },
  "mutablePatch": { "any_runtime_state": "..." }
}
```

Response:

```json
{
  "objectId": "<gs1-resource-id>",
  "alreadyRegistered": false,
  "key": { "epcUri": "...", "gtin": "...", "serial": "..." }
}
```

## Capture events

- `POST /capture` with an EPCIS 2.0 event list or EPCIS document.
- Optional header `X-Captured-By-DID` is recorded into event immutable metadata (if enabled).

If the twin is not registered, you get:

```json
{
  "error": "twin_not_registered",
  "hint": "Create the twin first via POST /twin (or /gs1/twin) with epcUri.",
  "key": { "epcUri": "...", "gtin": "...", "serial": "..." }
}
```

## Notes

- This hub does **not** implement the EPCIS Query Interface. Use an indexer/DB for queries.
- Mapping EPC URNs (SGTIN/SGLN/SSCC) → GTIN/GLN/SSCC is best-effort and implemented in `src/utils/gs1.ts`.
