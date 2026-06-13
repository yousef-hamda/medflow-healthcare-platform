import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import type { TokenPayload } from '../auth/token-signer';
import { AnalyticsService, type CohortResult, type WorklistEntry } from './analytics.service';
import { CohortQueryDto } from './dto/cohort.dto';

@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @ApiTags('Analytics')
  @Post('analytics/cohort')
  @ApiOperation({ summary: 'Count + demographics for an OMOP cohort definition' })
  cohort(@Body() dto: CohortQueryDto): Promise<CohortResult> {
    return this.analytics.runCohort(dto.criteria);
  }

  @ApiTags('Analytics')
  @Get('analytics/audit')
  @ApiOperation({ summary: 'Search the audit log (proxied to audit-service)' })
  audit(@Query() query: Record<string, string>): Promise<unknown> {
    return this.analytics.searchAudit(query);
  }

  @ApiTags('Clinical Workflow')
  @Get('worklist')
  @ApiOperation({
    summary: 'Care-team patients with their latest cached risk score',
  })
  worklist(@CurrentUser() user: TokenPayload): Promise<WorklistEntry[]> {
    return this.analytics.getWorklist(user.sub);
  }

  @ApiTags('Admin')
  @Get('admin/models')
  @ApiOperation({ summary: 'Registered ML models (MLflow passthrough)' })
  models(): Promise<unknown> {
    return this.analytics.listModels();
  }
}
