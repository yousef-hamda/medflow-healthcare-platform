import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { parseSmartScopes } from '@medflow/shared-types';
import type { SmartScope } from '@medflow/shared-types';
import type { TokenPayload } from './token-signer';

export interface AuthenticatedRequest extends Request {
  user: TokenPayload;
  grantedScopes: SmartScope[];
}

export const IS_PUBLIC_KEY = 'isPublic';

/** Mark a route handler as publicly accessible (no JWT required). */
export function Public(): MethodDecorator & ClassDecorator {
  return (
    target: object,
    key?: string | symbol,
    descriptor?: TypedPropertyDescriptor<unknown>,
  ) => {
    if (descriptor) {
      Reflect.defineMetadata(IS_PUBLIC_KEY, true, descriptor.value as object);
      return descriptor;
    }
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, target);
    return target;
  };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check @Public() decorator
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    let payload: TokenPayload;
    try {
      payload = this.authService.verifyToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Check JTI revocation list (share token revocation)
    if (payload.jti) {
      const revoked = await this.authService.isTokenRevoked(payload.jti);
      if (revoked) {
        throw new UnauthorizedException('Token has been revoked');
      }
    }

    const { resourceScopes } = parseSmartScopes(payload.scope ?? '');
    request.user = payload;
    request.grantedScopes = resourceScopes;
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const auth = request.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return undefined;
    return auth.slice(7);
  }
}
