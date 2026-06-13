import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import type { TokenPayload } from '../auth/token-signer';
import { UsersService } from './users.service';
import { CareTeamSummaryDto, UserProfileDto } from './dto/user-profile.dto';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Current authenticated user profile' })
  async getMe(@CurrentUser() user: TokenPayload): Promise<UserProfileDto> {
    return this.usersService.getProfile(user.sub);
  }

  @Get('me/care-team')
  @ApiOperation({ summary: 'Care teams the current clinician belongs to' })
  async getMyCareTeam(
    @CurrentUser() user: TokenPayload,
  ): Promise<CareTeamSummaryDto[]> {
    return this.usersService.getCareTeamsForUser(user.sub);
  }
}
