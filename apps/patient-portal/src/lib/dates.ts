/**
 * Date helpers shared by the results timeline and other views.
 */

/** Returns the YYYY-MM-DD bucket key for an ISO date/datetime string. */
export function dateBucketKey(iso: string | undefined | null): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toISOString().slice(0, 10);
}

export interface DateGroup<T> {
  /** YYYY-MM-DD (or "unknown"). */
  key: string;
  items: T[];
}

/**
 * Groups items into date buckets using `getDate(item)` to extract an ISO date.
 * Buckets are returned newest-first; "unknown" sorts last.
 */
export function groupByDate<T>(items: readonly T[], getDate: (item: T) => string | undefined | null): DateGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = dateBucketKey(getDate(item));
    const existing = buckets.get(key);
    if (existing) {
      existing.push(item);
    } else {
      buckets.set(key, [item]);
    }
  }
  return Array.from(buckets.entries())
    .map(([key, groupItems]) => ({ key, items: groupItems }))
    .sort((a, b) => {
      if (a.key === "unknown") return 1;
      if (b.key === "unknown") return -1;
      return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
    });
}

/** Locale-aware medium date formatting. Falls back to the raw string on parse failure. */
export function formatDate(iso: string | undefined | null, locale = "en"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(d);
}

/** Locale-aware date + time formatting. */
export function formatDateTime(iso: string | undefined | null, locale = "en"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
