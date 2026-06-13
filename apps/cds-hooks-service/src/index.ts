/**
 * Process entrypoint for the CDS Hooks service.
 *
 * Import order matters: telemetry.ts must load (and its SDK start) before any
 * instrumented libraries (fastify, pg) so auto-instrumentation patches apply.
 */

import { startTelemetry } from './telemetry.js';

startTelemetry();

import { config } from './config.js';
import { logger } from './logger.js';
import { buildApp } from './app.js';
import { ensureFeedbackTable, closePool } from './db/feedbackStore.js';

async function main(): Promise<void> {
  // Feedback persistence is best-effort at startup: log and continue so the
  // hook endpoints remain available even if Postgres is briefly unreachable.
  try {
    await ensureFeedbackTable(config.databaseUrl);
  } catch (err) {
    logger.warn({ err: String(err) }, 'Could not ensure cds_feedback table at startup');
  }

  const app = await buildApp(config);

  await app.listen({ host: '0.0.0.0', port: config.httpPort });
  logger.info({ port: config.httpPort }, 'cds-hooks-service listening');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down...');
    try {
      await app.close();
      await closePool();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err: String(err) }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.error({ err: String(err) }, 'Fatal startup error');
  process.exit(1);
});
