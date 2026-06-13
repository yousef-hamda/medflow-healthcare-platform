/**
 * Centralised, validated runtime configuration.
 * All environment reads are collected here — never sprinkled across files.
 */

export interface AppConfig {
  httpPort: number;
  mlServingUrl: string;
  fhirBaseUrl: string;
  databaseUrl: string;
  logLevel: string;
  nodeEnv: string;
  upstreamTimeoutMs: number;
  modelCardBaseUrl: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export function loadConfig(): AppConfig {
  return {
    httpPort: parseInt(optional('HTTP_PORT', '8096'), 10),
    mlServingUrl: optional('ML_SERVING_URL', 'http://ml-serving:8094'),
    fhirBaseUrl: optional('FHIR_BASE_URL', 'http://fhir-server:8090/fhir'),
    databaseUrl: optional(
      'DATABASE_URL',
      'postgresql://medflow:medflow_dev_password@postgres:5432/gateway',
    ),
    logLevel: optional('LOG_LEVEL', 'info'),
    nodeEnv: optional('NODE_ENV', 'development'),
    upstreamTimeoutMs: parseInt(optional('UPSTREAM_TIMEOUT_MS', '5000'), 10),
    // Canonical URL for model card links; adjust per deployment
    modelCardBaseUrl: optional(
      'MODEL_CARD_BASE_URL',
      'https://medflow.internal/model-cards',
    ),
  };
}

/** Singleton — call loadConfig() once and share this throughout the process. */
export const config: AppConfig = loadConfig();

// Validate DATABASE_URL is present (required for feedback persistence)
void required('DATABASE_URL');
