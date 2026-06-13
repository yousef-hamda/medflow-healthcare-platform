/**
 * GET /cds-services — CDS Hooks 1.1 discovery endpoint.
 *
 * Returns the two registered services:
 *   • sepsis-warning   (hook: patient-view)
 *   • readmission-risk (hook: encounter-discharge)
 */

import type { FastifyInstance } from 'fastify';
import type { CdsServicesDiscoveryResponse } from '@medflow/shared-types';

const DISCOVERY_RESPONSE: CdsServicesDiscoveryResponse = {
  services: [
    {
      hook: 'patient-view',
      id: 'sepsis-warning',
      title: 'Sepsis Early Warning System',
      description:
        'Real-time sepsis risk score (0–1) derived from recent vital signs via the MedFlow ML model. ' +
        'Surfaces a CDS card with indicator, SHAP-based explanations, and actionable order suggestions ' +
        '(serum lactate, blood cultures) when risk is elevated.',
      prefetch: {
        recentVitals:
          'Observation?patient={{context.patientId}}&category=vital-signs&_sort=-date&_count=50',
      },
      usageRequirements:
        'Requires access to the patient\'s recent vital-signs observations. ' +
        'The service degrades gracefully when prefetch is unavailable by fetching directly from the FHIR server.',
    },
    {
      hook: 'encounter-discharge',
      id: 'readmission-risk',
      title: '30-Day Readmission Risk',
      description:
        'Predicts 30-day all-cause readmission risk at point of discharge using the MedFlow readmission model. ' +
        'Returns a card with risk score, SHAP feature attributions, and discharge-planning suggestions ' +
        '(follow-up appointment, medication reconciliation) when risk is elevated.',
      prefetch: {
        encounter:
          'Encounter/{{context.encounterId}}',
        activeConditions:
          'Condition?patient={{context.patientId}}&clinical-status=active&_count=50',
      },
      usageRequirements:
        'Requires a completed or in-progress encounter context with an encounterId. ' +
        'Best used immediately prior to or at the point of discharge.',
    },
  ],
};

/**
 * Registers the discovery route on the provided Fastify instance.
 */
export async function discoveryRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/cds-services',
    {
      schema: {
        description: 'CDS Hooks 1.1 service discovery',
        tags: ['discovery'],
        response: {
          200: {
            type: 'object',
            properties: {
              services: { type: 'array' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      return reply.code(200).send(DISCOVERY_RESPONSE);
    },
  );
}
