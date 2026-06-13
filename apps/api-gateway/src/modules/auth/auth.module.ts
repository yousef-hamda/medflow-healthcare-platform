import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ScopesGuard } from './scopes.guard';
import { Hs256TokenSigner, TokenSigner } from './token-signer';
import { User } from '../users/entities/user.entity';
import { ShareToken } from '../share/entities/share-token.entity';
import { RateLimitModule } from '../rate-limit/rate-limit.module';

export const TOKEN_SIGNER_TOKEN = 'TOKEN_SIGNER';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, ShareToken]),
    RateLimitModule,
  ],
  controllers: [AuthController],
  providers: [
    {
      provide: TOKEN_SIGNER_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService): TokenSigner => {
        const key = config.getOrThrow<string>('JWT_SIGNING_KEY');
        return new Hs256TokenSigner(key);
      },
    },
    AuthService,
    JwtAuthGuard,
    ScopesGuard,
  ],
  exports: [AuthService, JwtAuthGuard, ScopesGuard, TOKEN_SIGNER_TOKEN],
})
export class AuthModule {}
