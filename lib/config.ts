import { AppError } from "./http";

export type RuntimeMode = "demo" | "live";

export type RuntimeConfig = {
  demoMode: boolean;
  apiKey: string;
  secretKey: string;
  passphrase: string;
  projectId: string;
  chains: string[];
  okxTimeoutMs?: number;
};

export class ConfigurationError extends AppError {
  constructor(message: string) {
    super("LIVE_DATA_UNAVAILABLE", message, 503);
    this.name = "ConfigurationError";
  }
}

function readBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function readTimeout(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 30_000 ? parsed : 8_000;
}

export function getRuntimeConfig(): RuntimeConfig {
  const chains = (process.env.OKX_CHAINS ?? "1")
    .split(",")
    .map((chain) => chain.trim())
    .filter(Boolean);

  return {
    demoMode: readBoolean(process.env.DEMO_MODE),
    apiKey: process.env.OKX_API_KEY?.trim() ?? "",
    secretKey: process.env.OKX_SECRET_KEY?.trim() ?? "",
    passphrase: process.env.OKX_PASSPHRASE?.trim() ?? "",
    projectId: process.env.OKX_PROJECT_ID?.trim() ?? "",
    chains: chains.length > 0 ? chains : ["1"],
    okxTimeoutMs: readTimeout(process.env.OKX_TIMEOUT_MS),
  };
}

export function hasLiveDataConfigured(config = getRuntimeConfig()): boolean {
  const credentials = [config.apiKey, config.secretKey, config.passphrase];
  return credentials.every(Boolean);
}

export function requireLiveConfig(config = getRuntimeConfig()): RuntimeConfig {
  if (!hasLiveDataConfigured(config)) {
    throw new ConfigurationError("Live OKX credentials are not configured for this deployment.");
  }

  return config;
}

export function resolveRuntimeMode(config = getRuntimeConfig()): RuntimeMode {
  return hasLiveDataConfigured(config) ? "live" : "demo";
}
