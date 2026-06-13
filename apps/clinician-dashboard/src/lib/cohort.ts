import type { CohortResponseRaw } from "@/lib/api/types";

export type GenderCriterionValue = "male" | "female" | "other";

export interface AgeRangeCriterion {
  id: string;
  type: "ageRange";
  minAge: number;
  maxAge: number;
}

export interface GenderCriterion {
  id: string;
  type: "gender";
  gender: GenderCriterionValue;
}

export interface CodeCriterion {
  id: string;
  type: "condition" | "medication";
  code: string;
  display: string;
}

export type CohortCriterion = AgeRangeCriterion | GenderCriterion | CodeCriterion;

export interface SavedCohort {
  name: string;
  criteria: CohortCriterion[];
  savedAt: string;
}

export interface AgeBucket {
  bucket: string;
  count: number;
}

export interface GenderSlice {
  gender: string;
  count: number;
}

export interface NormalizedCohort {
  count: number;
  ageBuckets: AgeBucket[];
  genderBreakdown: GenderSlice[];
}

/**
 * Normalizes the gateway's `{count, demographics}` payload into chart-ready
 * arrays. Tolerant of missing demographics (renders count only).
 */
export function mapCohortResponse(raw: CohortResponseRaw): NormalizedCohort {
  const ageBuckets: AgeBucket[] = (raw.demographics?.ageBuckets ?? []).map((b) => ({
    bucket: b.bucket,
    count: b.count,
  }));

  const genderBreakdown: GenderSlice[] = Object.entries(raw.demographics?.gender ?? {}).map(
    ([gender, count]) => ({ gender, count }),
  );

  return {
    count: typeof raw.count === "number" ? raw.count : 0,
    ageBuckets,
    genderBreakdown,
  };
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function describeCriterion(c: CohortCriterion): string {
  switch (c.type) {
    case "ageRange":
      return `Age ${c.minAge}–${c.maxAge}`;
    case "gender":
      return `Gender = ${c.gender}`;
    case "condition":
      return `Condition: ${c.display} (${c.code})`;
    case "medication":
      return `Medication: ${c.display} (${c.code})`;
  }
}

/**
 * Serializes the current criteria and result summary as CSV text suitable for
 * a Blob download. Two sections: criteria rows, then a result summary.
 */
export function criteriaToCsv(
  criteria: readonly CohortCriterion[],
  result: NormalizedCohort | null,
): string {
  const lines: string[] = [];
  lines.push("section,index,type,detail");
  criteria.forEach((c, i) => {
    lines.push(
      ["criterion", String(i + 1), c.type, describeCriterion(c)].map(escapeCsv).join(","),
    );
  });

  if (result) {
    lines.push("");
    lines.push("section,key,value");
    lines.push(["result", "count", String(result.count)].map(escapeCsv).join(","));
    for (const b of result.ageBuckets) {
      lines.push(["result", `age:${b.bucket}`, String(b.count)].map(escapeCsv).join(","));
    }
    for (const g of result.genderBreakdown) {
      lines.push(["result", `gender:${g.gender}`, String(g.count)].map(escapeCsv).join(","));
    }
  }

  return lines.join("\n");
}

/**
 * Shapes criteria into the gateway's `/analytics/cohort` request body.
 * Keeps the wire format explicit and testable.
 */
export function criteriaToRequest(criteria: readonly CohortCriterion[]): Record<string, unknown> {
  const age = criteria.find((c): c is AgeRangeCriterion => c.type === "ageRange");
  const gender = criteria.find((c): c is GenderCriterion => c.type === "gender");
  const conditions = criteria
    .filter((c): c is CodeCriterion => c.type === "condition")
    .map((c) => c.code);
  const medications = criteria
    .filter((c): c is CodeCriterion => c.type === "medication")
    .map((c) => c.code);

  return {
    criteria,
    filters: {
      ageMin: age?.minAge,
      ageMax: age?.maxAge,
      gender: gender?.gender,
      conditions,
      medications,
    },
  };
}
