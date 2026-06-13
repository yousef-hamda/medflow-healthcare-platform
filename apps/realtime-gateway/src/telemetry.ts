/**
 * OpenTelemetry bootstrap.
 *
 * Must be imported FIRST in src/main.ts (before any instrumented libraries) so
 * that the NodeSDK can patch HTTP, net, and other built-ins at load time.
 *
 * When OTEL_EXPORTER_OTLP_ENDPOINT is unset the SDK starts with no exporter
 * (trace data is discarded) so the service still boots cleanly in local dev.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

const endpoint = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];

const traceExporter = endpoint
  ? new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })
  : undefined;

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: "realtime-gateway",
    [SemanticResourceAttributes.SERVICE_VERSION]: "0.1.0",
  }),
  traceExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable fs instrumentation to avoid noisy spans in local dev
      "@opentelemetry/instrumentation-fs": { enabled: false },
    }),
  ],
});

sdk.start();

// Graceful shutdown on process exit
process.on("SIGTERM", () => {
  sdk
    .shutdown()
    .then(() => {
      process.exit(0);
    })
    .catch((_err: unknown) => {
      process.exit(1);
    });
});

export {};
