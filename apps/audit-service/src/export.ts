/**
 * src/export.ts — Pure JSONL + gzip framing helpers for daily WORM export.
 *
 * The S3/MinIO upload and DB query live in the route handler (server.ts).
 * These functions handle the serialization and compression so they can be
 * unit-tested without any I/O.
 */

import { createGzip } from "zlib";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

/** A single row as it will appear in the exported JSONL file. */
export interface ExportRow {
  id: string;
  ts: string;
  actor_id: string;
  actor_role: string;
  action: string;
  resource_type: string;
  resource_id: string;
  ip: string | null;
  user_agent: string | null;
  /** Justification is included in export for compliance review */
  justification: string | null;
  hash: string;
  prev_hash: string;
}

/**
 * Serialize an array of rows into a JSONL Buffer (one JSON object per line,
 * newline-terminated).
 *
 * Pure function — no I/O.
 */
export function rowsToJsonl(rows: ExportRow[]): Buffer {
  const lines = rows.map((r) => JSON.stringify(r)).join("\n");
  // Trailing newline for POSIX compliance
  return Buffer.from(lines.length > 0 ? lines + "\n" : "", "utf8");
}

/**
 * Gzip-compress a Buffer and return the compressed Buffer.
 *
 * Pure function (uses zlib streams internally but resolves to a complete
 * Buffer — no external I/O).
 */
export async function gzipBuffer(input: Buffer): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const source = Readable.from([input]);
  const gzip = createGzip();

  // Collect compressed chunks
  gzip.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });

  await pipeline(source, gzip);

  return Buffer.concat(chunks);
}

/**
 * Build the S3 object key for a daily export.
 *
 * Format: audit/YYYY/MM/DD.jsonl.gz
 * Example: audit/2024/01/15.jsonl.gz
 */
export function buildExportKey(date: string): string {
  // date is validated as YYYY-MM-DD by the route handler
  const [year, month, day] = date.split("-");
  return `audit/${year ?? "0000"}/${month ?? "00"}/${day ?? "00"}.jsonl.gz`;
}
