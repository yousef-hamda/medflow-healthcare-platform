/**
 * CDS Hooks invocation + feedback routes.
 *
 *   POST /cds-services/sepsis-warning      (hook: patient-view)
 *   POST /cds-services/readmission-risk    (hook: encounter-discharge)
 *   POST /cds-services/:id/feedback        (CDS Hooks 1.1 feedback)
 *
 * Each invocation:
 *   1. validates the request envelope + hook-specific context (Zod),
 *   2. resolves the vitals window — from prefetch when present, else by
 *      fetching directly from the FHIR server (graceful degradation),
 *   3. calls the ML serving endpoint,
 *   4. maps the prediction → CDS card(s) via the pure card builders.
 *
 * Upstream failures (FHIR / ML) return an empty `{ cards: [] }` with a 200 so a
 * CDS Hooks client never breaks the clinician's workflow on our account.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import type { Bundle, Observation } from '@medflow/fhir-types';
import { isBundle } from '@medflow/fhir-types';
import type { CdsHooksResponse } from '@medflow/shared-types';

import type { AppConfig } from '../config.js';
import { logger } from '../logger.js';
import {
  parsePatientViewRequest,
  parseEncounterDischargeRequest,
  parseFeedbackRequest,
  formatZodErrors,
} from '../validation.js';
import type { ParsedCdsHooksRequest } from '../validation.js';
import { bundleToVitalsWindow } from '../fhir/vitalsMapper.js';
import type { VitalsWindow } from '../fhir/vitalsMapper.js';
import { fetchRecentVitals } from '../fhir/fhirClient.js';
import type { FhirClientOptions } from '../fhir/fhirClient.js';
import { predictSepsis, predictReadmission } from '../ml/mlClient.js';
import { buildSepsisCard } from '../cards/sepsisCard.js';
import { buildReadmissionCard } from '../cards/readmissionCard.js';
import { persistFeedback } from '../db/feedbackStore.js';
import type { FeedbackRow } from '../db/feedbackStore.js';
import { cdsInvocationsCounter, feedbackCounter } from '../metrics.js';

const EMPTY_RESPONSE: CdsHooksResponse = { cards: [] };

/** Resolve a vitals window: prefer prefetch.recentVitals, else fetch from FHIR. */
async function resolveVitalsWindow(
  patientId: string,
  request: ParsedCdsHooksRequest,
  config: AppConfig,
): Promise<VitalsWindow[]> {
  const prefetched = request.prefetch?.['recentVitals'];
  if (prefetched && isBundle(prefetched)) {
    return bundleToVitalsWindow(prefetched as Bundle<Observation>);
  }

  const options: FhirClientOptions = {
    baseUrl: request.fhirServer ?? config.fhirBaseUrl,
    auth: request.fhirAuthorization,
    timeoutMs: config.upstreamTimeoutMs,
  };
  const bundle = await fetchRecentVitals(patientId, options);
  return bundleToVitalsWindow(bundle);
}

function handleValidationError(err: unknown, reply: FastifyReply): boolean {
  if (err instanceof ZodError) {
    reply.status(400).send({ error: 'Validation failed', issues: formatZodErrors(err) });
    return true;
  }
  return false;
}

export async function hookRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  // ── POST /cds-services/sepsis-warning ──────────────────────────────────────
  app.post(
    '/cds-services/sepsis-warning',
    async (req: FastifyRequest, reply: FastifyReply): Promise<CdsHooksResponse> => {
      cdsInvocationsCounter.inc({ service: 'sepsis-warning' });
      let parsed: ReturnType<typeof parsePatientViewRequest>;
      try {
        parsed = parsePatientViewRequest(req.body);
      } catch (err) {
        if (handleValidationError(err, reply)) return EMPTY_RESPONSE;
        throw err;
      }

      const { request, context } = parsed;
      try {
        const vitals = await resolveVitalsWindow(context.patientId, request, config);
        const prediction = await predictSepsis(
          config.mlServingUrl,
          { patient_id: context.patientId, vitals_window: vitals },
          config.upstreamTimeoutMs,
        );
        return { cards: [buildSepsisCard(prediction, context.patientId)] };
      } catch (err) {
        logger.error({ err: String(err), service: 'sepsis-warning' }, 'Sepsis hook upstream failure');
        return EMPTY_RESPONSE;
      }
    },
  );

  // ── POST /cds-services/readmission-risk ────────────────────────────────────
  app.post(
    '/cds-services/readmission-risk',
    async (req: FastifyRequest, reply: FastifyReply): Promise<CdsHooksResponse> => {
      cdsInvocationsCounter.inc({ service: 'readmission-risk' });
      let parsed: ReturnType<typeof parseEncounterDischargeRequest>;
      try {
        parsed = parseEncounterDischargeRequest(req.body);
      } catch (err) {
        if (handleValidationError(err, reply)) return EMPTY_RESPONSE;
        throw err;
      }

      const { request, context } = parsed;
      try {
        const vitals = await resolveVitalsWindow(context.patientId, request, config);
        const prediction = await predictReadmission(
          config.mlServingUrl,
          { patient_id: context.patientId, vitals_window: vitals },
          config.upstreamTimeoutMs,
        );
        return {
          cards: [buildReadmissionCard(prediction, context.patientId, context.encounterId)],
        };
      } catch (err) {
        logger.error(
          { err: String(err), service: 'readmission-risk' },
          'Readmission hook upstream failure',
        );
        return EMPTY_RESPONSE;
      }
    },
  );

  // ── POST /cds-services/:id/feedback ────────────────────────────────────────
  app.post(
    '/cds-services/:id/feedback',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const serviceId = req.params.id;
      let parsed: ReturnType<typeof parseFeedbackRequest>;
      try {
        parsed = parseFeedbackRequest(req.body);
      } catch (err) {
        if (handleValidationError(err, reply)) return;
        throw err;
      }

      const rows: FeedbackRow[] = parsed.feedback.map((f) => ({
        serviceId,
        cardUuid: f.card,
        outcome: f.outcome,
        outcomeTs: f.outcomeTimestamp,
        overrideReason: f.overrideReason?.reason?.code,
        payload: f as unknown as Record<string, unknown>,
      }));

      try {
        await persistFeedback(config.databaseUrl, rows);
        feedbackCounter.inc({ service: serviceId }, rows.length);
      } catch (err) {
        logger.error({ err: String(err), service: serviceId }, 'Failed to persist CDS feedback');
        return reply.status(503).send({ error: 'Failed to persist feedback' });
      }

      return reply.status(200).send({ accepted: rows.length });
    },
  );
}
