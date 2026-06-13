/**
 * src/metrics.ts — Prometheus metrics using prom-client 15.1.2.
 *
 * Registers:
 *   - cds_invocations_total  (counter, labelled by service) — hook invocations
 *   - cds_feedback_total     (counter, labelled by service) — feedback rows persisted
 *   - Node.js default metrics (event loop lag, heap, GC, …)
 */

import { Registry, Counter, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

export const cdsInvocationsCounter = new Counter({
  name: 'cds_invocations_total',
  help: 'Total CDS Hooks service invocations',
  labelNames: ['service'] as const,
  registers: [registry],
});

export const feedbackCounter = new Counter({
  name: 'cds_feedback_total',
  help: 'Total CDS Hooks feedback rows persisted',
  labelNames: ['service'] as const,
  registers: [registry],
});
