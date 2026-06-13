/**
 * OMOP cohort SQL builder.
 *
 * Trino's REST API has no bind-parameter protocol, so we must build SQL as a
 * string. To stay injection-safe we NEVER interpolate raw user values:
 *   - numbers are validated as finite integers and rendered numerically;
 *   - strings are escaped via `quoteLiteral` (single-quote doubling) and only
 *     ever appear inside a quoted SQL literal;
 *   - identifiers (table/column names) are fixed constants in this file.
 *
 * The builder targets the OMOP "gold" schema in the lakehouse catalog.
 */

export interface CohortCriteria {
  ageRange?: { min?: number; max?: number };
  gender?: 'male' | 'female' | 'other' | 'unknown';
  /** OMOP concept ids for conditions (SNOMED-mapped). */
  conditions?: number[];
  /** OMOP concept ids for drug exposures (RxNorm-mapped). */
  medications?: number[];
}

const CATALOG = 'lakehouse';
const SCHEMA = 'omop_gold';

/** Genders accepted from the API → OMOP gender_concept_id. */
const GENDER_CONCEPT: Record<string, number> = {
  male: 8507,
  female: 8532,
  other: 0,
  unknown: 0,
};

/**
 * Escapes a string for safe inclusion as a SQL string literal by doubling
 * embedded single quotes and stripping NUL bytes. The result must always be
 * wrapped in single quotes by the caller (this function returns the quoted
 * literal itself).
 */
export function quoteLiteral(value: string): string {
  // Remove NULs (illegal in Trino literals) and double single-quotes.
  const sanitized = value.replace(/\0/g, '').replace(/'/g, "''");
  return `'${sanitized}'`;
}

/** Validates and renders a finite, safe integer for SQL. Throws otherwise. */
function safeInt(value: number, label: string): string {
  if (!Number.isInteger(value) || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite integer`);
  }
  if (value < 0 || value > 1_000_000_000) {
    throw new Error(`${label} out of allowed range`);
  }
  return String(value);
}

export interface BuiltQuery {
  /** Counts matching distinct persons. */
  countSql: string;
  /** Returns gender + age-band breakdown for matching persons. */
  demographicsSql: string;
}

/**
 * Builds the WHERE clause fragments shared by the count and demographics
 * queries. Returns an array of already-safe SQL predicates.
 */
function buildPredicates(criteria: CohortCriteria): string[] {
  const predicates: string[] = [];

  if (criteria.ageRange) {
    const { min, max } = criteria.ageRange;
    if (min !== undefined) {
      predicates.push(
        `date_diff('year', date(format_datetime(date(p.birth_datetime), 'yyyy-MM-dd')), current_date) >= ${safeInt(
          min,
          'ageRange.min',
        )}`,
      );
    }
    if (max !== undefined) {
      predicates.push(
        `date_diff('year', date(format_datetime(date(p.birth_datetime), 'yyyy-MM-dd')), current_date) <= ${safeInt(
          max,
          'ageRange.max',
        )}`,
      );
    }
  }

  if (criteria.gender) {
    const conceptId = GENDER_CONCEPT[criteria.gender];
    // gender is constrained by the DTO enum; still render numerically.
    predicates.push(`p.gender_concept_id = ${safeInt(conceptId, 'gender')}`);
  }

  if (criteria.conditions && criteria.conditions.length > 0) {
    const ids = criteria.conditions
      .map((c) => safeInt(c, 'conditions[]'))
      .join(', ');
    predicates.push(
      `p.person_id IN (SELECT co.person_id FROM ${CATALOG}.${SCHEMA}.condition_occurrence co WHERE co.condition_concept_id IN (${ids}))`,
    );
  }

  if (criteria.medications && criteria.medications.length > 0) {
    const ids = criteria.medications
      .map((m) => safeInt(m, 'medications[]'))
      .join(', ');
    predicates.push(
      `p.person_id IN (SELECT de.person_id FROM ${CATALOG}.${SCHEMA}.drug_exposure de WHERE de.drug_concept_id IN (${ids}))`,
    );
  }

  return predicates;
}

export function buildCohortQuery(criteria: CohortCriteria): BuiltQuery {
  const predicates = buildPredicates(criteria);
  const where = predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : '';
  const person = `${CATALOG}.${SCHEMA}.person p`;

  const countSql = `SELECT count(DISTINCT p.person_id) AS cohort_count FROM ${person} ${where}`;

  const demographicsSql = `
SELECT
  CASE p.gender_concept_id WHEN 8507 THEN 'male' WHEN 8532 THEN 'female' ELSE 'other' END AS gender,
  CASE
    WHEN date_diff('year', date(p.birth_datetime), current_date) < 18 THEN '0-17'
    WHEN date_diff('year', date(p.birth_datetime), current_date) < 40 THEN '18-39'
    WHEN date_diff('year', date(p.birth_datetime), current_date) < 65 THEN '40-64'
    ELSE '65+'
  END AS age_band,
  count(DISTINCT p.person_id) AS n
FROM ${person} ${where}
GROUP BY 1, 2`.trim();

  return { countSql, demographicsSql };
}
