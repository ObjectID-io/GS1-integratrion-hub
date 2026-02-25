import type { gasStationCfg } from "./signAndExecTx";

/**
 * GasStation configuration depends on network.
 * Defaults can be overridden via env vars (recommended for production).
 */

function env(name: string, fallback: string): string {
  const v = String(process.env[name] ?? "").trim();
  return v || fallback;
}

export const USE_GAS_STATION: boolean = (process.env.OID_USE_GAS_STATION ?? "true").toLowerCase() === "true";

export function getGasStationCfg(network: string): gasStationCfg {
  const net = String(network ?? "").toLowerCase() === "testnet" ? "testnet" : "mainnet";

  if (net === "testnet") {
    return {
      gasStation1URL: env("OID_GAS1_URL", "https://gas1.objectid.io"),
      gasStation1Token: env("OID_GAS1_TOKEN", "1111"),
      gasStation2URL: env("OID_GAS2_URL", "https://gas2.objectid.io"),
      gasStation2Token: env("OID_GAS2_TOKEN", "1111"),
    };
  }

  return {
    gasStation1URL: env("OID_GAS1_URL", "https://m-gas1.objectid.io"),
    gasStation1Token: env("OID_GAS1_TOKEN", "1111"),
    gasStation2URL: env("OID_GAS2_URL", "https://m-gas2.objectid.io"),
    gasStation2Token: env("OID_GAS2_TOKEN", "1111"),
  };
}
