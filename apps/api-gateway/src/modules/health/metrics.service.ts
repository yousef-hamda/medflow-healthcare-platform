import { Injectable } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from 'prom-client';

/**
 * Prometheus registry + app metrics. Default Node/process metrics are collected
 * automatically; HTTP request count/latency are exposed for the gateway.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpRequestsTotal = new Counter({
    name: 'gateway_http_requests_total',
    help: 'Total HTTP requests handled by the gateway',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });

  readonly httpRequestDuration = new Histogram({
    name: 'gateway_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  constructor() {
    this.registry.setDefaultLabels({ service: 'api-gateway' });
    collectDefaultMetrics({ register: this.registry });
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }
}
