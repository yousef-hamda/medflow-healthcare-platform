import {
  All,
  Controller,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { FhirProxyService } from './fhir-proxy.service';

@ApiTags('FHIR Proxy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fhir')
export class FhirProxyController {
  constructor(private readonly proxy: FhirProxyService) {}

  @All('*')
  @ApiOperation({
    summary:
      'SMART-on-FHIR R4 proxy with patient-context narrowing and minimum-necessary masking',
  })
  async handle(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    // Strip the leading "/fhir/" mount prefix to get the FHIR-relative path.
    const fullPath = req.path.replace(/^\/fhir\/?/, '');
    const queryString = req.url.includes('?')
      ? req.url.slice(req.url.indexOf('?') + 1)
      : '';
    const search = new URLSearchParams(queryString);

    const result = await this.proxy.proxy({
      method: req.method,
      path: fullPath,
      search,
      body: req.body,
      grantedScopes: req.grantedScopes ?? [],
      contextPatient: req.user?.patient,
    });

    res
      .status(result.status)
      .type('application/fhir+json')
      .send(result.body);
  }
}
