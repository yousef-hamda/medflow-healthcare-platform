import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_TOKEN } from '../rate-limit/redis.provider';
import { FhirProxyService } from '../fhir-proxy/fhir-proxy.service';
import type { SmartScope } from '@medflow/shared-types';
import type { PatientModel } from './models/patient.model';
import type { ObservationModel } from './models/observation.model';
import type {
  PatientAggregateModel,
  RiskScoreModel,
} from './models/risk-score.model';

interface FhirBundleLike {
  resourceType?: string;
  total?: number;
  entry?: Array<{ resource?: Record<string, unknown> }>;
}

const riskKey = (patientId: string): string => `risk:latest:${patientId}`;

@Injectable()
export class GraphqlService {
  constructor(
    private readonly fhir: FhirProxyService,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
  ) {}

  async getPatient(
    id: string,
    grantedScopes: readonly SmartScope[],
    contextPatient: string | undefined,
  ): Promise<PatientModel | null> {
    const res = await this.fhir.proxy({
      method: 'GET',
      path: `Patient/${id}`,
      search: new URLSearchParams(),
      grantedScopes,
      contextPatient,
    });
    if (res.status !== 200 || typeof res.body !== 'object' || res.body === null) {
      return null;
    }
    const p = res.body as Record<string, unknown>;
    const name = Array.isArray(p['name'])
      ? (p['name'][0] as { text?: string } | undefined)
      : undefined;
    return {
      id: typeof p['id'] === 'string' ? p['id'] : id,
      gender: typeof p['gender'] === 'string' ? p['gender'] : undefined,
      birthDate: typeof p['birthDate'] === 'string' ? p['birthDate'] : undefined,
      displayName: name?.text,
    };
  }

  async getObservations(
    patientId: string,
    grantedScopes: readonly SmartScope[],
    contextPatient: string | undefined,
  ): Promise<ObservationModel[]> {
    const res = await this.fhir.proxy({
      method: 'GET',
      path: 'Observation',
      search: new URLSearchParams({ patient: patientId }),
      grantedScopes,
      contextPatient,
    });
    if (res.status !== 200) return [];
    return this.mapObservations(res.body as FhirBundleLike);
  }

  async getLatestRisk(patientId: string): Promise<RiskScoreModel | null> {
    const raw = await this.redis.get(riskKey(patientId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as {
        score?: number;
        band?: string;
        model?: string;
      };
      return {
        patientId,
        score: parsed.score,
        band: parsed.band,
        model: parsed.model,
      };
    } catch {
      return null;
    }
  }

  async getPatientAggregate(
    patientId: string,
    grantedScopes: readonly SmartScope[],
    contextPatient: string | undefined,
  ): Promise<PatientAggregateModel> {
    const [observations, latestRisk] = await Promise.all([
      this.getObservations(patientId, grantedScopes, contextPatient),
      this.getLatestRisk(patientId),
    ]);
    return {
      patientId,
      observationCount: observations.length,
      latestRisk: latestRisk ?? undefined,
    };
  }

  private mapObservations(bundle: FhirBundleLike): ObservationModel[] {
    const entries = bundle.entry ?? [];
    const out: ObservationModel[] = [];
    for (const entry of entries) {
      const r = entry.resource;
      if (!r || r['resourceType'] !== 'Observation') continue;
      const code = r['code'] as
        | { coding?: Array<{ code?: string; display?: string }> }
        | undefined;
      const coding = code?.coding?.[0];
      const valueQuantity = r['valueQuantity'] as
        | { value?: number; unit?: string }
        | undefined;
      out.push({
        id: typeof r['id'] === 'string' ? r['id'] : '',
        code: coding?.code ?? 'unknown',
        display: coding?.display,
        value: valueQuantity?.value,
        unit: valueQuantity?.unit,
        effectiveDateTime:
          typeof r['effectiveDateTime'] === 'string'
            ? r['effectiveDateTime']
            : undefined,
      });
    }
    return out;
  }
}
