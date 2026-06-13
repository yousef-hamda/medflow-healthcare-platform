import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { scopesAllow } from '@medflow/shared-types';
import type { ScopeRequirement } from '@medflow/shared-types';
import type { AuthenticatedRequest } from './jwt-auth.guard';

export const REQUIRED_SCOPES_KEY = 'requiredScopes';

/**
 * Decorator — attach required SMART scopes to a route handler.
 *
 * @example
 *   @RequiredScopes({ resourceType: 'Patient', permission: 'read' })
 *   @Get(':id')
 *   getPatient() { ... }
 */
export function RequiredScopes(...requirements: ScopeRequirement[]): MethodDecorator {
  return (
    _target: object,
    _key: string | symbol,
    descriptor: TypedPropertyDescriptor<unknown>,
  ) => {
    Reflect.defineMetadata(REQUIRED_SCOPES_KEY, requirements, descriptor.value as object);
    return descriptor;
  };
}

@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requirements = this.reflector.get<ScopeRequirement[] | undefined>(
      REQUIRED_SCOPES_KEY,
      context.getHandler(),
    );

    // No scope requirements declared — allow (auth is handled by JwtAuthGuard)
    if (!requirements || requirements.length === 0) return true;

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();

    const grantedScopes = request.grantedScopes ?? [];

    // All requirements must be satisfied
    const allSatisfied = requirements.every((req) =>
      scopesAllow(grantedScopes, req),
    );

    if (!allSatisfied) {
      throw new ForbiddenException(
        `Insufficient scopes. Required: ${requirements
          .map((r) => `${r.context ?? '*'}/${r.resourceType}.${r.permission}`)
          .join(', ')}`,
      );
    }
    return true;
  }
}
