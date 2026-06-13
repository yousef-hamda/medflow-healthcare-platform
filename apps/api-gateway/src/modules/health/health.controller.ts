import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Response } from 'express';
import { Public } from '../auth/jwt-auth.guard';
import { MetricsService } from './metrics.service';

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly metrics: MetricsService,
  ) {}

  @Get('healthz')
  @Public()
  @ApiOperation({ summary: 'Liveness + DB readiness probe' })
  async healthz(): Promise<{ status: string; checks: Record<string, string> }> {
    const checks: Record<string, string> = {};
    try {
      await this.dataSource.query('SELECT 1');
      checks['database'] = 'up';
    } catch {
      checks['database'] = 'down';
    }
    const ok = Object.values(checks).every((v) => v === 'up');
    return { status: ok ? 'ok' : 'degraded', checks };
  }

  @Get('metrics')
  @Public()
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metricsEndpoint(@Res() res: Response): Promise<void> {
    res.type(this.metrics.contentType());
    res.send(await this.metrics.metrics());
  }
}
