/**
 * OpenTelemetry bootstrap — must be imported BEFORE any other application
 * modules so instrumentation patches are applied at load time.
 *
 * Versions pinned to match monorepo:
 *   @opentelemetry/sdk-node                  0.51.1
 *   @opentelemetry/exporter-trace-otlp-http  0.51.1
 *   @opentelemetry/auto-instrumentations-node 0.46.1
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
// SemanticResourceAttributes was moved to a stable package in 1.x; use the
// string literals directly to stay compatible with 0.51.x semconv versions.

const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];

/** Initialise the OpenTelemetry SDK.  Call once at process start. */
export function startTelemetry(): void {
  if (!endpoint) {
    // No collector configured — skip SDK registration (dev / test mode).
    return;
  }

  const exporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });

  const sdk = new NodeSDK({
    resource: new Resource({
      'service.name': 'cds-hooks-service',
      'service.version': '1.0.0',
      'deployment.environment': process.env['NODE_ENV'] ?? 'development',
    }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Suppress noisy fs instrumentation in production
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  process.on('SIGTERM', () => {
    sdk.shutdown().catch((err: unknown) => {
      console.error('OTel SDK shutdown error', err);
    });
  });
}
