import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { MlService } from './ml.service';
import { MlController } from './ml.controller';

@Module({
  imports: [AuthModule],
  controllers: [MlController],
  providers: [
    {
      provide: MlService,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MlService => new MlService(config),
    },
  ],
  exports: [MlService],
})
export class MlModule {}
