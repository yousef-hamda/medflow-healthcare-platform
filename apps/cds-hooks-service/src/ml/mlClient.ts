/**
 * HTTP client for the ML serving /predict/* endpoints.
 *
 * ML serving contract (both endpoints share the same response shape):
 *   POST {ML_SERVING_URL}/predict/sepsis
 *   POST {ML_SERVING_URL}/predict/readmission
 *
 * Request body:
 *   { patient_id, vitals_window: VitalsWindow[], labs?: Record<string, number> }
 *
 * Response:
 *   { risk_score: number (0-1), risk_band: string, shap_top5: ShapContribution[], model_version: string }
 */

import type { VitalsWindow } from '../fhir/vitalsMapper.js';
import { logger } from '../logger.js';

export interface ShapContribution {
  feature: string;
  shapValue: number;
  value?: number;
}

export interface MlPredictionResponse {
  risk_score: number;
  risk_band: string;
  shap_top5: ShapContribution[];
  model_version: string;
}

export interface MlPredictionRequest {
  patient_id: string;
  vitals_window: VitalsWindow[];
  labs?: Record<string, number>;
}

/**
 * Calls the ML serving endpoint and returns the parsed prediction.
 * Throws on network failure, non-2xx status, or unexpected response shape.
 */
async function callPredict(
  endpoint: string,
  body: MlPredictionRequest,
  timeoutMs: number,
): Promise<MlPredictionResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `ML serving returned ${response.status} ${response.statusText} for ${endpoint}`,
      );
    }

    const data = await response.json() as Record<string, unknown>;

    // Basic structural validation — avoids a crash if ML serving changes shape
    if (typeof data['risk_score'] !== 'number') {
      throw new Error('ML serving response missing numeric risk_score');
    }

    return {
      risk_score: data['risk_score'] as number,
      risk_band: String(data['risk_band'] ?? 'unknown'),
      shap_top5: (data['shap_top5'] as ShapContribution[] | undefined) ?? [],
      model_version: String(data['model_version'] ?? 'unknown'),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Calls the sepsis prediction endpoint.
 */
export async function predictSepsis(
  mlServingUrl: string,
  request: MlPredictionRequest,
  timeoutMs: number,
): Promise<MlPredictionResponse> {
  logger.debug({ patientId: request.patient_id }, 'Calling ML sepsis prediction');
  return callPredict(`${mlServingUrl}/predict/sepsis`, request, timeoutMs);
}

/**
 * Calls the readmission prediction endpoint.
 */
export async function predictReadmission(
  mlServingUrl: string,
  request: MlPredictionRequest,
  timeoutMs: number,
): Promise<MlPredictionResponse> {
  logger.debug({ patientId: request.patient_id }, 'Calling ML readmission prediction');
  return callPredict(`${mlServingUrl}/predict/readmission`, request, timeoutMs);
}
