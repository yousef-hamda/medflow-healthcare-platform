import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import type { TokenPayload } from '../auth/token-signer';
import { ShareService } from './share.service';
import { CreateShareTokenDto } from './dto/create-share-token.dto';

@ApiTags('Share')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('share/tokens')
export class ShareController {
  constructor(private readonly shareService: ShareService) {}

  @Post()
  @ApiOperation({
    summary: 'Mint a client-credentials share token (max 72h lifetime)',
  })
  create(
    @CurrentUser() user: TokenPayload,
    @Body() dto: CreateShareTokenDto,
  ): Promise<unknown> {
    return this.shareService.create(user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List share tokens owned by the current user' })
  list(@CurrentUser() user: TokenPayload): Promise<unknown> {
    return this.shareService.listForOwner(user.sub);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one share token (metadata only, no secret)' })
  get(
    @CurrentUser() user: TokenPayload,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.shareService.getForOwner(user.sub, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a share token' })
  async revoke(
    @CurrentUser() user: TokenPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.shareService.revoke(user.sub, id);
  }
}
