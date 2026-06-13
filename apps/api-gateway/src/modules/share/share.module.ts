import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ShareToken } from './entities/share-token.entity';
import { ShareService } from './share.service';
import { ShareController } from './share.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ShareToken]), AuthModule],
  controllers: [ShareController],
  providers: [ShareService],
  exports: [ShareService],
})
export class ShareModule {}
