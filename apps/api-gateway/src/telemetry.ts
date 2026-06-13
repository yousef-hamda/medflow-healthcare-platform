/**
 * OpenTelemetry bootstrap — MUST be imported first in src/main.ts before any
 * other import so instrumentation patches modules before they are loaded.
 *
 * Versions (pinned in package.json):
 *   @opentelemetry/sdk-node                   0.51.1
 *   @opentelemetry/exporter-trace-otlp-http   0.51.1
 *   @opentelemetry/auto-instrumentations-node 0.46.1
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const endpoint =
  process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318';

const sdk = new NodeSDK({
  serviceName: process.env['OTEL_SERVICE_NAME'] ?? 'api-gateway',
  traceExporter: new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable fs auto-instrumentation — too noisy for a gateway service
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk
    .shutdown()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
});
