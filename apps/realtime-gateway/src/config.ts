/**
 * Centralised, validated environment configuration.
 * Fails fast at startup if required variables are missing.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

export interface Config {
  httpPort: number;
  kafkaBrokers: string[];
  apiGatewayUrl: string;
  jwtSigningKey: string;
  redisUrl: string;
  otelEndpoint: string | undefined;
  logLevel: string;
  nodeEnv: string;
}

export function loadConfig(): Config {
  const httpPort = parseInt(optionalEnv("HTTP_PORT", "4001"), 10);
  if (isNaN(httpPort) || httpPort < 1 || httpPort > 65535) {
    throw new Error(`HTTP_PORT must be a valid port number, got: ${process.env["HTTP_PORT"]}`);
  }

  const kafkaBrokersRaw = optionalEnv("KAFKA_BROKERS", "kafka:9092");
  const kafkaBrokers = kafkaBrokersRaw
    .split(",")
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  if (kafkaBrokers.length === 0) {
    throw new Error("KAFKA_BROKERS must contain at least one broker address");
  }

  return {
    httpPort,
    kafkaBrokers,
    apiGatewayUrl: optionalEnv("API_GATEWAY_URL", "http://api-gateway:4000"),
    jwtSigningKey: requireEnv("JWT_SIGNING_KEY"),
    redisUrl: optionalEnv("REDIS_URL", "redis://redis:6379"),
    otelEndpoint: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] || undefined,
    logLevel: optionalEnv("LOG_LEVEL", "info"),
    nodeEnv: optionalEnv("NODE_ENV", "development"),
  };
}
