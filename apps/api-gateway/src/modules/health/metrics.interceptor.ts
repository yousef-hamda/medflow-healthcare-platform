import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { MetricsService } from './metrics.service';

/** Records request count + latency into Prometheus for every HTTP request. */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const end = this.metrics.httpRequestDuration.startTimer();

    const route = (): string => {
      const r = req.route as { path?: string } | undefined;
      return r?.path ?? req.path ?? 'unknown';
    };

    const record = (): void => {
      const labels = {
        method: req.method,
        route: route(),
        status: String(res.statusCode),
      };
      this.metrics.httpRequestsTotal.inc(labels);
      end(labels);
    };

    return next.handle().pipe(tap({ next: record, error: record }));
  }
}
