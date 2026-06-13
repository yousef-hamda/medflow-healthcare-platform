import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { REDIS_TOKEN } from '../rate-limit/redis.provider';
import { UsersService } from '../users/users.service';
import { TrinoClient } from './trino-client';
import { buildCohortQuery, type CohortCriteria } from './cohort-sql';

export type FetchFn = typeof fetch;

export interface CohortResult {
  count: number;
  demographics: {
    byGender: Record<string, number>;
    byAgeBand: Record<string, number>;
  };
}

export interface WorklistEntry {
  patientId: string;
  latestRiskScore: number | null;
  latestRiskBand: string | null;
  model: string | null;
}

/** Redis key holding a patient's most-recent risk score (written by ml-serving). */
const riskKey = (patientId: string): string => `risk:latest:${patientId}`;

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly trino: TrinoClient;
  private readonly auditServiceUrl: string;
  private readonly mlflowUrl: string;

  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.trino = new TrinoClient(
      config.getOrThrow<string>('TRINO_URL'),
      this.fetchFn,
    );
    this.auditServiceUrl = config
      .getOrThrow<string>('AUDIT_SERVICE_URL')
      .replace(/\/$/, '');
    this.mlflowUrl = (config.get<string>('MLFLOW_URL') ?? 'http://mlflow:5000').replace(
      /\/$/,
      '',
    );
  }

  // ── Cohort ─────────────────────────────────────────────────────────────────

  async runCohort(criteria: CohortCriteria): Promise<CohortResult> {
    const { countSql, demographicsSql } = buildCohortQuery(criteria);

    const [countResult, demoResult] = await Promise.all([
      this.trino.query(countSql),
      this.trino.query(demographicsSql),
    ]);

    const count =
      countResult.rows.length > 0 ? Number(countResult.rows[0][0]) : 0;

    const byGender: Record<string, number> = {};
    const byAgeBand: Record<string, number> = {};
    const gIdx = demoResult.columns.indexOf('gender');
    const aIdx = demoResult.columns.indexOf('age_band');
    const nIdx = demoResult.columns.indexOf('n');

    for (const row of demoResult.rows) {
      const gender = String(row[gIdx]);
      const ageBand = String(row[aIdx]);
      const n = Number(row[nIdx]);
      byGender[gender] = (byGender[gender] ?? 0) + n;
      byAgeBand[ageBand] = (byAgeBand[ageBand] ?? 0) + n;
    }

    return { count, demographics: { byGender, byAgeBand } };
  }

  // ── Audit search proxy ───────────────────────────────────────────────────

  async searchAudit(query: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(query).toString();
    const url = `${this.auditServiceUrl}/search${qs ? `?${qs}` : ''}`;
    try {
      const res = await this.fetchFn(url, { method: 'GET' });
      if (!res.ok) {
        return { error: 'audit_service_error', status: res.status };
      }
      return (await res.json()) as unknown;
    } catch (err) {
      this.logger.error(
        `Audit search failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { error: 'audit_service_unavailable' };
    }
  }

  // ── Worklist ───────────────────────────────────────────────────────────────

  /** Care-team patients for a clinician, joined with their latest risk score. */
  async getWorklist(userId: string): Promise<WorklistEntry[]> {
    const patientIds = await this.usersService.getCareTeamPatientIds(userId);
    if (patientIds.length === 0) return [];

    const keys = patientIds.map(riskKey);
    const values = await this.redis.mget(...keys);

    return patientIds.map((patientId, i) => {
      const raw = values[i];
      if (!raw) {
        return {
          patientId,
          latestRiskScore: null,
          latestRiskBand: null,
          model: null,
        };
      }
      try {
        const parsed = JSON.parse(raw) as {
          score?: number;
          band?: string;
          model?: string;
        };
        return {
          patientId,
          latestRiskScore: parsed.score ?? null,
          latestRiskBand: parsed.band ?? null,
          model: parsed.model ?? null,
        };
      } catch {
        return {
          patientId,
          latestRiskScore: null,
          latestRiskBand: null,
          model: null,
        };
      }
    });
  }

  // ── MLflow model registry passthrough ───────────────────────────────────

  async listModels(): Promise<unknown> {
    const url = `${this.mlflowUrl}/api/2.0/mlflow/registered-models/search`;
    try {
      const res = await this.fetchFn(url, { method: 'GET' });
      if (!res.ok) {
        return { error: 'mlflow_error', status: res.status };
      }
      return (await res.json()) as unknown;
    } catch (err) {
      this.logger.error(
        `MLflow query failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { error: 'mlflow_unavailable' };
    }
  }
}
