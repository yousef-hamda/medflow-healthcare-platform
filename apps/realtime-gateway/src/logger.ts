/**
 * Pino logger factory with PHI redaction.
 * buildPinoRedactPaths() covers name, mrn, ssn, dob, birthDate, phone, email,
 * address, telecom at the top level and several nesting depths.
 */

import pino from "pino";
import { buildPinoRedactPaths } from "@medflow/shared-types";

export function createLogger(level: string = "info") {
  return pino({
    level,
    redact: {
      paths: buildPinoRedactPaths(["req.body", "data", "event"]),
      censor: "[REDACTED]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { service: "realtime-gateway" },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
