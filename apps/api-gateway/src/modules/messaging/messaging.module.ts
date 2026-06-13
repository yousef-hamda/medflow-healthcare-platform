import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { MessageThread } from './entities/message-thread.entity';
import { Message } from './entities/message.entity';
import { MessagingService } from './messaging.service';
import { MessagingController } from './messaging.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([MessageThread, Message]),
    AuthModule,
    UsersModule,
  ],
  controllers: [MessagingController],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
