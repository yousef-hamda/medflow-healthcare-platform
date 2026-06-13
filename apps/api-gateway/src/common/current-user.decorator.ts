import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../modules/auth/jwt-auth.guard';
import type { TokenPayload } from '../modules/auth/token-signer';

/**
 * Resolves the authenticated TokenPayload set by JwtAuthGuard.
 *
 * Usage:
 *   getMe(@CurrentUser() user: TokenPayload) { ... }
 *   getSub(@CurrentUser('sub') sub: string) { ... }
 */
export const CurrentUser = createParamDecorator(
  (
    field: keyof TokenPayload | undefined,
    ctx: ExecutionContext,
  ): TokenPayload | TokenPayload[keyof TokenPayload] | undefined => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) return undefined;
    return field ? user[field] : user;
  },
);
