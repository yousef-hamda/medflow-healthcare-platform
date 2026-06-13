/**
 * Pino 9.2.0 logger with PHI redaction paths from @medflow/shared-types.
 */

import pino from 'pino';
import { buildPinoRedactPaths } from '@medflow/shared-types';
import { config } from './config.js';

const redactPaths = buildPinoRedactPaths([
  // Extra roots specific to CDS Hooks payloads
  'context',
  'prefetch',
  'body',
  'req.body',
]);

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: redactPaths,
    censor: '[REDACTED]',
  },
  transport:
    config.nodeEnv === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});
