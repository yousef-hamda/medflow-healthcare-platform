import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import type { TokenPayload } from '../auth/token-signer';
import { AbacService } from './abac.service';
import { AuditService } from '../audit/audit.service';
import { BreakGlassDto } from './dto/break-glass.dto';

@ApiTags('ABAC')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('abac')
export class AbacController {
  constructor(
    private readonly abac: AbacService,
    private readonly audit: AuditService,
  ) {}

  @Post('break-glass')
  @ApiOperation({
    summary:
      'Emergency break-glass access — grants a 1-hour override and records a CRITICAL audit event',
  })
  async breakGlass(
    @CurrentUser() user: TokenPayload,
    @Body() dto: BreakGlassDto,
    @Req() req: Request,
  ): Promise<{ patientId: string; expiresAt: string }> {
    const grant = await this.abac.grantBreakGlass(
      user.sub,
      dto.patientId,
      dto.justification,
    );

    // CRITICAL audit event — break-glass MUST always be reviewable.
    this.audit.enqueue({
      actorId: user.sub,
      actorRole: user.role,
      action: 'POST /abac/break-glass',
      resourceType: 'Patient',
      resourceId: dto.patientId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      justification: `BREAK-GLASS: ${dto.justification}`,
    });

    return grant;
  }
}
