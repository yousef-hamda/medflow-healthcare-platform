import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request } from 'express';
import type { AuditEvent } from '@medflow/shared-types';
import { AuditService } from './audit.service';
import type { TokenPayload } from '../auth/token-signer';

interface MaybeAuthedRequest extends Request {
  user?: TokenPayload;
}

/**
 * Global interceptor that records an audit event for every handled request.
 * It reads the actor from the JWT (set by JwtAuthGuard) and never touches
 * request/response bodies, so PHI cannot leak into the audit trail.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    // GraphQL / non-HTTP contexts are skipped (audited at resolver level if needed).
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<MaybeAuthedRequest>();
    const user = request.user;

    const event = this.buildEvent(request, user);

    return next.handle().pipe(
      tap({
        next: () => this.audit.enqueue(event),
        error: () => this.audit.enqueue(event),
      }),
    );
  }

  private buildEvent(
    request: MaybeAuthedRequest,
    user: TokenPayload | undefined,
  ): AuditEvent {
    const method = request.method;
    const path = request.path ?? request.url;
    const { resourceType, resourceId } = this.deriveResource(path);

    const justification =
      typeof (request.body as Record<string, unknown> | undefined)
        ?.justification === 'string'
        ? ((request.body as Record<string, string>).justification)
        : undefined;

    return {
      actorId: user?.client_id ?? user?.sub ?? 'anonymous',
      actorRole: user?.role ?? 'anonymous',
      action: `${method} ${path}`,
      resourceType,
      resourceId,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      justification,
    };
  }

  /** Best-effort resource derivation from the path; never includes PHI. */
  private deriveResource(path: string): {
    resourceType: string;
    resourceId: string;
  } {
    // /fhir/Observation/123 → { Observation, 123 }
    const fhirMatch = /\/fhir\/([A-Z][A-Za-z]*)(?:\/([^/?]+))?/.exec(path);
    if (fhirMatch) {
      return {
        resourceType: fhirMatch[1] as string,
        resourceId: fhirMatch[2] ?? '-',
      };
    }
    const segments = path.split('?')[0].split('/').filter(Boolean);
    return {
      resourceType: segments[0] ?? 'root',
      resourceId: '-',
    };
  }
}
