# integration-hub-gs1

TypeScript/Express hub exposing **GS1 EPCIS 2.0-like REST endpoints** and forwarding events into **ObjectID**.

This hub is intentionally **simple and strict**:

- **Mono-tenant**: the hub uses a single ObjectID signer (seed/DID) configured via `.env`.
- **No API key auth**: intended to run inside the customer VPN / private network.
- Calls the **OID GS1 Move module** directly via `@iota/iota-sdk`.
- **No auto-create on capture**: if an EPCIS event refers to a product twin that was not created/registered, capture returns an error.

## Endpoints

- `POST /twin` (alias `POST /gs1/twin`)
  - Creates a `GS1Resource` and registers it into the shared `GS1Registry`.
  - Idempotent: it first checks the registry by **canonical_id = epcUri**.

- `POST /capture` (alias `POST /epcis/capture`)
  - Captures EPCIS events and updates the on-chain `GS1Resource` state.
  - **Requires** the twin to be already registered via `POST /twin`.

- `GET /health`

Optional (disabled by default):

- `GET /debug/signer`
- `GET /debug/owned-objects`

## Quick start

```bash
cp .env.example.testnet .env   # or: cp .env.example.mainnet .env
npm i
npm run dev
```

## Configuration

Required (you can find this data in ObjectID dapp):

- `OID_SEED_HEX`
- `OID_DID`
- `OID_NETWORK` (`testnet` | `mainnet`)
- `OID_GS1_PACKAGE_ID` (on-chain OID GS1 Move package id)
- `OID_GS1_REGISTRY_ID` (shared `GS1Registry` object id)
- `OID_CREDIT_PACKAGE` (ObjectID credit core Move package id used by the OID GS1 package)
- `OID_CREDIT_POLICY_ID`
- `OID_CREDIT_TOKEN_ID`
- `OID_CONTROLLER_CAP_ID`

Optional:

- `OID_RPC_URL` (override the RPC URL)
- `ALLOW_CALLER_DID_HEADER` (default `true`)
- `ENABLE_DEBUG_ENDPOINTS` (default `false`)
- `OID_LINKED_DOMAIN_ORIGIN` (legacy; not used to build txs)
- `OID_USE_GAS_STATION` (default `true`)
- `OID_GAS1_URL`, `OID_GAS1_TOKEN`, `OID_GAS2_URL`, `OID_GAS2_TOKEN`
- `PORT` (default `8080`)
- `LOG_LEVEL` (default `info`)

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
