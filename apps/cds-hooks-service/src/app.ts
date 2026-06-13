/**
 * Fastify application factory.
 *
 * Routes:
 *   GET  /cds-services                     — discovery (routes/discovery.ts)
 *   POST /cds-services/sepsis-warning      — sepsis early-warning hook
 *   POST /cds-services/readmission-risk    — readmission-risk hook
 *   POST /cds-services/:id/feedback        — CDS Hooks feedback
 *   GET  /healthz                          — liveness
 *   GET  /metrics                          — Prometheus exposition
 *
 * Kept side-effect free (no listen, no DB connect) so it is unit-testable with
 * `app.inject(...)`.
 */

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

import type { AppConfig } from './config.js';
import { logger } from './logger.js';
import { discoveryRoute } from './routes/discovery.js';
import { hookRoutes } from './routes/hooks.js';
import { registry } from './metrics.js';

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({ logger });

  // CDS Hooks clients are browser-based EHR apps — permissive CORS by design.
  await app.register(cors, { origin: true });

  await app.register(discoveryRoute);
  await app.register((instance) => hookRoutes(instance, config));

  app.get('/healthz', async (_req, reply) => {
    return reply.status(200).send({ status: 'ok', service: 'cds-hooks-service' });
  });

  app.get('/metrics', async (_req, reply) => {
    const body = await registry.metrics();
    return reply.status(200).header('Content-Type', registry.contentType).send(body);
  });

  return app;
}
