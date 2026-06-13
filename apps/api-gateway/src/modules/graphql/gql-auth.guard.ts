import {
  CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { parseSmartScopes } from '@medflow/shared-types';
import type { SmartScope } from '@medflow/shared-types';
import type { TokenPayload } from '../auth/token-signer';

export interface GqlAuthedRequest extends Request {
  user?: TokenPayload;
  grantedScopes?: SmartScope[];
}

/**
 * JWT guard for GraphQL resolvers. Mirrors the HTTP JwtAuthGuard but resolves
 * the request from the GraphQL execution context and attaches the verified
 * payload + parsed scopes to it.
 */
@Injectable()
export class GqlAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const gqlCtx = GqlExecutionContext.create(context);
    const req = gqlCtx.getContext<{ req: GqlAuthedRequest }>().req;

    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    let payload: TokenPayload;
    try {
      payload = this.authService.verifyToken(auth.slice(7));
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload.jti && (await this.authService.isTokenRevoked(payload.jti))) {
      throw new UnauthorizedException('Token has been revoked');
    }

    req.user = payload;
    req.grantedScopes = parseSmartScopes(payload.scope ?? '').resourceScopes;
    return true;
  }
}
