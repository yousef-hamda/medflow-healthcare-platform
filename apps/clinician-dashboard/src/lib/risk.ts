import type { WorklistItem } from "@/lib/api/types";

/**
 * The primary risk used to rank a worklist row: the gateway-provided blended
 * `primaryScore` when present, otherwise the max of the component model scores.
 */
export function primaryRisk(item: WorklistItem): number {
  if (typeof item.primaryScore === "number" && !Number.isNaN(item.primaryScore)) {
    return item.primaryScore;
  }
  const candidates = [item.sepsisScore, item.readmissionScore].filter(
    (n): n is number => typeof n === "number" && !Number.isNaN(n),
  );
  return candidates.length ? Math.max(...candidates) : 0;
}

/**
 * Stable descending sort by primary risk. Ties preserve input order so live
 * promotions (which reorder the source array) stay deterministic.
 */
export function sortWorklistByRisk(items: readonly WorklistItem[]): WorklistItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const diff = primaryRisk(b.item) - primaryRisk(a.item);
      if (diff !== 0) return diff;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

export type WorklistSortKey =
  | "primary"
  | "sepsis"
  | "readmission"
  | "name"
  | "updated";

export type SortDirection = "asc" | "desc";

function valueForKey(item: WorklistItem, key: WorklistSortKey): number | string {
  switch (key) {
    case "primary":
      return primaryRisk(item);
    case "sepsis":
      return item.sepsisScore ?? -1;
    case "readmission":
      return item.readmissionScore ?? -1;
    case "name":
      return item.name.toLocaleLowerCase();
    case "updated":
      return Date.parse(item.updatedAt) || 0;
  }
}

/** Generic, stable, direction-aware sort for any worklist column. */
export function sortWorklist(
  items: readonly WorklistItem[],
  key: WorklistSortKey,
  direction: SortDirection,
): WorklistItem[] {
  const factor = direction === "asc" ? 1 : -1;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const av = valueForKey(a.item, key);
      const bv = valueForKey(b.item, key);
      let cmp: number;
      if (typeof av === "string" && typeof bv === "string") {
        cmp = av.localeCompare(bv);
      } else {
        cmp = (av as number) - (bv as number);
      }
      if (cmp !== 0) return cmp * factor;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}
