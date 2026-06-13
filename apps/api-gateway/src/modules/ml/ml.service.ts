import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type FetchFn = typeof fetch;

export interface MlPrediction {
  risk_score: number;
  risk_band: string;
  shap_top5: Array<{ feature: string; value: number }>;
  model_version: string;
}

export interface MlProxyResult {
  status: number;
  body: unknown;
  /** Model version echoed back from the serving response, if present. */
  modelVersion?: string;
}

@Injectable()
export class MlService {
  private readonly logger = new Logger(MlService.name);
  private readonly baseUrl: string;

  constructor(
    config: ConfigService,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.baseUrl = config.getOrThrow<string>('ML_SERVING_URL').replace(/\/$/, '');
  }

  /** JSON inference passthrough (sepsis / readmission). */
  async predict(model: 'sepsis' | 'readmission', payload: unknown): Promise<MlProxyResult> {
    return this.forward(`/predict/${model}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  /**
   * Multipart passthrough (chest-xray). The raw request body buffer and the
   * original content-type are forwarded verbatim so multipart boundaries stay
   * intact.
   */
  async predictImage(
    body: Buffer,
    contentType: string,
  ): Promise<MlProxyResult> {
    return this.forward('/predict/chest-xray', {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });
  }

  private async forward(
    path: string,
    init: RequestInit,
  ): Promise<MlProxyResult> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}${path}`, init);
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* leave as text */
      }
      const modelVersion =
        typeof body === 'object' &&
        body !== null &&
        typeof (body as { model_version?: unknown }).model_version === 'string'
          ? (body as { model_version: string }).model_version
          : undefined;
      return { status: res.status, body, modelVersion };
    } catch (err) {
      this.logger.error(
        `ML serving unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        status: 502,
        body: { error: 'ml_serving_unavailable' },
      };
    }
  }
}
