import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AbacService } from './abac.service';
import type { PolicyAction } from './policy.types';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';

export const REQUIRE_POLICY_KEY = 'abac:requirePolicy';

export interface RequirePolicyMetadata {
  action: PolicyAction;
  resourceType: string;
  /**
   * Request param/query/body key holding the target FHIR Patient id. Defaults
   * to 'patientId'. The guard reads params first, then query, then body.
   */
  patientIdFrom?: string;
}

/**
 * Declares an ABAC requirement on a route handler. Evaluated by AbacGuard,
 * which assembles subject attributes (care-team, self-access, break-glass) and
 * runs the PolicyEngine.
 *
 * @example
 *   @RequirePolicy({ action: 'read', resourceType: 'Observation' })
 *   @Get('patients/:patientId/observations')
 */
export const RequirePolicy = (
  meta: RequirePolicyMetadata,
): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_POLICY_KEY, meta);

@Injectable()
export class AbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly abac: AbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<
      RequirePolicyMetadata | undefined
    >(REQUIRE_POLICY_KEY, [context.getHandler(), context.getClass()]);
    if (!meta) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Unauthenticated');

    const key = meta.patientIdFrom ?? 'patientId';
    const patientId = this.extractPatientId(request, key);

    const decision = await this.abac.evaluate(user, meta.action, {
      resourceType: meta.resourceType,
      patientId,
    });

    if (decision.decision === 'deny') {
      throw new ForbiddenException(decision.reason);
    }
    return true;
  }

  private extractPatientId(
    request: AuthenticatedRequest,
    key: string,
  ): string | undefined {
    const params = request.params as Record<string, string> | undefined;
    const query = request.query as Record<string, unknown> | undefined;
    const body = request.body as Record<string, unknown> | undefined;

    const fromParams = params?.[key];
    if (typeof fromParams === 'string') return fromParams;
    const fromQuery = query?.[key];
    if (typeof fromQuery === 'string') return fromQuery;
    const fromBody = body?.[key];
    if (typeof fromBody === 'string') return fromBody;
    return undefined;
  }
}
