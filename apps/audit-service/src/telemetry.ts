/**
 * OpenTelemetry bootstrap — import this module FIRST in main.ts before any
 * instrumented packages (pg, fastify, kafkajs) so auto-instrumentation patches
 * load correctly.
 *
 * Exporters send traces to OTEL_EXPORTER_OTLP_ENDPOINT (HTTP/protobuf).
 * If the env var is absent the SDK still initialises but traces are discarded.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

const exporter = new OTLPTraceExporter({
  // Falls back to http://localhost:4318/v1/traces when env var absent
  url: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]
    ? `${process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]}/v1/traces`
    : undefined,
});

const sdk = new NodeSDK({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]: "audit-service",
    [SEMRESATTRS_SERVICE_VERSION]: "1.0.0",
  }),
  traceExporter: exporter,
});

// Graceful shutdown so spans flush on SIGTERM
process.on("SIGTERM", () => {
  sdk
    .shutdown()
    .catch((err: unknown) => {
      process.stderr.write(`OTel shutdown error: ${String(err)}\n`);
    })
    .finally(() => process.exit(0));
});

sdk.start();

export { sdk };
