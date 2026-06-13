import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VaultCryptoService } from './vault-crypto.service';

export const VAULT_CRYPTO_SERVICE = Symbol('VAULT_CRYPTO_SERVICE');

@Global()
@Module({
  providers: [
    {
      provide: VAULT_CRYPTO_SERVICE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): VaultCryptoService => {
        const addr = config.getOrThrow<string>('VAULT_ADDR');
        const token = config.getOrThrow<string>('VAULT_TOKEN');
        return new VaultCryptoService(addr, token);
      },
    },
  ],
  exports: [VAULT_CRYPTO_SERVICE],
})
export class VaultModule {}
