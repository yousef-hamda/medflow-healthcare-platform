import {
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SmartScope } from '@medflow/shared-types';
import { applyMinimumNecessary } from './minimum-necessary';
import { narrowForPatientContext } from './patient-context';
import { statusToOutcome } from './operation-outcome';

export type FetchFn = typeof fetch;

export interface ProxyRequest {
  method: string;
  /** Path after `/fhir/`, e.g. "Observation" or "Patient/123". */
  path: string;
  search: URLSearchParams;
  body?: unknown;
  grantedScopes: readonly SmartScope[];
  /** `patient` claim from the token, if launch/patient context. */
  contextPatient?: string;
}

export interface ProxyResponse {
  status: number;
  body: unknown;
}

@Injectable()
export class FhirProxyService {
  private readonly logger = new Logger(FhirProxyService.name);
  private readonly baseUrl: string;

  constructor(
    config: ConfigService,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.baseUrl = config.getOrThrow<string>('FHIR_BASE_URL').replace(/\/$/, '');
  }

  async proxy(req: ProxyRequest): Promise<ProxyResponse> {
    let targetPath = req.path.replace(/^\/+/, '');

    // 1. Patient-context narrowing (only for reads/searches).
    if (req.contextPatient) {
      const narrowed = narrowForPatientContext(
        req.path,
        req.search,
        req.contextPatient,
      );
      if (narrowed.forbidden) {
        throw new ForbiddenException(
          statusToOutcome(403, narrowed.reason ?? 'Forbidden'),
        );
      }
      targetPath = narrowed.targetPath;
    } else {
      const qs = req.search.toString();
      targetPath = qs ? `${targetPath}?${qs}` : targetPath;
    }

    // 2. Forward upstream.
    const url = `${this.baseUrl}/${targetPath}`;
    let upstream: Response;
    try {
      upstream = await this.fetchFn(url, {
        method: req.method,
        headers: {
          'Content-Type': 'application/fhir+json',
          Accept: 'application/fhir+json',
        },
        body:
          req.body !== undefined && req.method !== 'GET' && req.method !== 'HEAD'
            ? JSON.stringify(req.body)
            : undefined,
      });
    } catch (err) {
      this.logger.error(
        `FHIR upstream unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        status: 502,
        body: statusToOutcome(502, 'FHIR upstream unreachable'),
      };
    }

    const text = await upstream.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    // 3. Map upstream errors to OperationOutcome (if upstream did not already).
    if (!upstream.ok) {
      const alreadyOutcome =
        typeof parsed === 'object' &&
        parsed !== null &&
        (parsed as { resourceType?: unknown }).resourceType ===
          'OperationOutcome';
      return {
        status: upstream.status,
        body: alreadyOutcome
          ? parsed
          : statusToOutcome(
              upstream.status,
              `FHIR upstream error (${upstream.status})`,
            ),
      };
    }

    // 4. Minimum-necessary masking on success payloads.
    const masked = applyMinimumNecessary(parsed, req.grantedScopes);
    return { status: upstream.status, body: masked };
  }
}
