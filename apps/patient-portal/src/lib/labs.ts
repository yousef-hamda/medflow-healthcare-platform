import type { Observation, ObservationReferenceRange } from "@medflow/fhir-types";
import { dateBucketKey } from "@/lib/dates";

export type ResultFlag = "low" | "normal" | "high";

export interface RefRange {
  low?: number;
  high?: number;
  text?: string;
  unit?: string;
}

export interface LabResult {
  id: string;
  /** Primary LOINC code, when available. */
  loinc?: string;
  /** Display label for the test. */
  label: string;
  value?: number;
  valueText?: string;
  unit?: string;
  range?: RefRange;
  flag: ResultFlag;
  effective?: string;
  /** Panel/grouping name (category text or "Other"). */
  panel: string;
  observation: Observation;
}

export interface LabPanel {
  panel: string;
  results: LabResult[];
}

/** Extracts the numeric value from an Observation, if it has a quantity. */
function numericValue(obs: Observation): number | undefined {
  return typeof obs.valueQuantity?.value === "number" ? obs.valueQuantity.value : undefined;
}

/** Extracts a non-numeric display value (string / codeable concept). */
function textValue(obs: Observation): string | undefined {
  if (obs.valueString) return obs.valueString;
  if (typeof obs.valueInteger === "number") return String(obs.valueInteger);
  if (typeof obs.valueBoolean === "boolean") return obs.valueBoolean ? "Positive" : "Negative";
  return obs.valueCodeableConcept?.text ?? obs.valueCodeableConcept?.coding?.[0]?.display;
}

function toRefRange(ranges: ObservationReferenceRange[] | undefined): RefRange | undefined {
  const r = ranges?.[0];
  if (!r) return undefined;
  return {
    low: r.low?.value,
    high: r.high?.value,
    text: r.text,
    unit: r.low?.unit ?? r.high?.unit,
  };
}

/**
 * Determines whether a value is low / normal / high relative to a reference
 * range. With no usable range, everything is "normal".
 */
export function flagForValue(value: number | undefined, range: RefRange | undefined): ResultFlag {
  if (value === undefined || !range) return "normal";
  if (typeof range.low === "number" && value < range.low) return "low";
  if (typeof range.high === "number" && value > range.high) return "high";
  return "normal";
}

/** Prefers an interpretation code from the Observation if present, else derives from range. */
function interpretationFlag(obs: Observation, value: number | undefined, range: RefRange | undefined): ResultFlag {
  const code = obs.interpretation?.[0]?.coding?.[0]?.code?.toUpperCase();
  if (code === "L" || code === "LL") return "low";
  if (code === "H" || code === "HH") return "high";
  if (code === "N") return "normal";
  return flagForValue(value, range);
}

function loincCode(obs: Observation): string | undefined {
  return obs.code.coding?.find((c) => c.system?.includes("loinc"))?.code ?? obs.code.coding?.[0]?.code;
}

function panelName(obs: Observation): string {
  const cat = obs.category?.find((c) => c.text || c.coding?.[0]?.display);
  return cat?.text ?? cat?.coding?.[0]?.display ?? "Other";
}

/** Maps a raw FHIR Observation to our simplified LabResult shape. */
export function toLabResult(obs: Observation): LabResult {
  const value = numericValue(obs);
  const range = toRefRange(obs.referenceRange);
  return {
    id: obs.id ?? `${loincCode(obs) ?? "obs"}-${obs.effectiveDateTime ?? Math.random().toString(36).slice(2)}`,
    loinc: loincCode(obs),
    label: obs.code.text ?? obs.code.coding?.[0]?.display ?? loincCode(obs) ?? "Result",
    value,
    valueText: value === undefined ? textValue(obs) : undefined,
    unit: obs.valueQuantity?.unit,
    range,
    flag: interpretationFlag(obs, value, range),
    effective: obs.effectiveDateTime ?? obs.effectivePeriod?.start ?? obs.issued,
    panel: panelName(obs),
    observation: obs,
  };
}

/**
 * Groups Observations into panels keyed by their category/panel. Panels are
 * sorted alphabetically with "Other" last; results within a panel are sorted
 * newest-first.
 */
export function groupResultsByPanel(observations: readonly Observation[]): LabPanel[] {
  const byPanel = new Map<string, LabResult[]>();
  for (const obs of observations) {
    const result = toLabResult(obs);
    const existing = byPanel.get(result.panel);
    if (existing) existing.push(result);
    else byPanel.set(result.panel, [result]);
  }
  return Array.from(byPanel.entries())
    .map(([panel, results]) => ({
      panel,
      results: results.sort((a, b) => (b.effective ?? "").localeCompare(a.effective ?? "")),
    }))
    .sort((a, b) => {
      if (a.panel === "Other") return 1;
      if (b.panel === "Other") return -1;
      return a.panel.localeCompare(b.panel);
    });
}

/** Groups results into date buckets (newest-first), e.g. for a timeline view. */
export function groupResultsByDate(results: readonly LabResult[]): Array<{ key: string; results: LabResult[] }> {
  const buckets = new Map<string, LabResult[]>();
  for (const r of results) {
    const key = dateBucketKey(r.effective);
    const existing = buckets.get(key);
    if (existing) existing.push(r);
    else buckets.set(key, [r]);
  }
  return Array.from(buckets.entries())
    .map(([key, items]) => ({ key, results: items }))
    .sort((a, b) => {
      if (a.key === "unknown") return 1;
      if (b.key === "unknown") return -1;
      return a.key < b.key ? 1 : -1;
    });
}

/** Human-readable reference range, e.g. "70 – 99 mg/dL" or "< 200". */
export function formatRange(range: RefRange | undefined): string | undefined {
  if (!range) return undefined;
  if (range.text) return range.text;
  const unit = range.unit ? ` ${range.unit}` : "";
  if (typeof range.low === "number" && typeof range.high === "number") return `${range.low} – ${range.high}${unit}`;
  if (typeof range.high === "number") return `< ${range.high}${unit}`;
  if (typeof range.low === "number") return `> ${range.low}${unit}`;
  return undefined;
}
