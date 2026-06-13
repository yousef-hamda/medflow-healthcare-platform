/**
 * Pure logic: maps a sepsis ML prediction → CDS Hooks Card(s).
 *
 * Indicator thresholds (per spec, our clinical choice):
 *   risk_score < 0.30  → "info"
 *   0.30 ≤ score < 0.60 → "warning"
 *   score ≥ 0.60        → "critical"
 *
 * Always returns exactly one card (never an empty response) so clinicians
 * always see the score, even for low-risk patients.
 *
 * No side effects, no I/O — fully unit-testable.
 */

import { v4 as uuidv4 } from 'uuid';
import type { CdsCard, CdsIndicator, CdsSuggestion, CdsLink } from '@medflow/shared-types';
import type { MlPredictionResponse, ShapContribution } from '../ml/mlClient.js';

const MODEL_CARD_URL = 'https://medflow.internal/model-cards/sepsis-ews-v1';
const SOURCE_LABEL = 'MedFlow Sepsis EWS';

/**
 * Determines the CDS indicator from a sepsis risk score.
 */
export function sepsisIndicator(riskScore: number): CdsIndicator {
  if (riskScore >= 0.6) return 'critical';
  if (riskScore >= 0.3) return 'warning';
  return 'info';
}

/**
 * Formats the card summary — must be ≤ 140 characters per the CDS Hooks spec.
 */
export function sepsisSummary(riskScore: number, indicator: CdsIndicator): string {
  const pct = (riskScore * 100).toFixed(0);
  const band = indicator === 'critical' ? 'HIGH' : indicator === 'warning' ? 'MODERATE' : 'LOW';
  // e.g. "Sepsis risk HIGH (0.82)" — well within 140 chars
  return `Sepsis risk ${band} (${riskScore.toFixed(2)}) — ${pct}% probability`;
}

/**
 * Renders a Markdown table of the top-5 SHAP contributors for the card detail.
 */
export function sepsisShapDetail(shap: ShapContribution[], modelVersion: string): string {
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
    '_SHAP values indicate each feature\'s signed contribution toward the sepsis prediction._',
    '',
    `[View full model card](${MODEL_CARD_URL})`,
  ].join('\n');
}

/**
 * Builds the order suggestions for a sepsis alert.
 * Returns ServiceRequest "create" actions per CDS Hooks spec.
 */
function sepsisSuggestions(patientId: string): CdsSuggestion[] {
  const nowIso = new Date().toISOString();

  return [
    {
      label: 'Order serum lactate',
      uuid: uuidv4(),
      isRecommended: true,
      actions: [
        {
          type: 'create',
          description: 'Order serum lactate measurement',
          resource: {
            resourceType: 'ServiceRequest',
            status: 'draft',
            intent: 'proposal',
            priority: 'urgent',
            code: {
              coding: [
                {
                  system: 'http://loinc.org',
                  code: '2524-7',
                  display: 'Lactate [Moles/volume] in Serum or Plasma',
                },
              ],
              text: 'Serum lactate',
            },
            subject: { reference: `Patient/${patientId}` },
            authoredOn: nowIso,
            note: [{ text: 'CDS Hooks sepsis alert — MedFlow Sepsis EWS' }],
          },
        },
      ],
    },
    {
      label: 'Order blood cultures (×2)',
      uuid: uuidv4(),
      isRecommended: true,
      actions: [
        {
          type: 'create',
          description: 'Order two sets of blood cultures before antibiotic administration',
          resource: {
            resourceType: 'ServiceRequest',
            status: 'draft',
            intent: 'proposal',
            priority: 'urgent',
            code: {
              coding: [
                {
                  system: 'http://loinc.org',
                  code: '600-7',
                  display: 'Bacteria identified in Blood by Culture',
                },
              ],
              text: 'Blood culture x2',
            },
            subject: { reference: `Patient/${patientId}` },
            authoredOn: nowIso,
            note: [{ text: 'CDS Hooks sepsis alert — MedFlow Sepsis EWS' }],
          },
        },
      ],
    },
  ];
}

/**
 * Builds the card links for the sepsis alert.
 */
function sepsisLinks(): CdsLink[] {
  return [
    {
      label: 'Sepsis EWS Model Card',
      url: MODEL_CARD_URL,
      type: 'absolute',
    },
    {
      label: 'Surviving Sepsis Campaign Guidelines',
      url: 'https://www.sccm.org/clinical-resources/guidelines/sepsis',
      type: 'absolute',
    },
  ];
}

/**
 * Builds the complete CdsCard for a sepsis prediction.
 *
 * @param prediction - Response from ML serving /predict/sepsis
 * @param patientId  - FHIR Patient logical id
 * @returns A single CdsCard (always, regardless of risk level)
 */
export function buildSepsisCard(
  prediction: MlPredictionResponse,
  patientId: string,
): CdsCard {
  const indicator = sepsisIndicator(prediction.risk_score);
  const summary = sepsisSummary(prediction.risk_score, indicator);
  const detail = sepsisShapDetail(prediction.shap_top5, prediction.model_version);

  const card: CdsCard = {
    uuid: uuidv4(),
    summary,
    detail,
    indicator,
    source: {
      label: SOURCE_LABEL,
      url: MODEL_CARD_URL,
    },
    links: sepsisLinks(),
    overrideReasons: [
      {
        code: 'patient-declined',
        system: 'http://medflow.internal/override-reasons',
        display: 'Patient declined intervention',
      },
      {
        code: 'clinical-judgment',
        system: 'http://medflow.internal/override-reasons',
        display: 'Clinical judgment — not applicable',
      },
      {
        code: 'already-ordered',
        system: 'http://medflow.internal/override-reasons',
        display: 'Already ordered',
      },
    ],
  };

  // Only attach order suggestions for warning and critical alerts
  if (indicator === 'warning' || indicator === 'critical') {
    card.suggestions = sepsisSuggestions(patientId);
    card.selectionBehavior = 'any';
  }

  return card;
}
