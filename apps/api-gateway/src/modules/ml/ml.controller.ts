import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ScopesGuard, RequiredScopes } from '../auth/scopes.guard';
import { MlService, type MlProxyResult } from './ml.service';
import { SepsisPredictDto, ReadmissionPredictDto } from './dto/predict.dto';

/** Track header value — distinguishes production vs canary serving lanes. */
const MODEL_TRACK = process.env['ML_MODEL_TRACK'] ?? 'production';

@ApiTags('ML Inference')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ScopesGuard)
@Controller('ml')
export class MlController {
  constructor(private readonly ml: MlService) {}

  @Post('sepsis')
  @RequiredScopes({ resourceType: 'RiskScore', permission: 'read' })
  @ApiOperation({ summary: 'Sepsis risk inference' })
  async sepsis(
    @Body() dto: SepsisPredictDto,
    @Res() res: Response,
  ): Promise<void> {
    this.send(res, await this.ml.predict('sepsis', dto));
  }

  @Post('readmission')
  @RequiredScopes({ resourceType: 'RiskScore', permission: 'read' })
  @ApiOperation({ summary: 'Readmission risk inference' })
  async readmission(
    @Body() dto: ReadmissionPredictDto,
    @Res() res: Response,
  ): Promise<void> {
    this.send(res, await this.ml.predict('readmission', dto));
  }

  @Post('chest-xray')
  @ApiConsumes('multipart/form-data')
  @RequiredScopes({ resourceType: 'RiskScore', permission: 'read' })
  @ApiOperation({ summary: 'Chest X-ray classification (multipart passthrough)' })
  async chestXray(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const contentType = req.headers['content-type'] ?? 'application/octet-stream';
    const buffer = await this.readRawBody(req);
    this.send(res, await this.ml.predictImage(buffer, contentType));
  }

  private send(res: Response, result: MlProxyResult): void {
    res
      .status(result.status)
      .setHeader('X-Model-Track', MODEL_TRACK);
    if (result.modelVersion) {
      res.setHeader('X-Model-Version', result.modelVersion);
    }
    res.json(result.body);
  }

  /** Collects the raw request stream so multipart boundaries are forwarded intact. */
  private readRawBody(req: Request): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
}
