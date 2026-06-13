/** Bullet character used to mask MRN digits. */
const MASK = "•";

/**
 * Masks a medical record number, preserving only the last four characters.
 * "MRN-00012345" -> "••••••••2345". Falsy/short input is handled safely.
 */
export function maskMrn(mrn: string | null | undefined): string {
  if (!mrn) return "";
  const trimmed = String(mrn);
  if (trimmed.length <= 4) {
    // Nothing meaningful to reveal; mask everything to avoid leaking short ids.
    return MASK.repeat(trimmed.length);
  }
  const visible = trimmed.slice(-4);
  const masked = MASK.repeat(trimmed.length - 4);
  return `${masked}${visible}`;
}

/** Last four characters of an MRN, e.g. for compact display ("•••• 1234"). */
export function mrnLast4(mrn: string | null | undefined): string {
  if (!mrn) return "";
  return String(mrn).slice(-4);
}
