import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import type { TokenPayload } from '../auth/token-signer';
import {
  MessagingService,
  type MessageView,
  type ThreadView,
} from './messaging.service';
import { CreateMessageDto, CreateThreadDto } from './dto/messaging.dto';

@ApiTags('Messaging')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('messaging/threads')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Post()
  @ApiOperation({ summary: 'Create a care-team messaging thread' })
  createThread(
    @CurrentUser() user: TokenPayload,
    @Body() dto: CreateThreadDto,
  ): Promise<ThreadView> {
    return this.messaging.createThread(user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List threads the current user participates in' })
  listThreads(@CurrentUser() user: TokenPayload): Promise<ThreadView[]> {
    return this.messaging.listThreads(user.sub);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a thread' })
  getThread(
    @CurrentUser() user: TokenPayload,
    @Param('id') id: string,
  ): Promise<ThreadView> {
    return this.messaging.getThread(user.sub, id);
  }

  @Post(':id/participants/:userId')
  @ApiOperation({ summary: 'Add a care-team participant to a thread' })
  addParticipant(
    @CurrentUser() user: TokenPayload,
    @Param('id') id: string,
    @Param('userId') newUserId: string,
  ): Promise<ThreadView> {
    return this.messaging.addParticipant(user.sub, id, newUserId);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Post a message to a thread' })
  postMessage(
    @CurrentUser() user: TokenPayload,
    @Param('id') id: string,
    @Body() dto: CreateMessageDto,
  ): Promise<MessageView> {
    return this.messaging.postMessage(user.sub, id, dto);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'List messages in a thread' })
  listMessages(
    @CurrentUser() user: TokenPayload,
    @Param('id') id: string,
  ): Promise<MessageView[]> {
    return this.messaging.listMessages(user.sub, id);
  }
}
