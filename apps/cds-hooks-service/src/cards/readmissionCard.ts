/**
 * Pure logic: maps a readmission ML prediction → CDS Hooks Card(s).
 *
 * Indicator thresholds (same as sepsis, clinical decision):
 *   risk_score < 0.30   → "info"
 *   0.30 ≤ score < 0.60 → "warning"
 *   score ≥ 0.60        → "critical"
 *
 * Always returns exactly one card.
 *
 * No side effects, no I/O — fully unit-testable.
 */

import { v4 as uuidv4 } from 'uuid';
import type { CdsCard, CdsIndicator, CdsSuggestion, CdsLink } from '@medflow/shared-types';
import type { MlPredictionResponse, ShapContribution } from '../ml/mlClient.js';

const MODEL_CARD_URL = 'https://medflow.internal/model-cards/readmission-risk-v1';
const SOURCE_LABEL = 'MedFlow Readmission Risk';

/**
 * Determines the CDS indicator from a readmission risk score.
 */
export function readmissionIndicator(riskScore: number): CdsIndicator {
  if (riskScore >= 0.6) return 'critical';
  if (riskScore >= 0.3) return 'warning';
  return 'info';
}

/**
 * Formats the card summary — must be ≤ 140 characters per the CDS Hooks spec.
 */
export function readmissionSummary(riskScore: number, indicator: CdsIndicator): string {
  const pct = (riskScore * 100).toFixed(0);
  const band = indicator === 'critical' ? 'HIGH' : indicator === 'warning' ? 'MODERATE' : 'LOW';
  return `30-day readmission risk ${band} (${riskScore.toFixed(2)}) — ${pct}%`;
}

/**
 * Renders a Markdown table of the top-5 SHAP contributors.
 */
export function readmissionShapDetail(shap: ShapContribution[], modelVersion: string): string {
  const rows = shap
    .slice(0, 5)
    .map((c) => {
      const valueStr = c.value !== undefined ? c.value.toFixed(3) : 'n/a';
      const shapStr = c.shapValue >= 0 ? `+${c.shapValue.toFixed(4)}` : c.shapValue.toFixed(4);
      return `| ${c.feature} | ${valueStr} | ${shapStr} |`;
    })
    .join('\n');

  return [
    `**Model version:** ${modelVersion}`,
    '',
    '| Feature | Value | SHAP contribution |',
    '|---------|-------|-------------------|',
    rows || '| (no feature data) | — | — |',
    '',
    '_SHAP values indicate each feature\'s signed contribution toward the readmission prediction._',
    '',
    `[View full model card](${MODEL_CARD_URL})`,
  ].join('\n');
}

/**
 * Builds discharge-planning suggestions for a high readmission risk alert.
 */
function readmissionSuggestions(patientId: string, encounterId: string): CdsSuggestion[] {
  const nowIso = new Date().toISOString();
  const followUpDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  return [
    {
      label: 'Schedule 7-day follow-up appointment',
      uuid: uuidv4(),
      isRecommended: true,
      actions: [
        {
          type: 'create',
          description: 'Schedule follow-up appointment within 7 days of discharge',
          resource: {
            resourceType: 'ServiceRequest',
            status: 'draft',
            intent: 'proposal',
            priority: 'routine',
            code: {
              coding: [
                {
                  system: 'http://snomed.info/sct',
                  code: '306206005',
                  display: 'Referral to outpatient clinic',
                },
              ],
              text: 'Follow-up appointment within 7 days',
            },
            subject: { reference: `Patient/${patientId}` },
            encounter: { reference: `Encounter/${encounterId}` },
            occurrenceDateTime: followUpDate,
            authoredOn: nowIso,
            note: [{ text: 'CDS Hooks readmission risk alert — MedFlow' }],
          },
        },
      ],
    },
    {
      label: 'Medication reconciliation at discharge',
      uuid: uuidv4(),
      isRecommended: true,
      actions: [
        {
          type: 'create',
          description: 'Perform comprehensive medication reconciliation before discharge',
          resource: {
            resourceType: 'ServiceRequest',
            status: 'draft',
            intent: 'proposal',
            priority: 'urgent',
            code: {
              coding: [
                {
                  system: 'http://snomed.info/sct',
                  code: '432201002',
                  display: 'Reconciliation of medicine list (procedure)',
                },
              ],
              text: 'Medication reconciliation',
            },
            subject: { reference: `Patient/${patientId}` },
            encounter: { reference: `Encounter/${encounterId}` },
            authoredOn: nowIso,
            note: [{ text: 'CDS Hooks readmission risk alert — MedFlow' }],
          },
        },
      ],
    },
  ];
}

/**
 * Builds the card links for the readmission alert.
 */
function readmissionLinks(): CdsLink[] {
  return [
    {
      label: 'Readmission Risk Model Card',
      url: MODEL_CARD_URL,
      type: 'absolute',
    },
    {
      label: 'CMS Hospital Readmissions Reduction Program',
      url: 'https://www.cms.gov/medicare/payment/prospective-payment-systems/acute-inpatient-pps/hospital-readmissions-reduction-program-hrrp',
      type: 'absolute',
    },
  ];
}

/**
 * Builds the complete CdsCard for a readmission prediction.
 *
 * @param prediction  - Response from ML serving /predict/readmission
 * @param patientId   - FHIR Patient logical id
 * @param encounterId - FHIR Encounter logical id
 * @returns A single CdsCard (always)
 */
export function buildReadmissionCard(
  prediction: MlPredictionResponse,
  patientId: string,
  encounterId: string,
): CdsCard {
  const indicator = readmissionIndicator(prediction.risk_score);
  const summary = readmissionSummary(prediction.risk_score, indicator);
  const detail = readmissionShapDetail(prediction.shap_top5, prediction.model_version);

  const card: CdsCard = {
    uuid: uuidv4(),
    summary,
    detail,
    indicator,
    source: {
      label: SOURCE_LABEL,
      url: MODEL_CARD_URL,
    },
    links: readmissionLinks(),
    overrideReasons: [
      {
        code: 'planned-readmission',
        system: 'http://medflow.internal/override-reasons',
        display: 'Planned readmission / elective',
      },
      {
        code: 'palliative-goals',
        system: 'http://medflow.internal/override-reasons',
        display: 'Patient in palliative / comfort care',
      },
      {
        code: 'already-planned',
        system: 'http://medflow.internal/override-reasons',
        display: 'Follow-up and reconciliation already arranged',
      },
    ],
  };

  // Attach suggestions for warning and critical alerts
  if (indicator === 'warning' || indicator === 'critical') {
    card.suggestions = readmissionSuggestions(patientId, encounterId);
    card.selectionBehavior = 'any';
  }

  return card;
}
