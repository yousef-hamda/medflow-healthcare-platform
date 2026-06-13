/**
 * src/filters.ts — Pure parameterized SQL filter builder for GET /v1/events.
 *
 * Returns a { where, params } object — never interpolates values directly into
 * SQL strings.  The caller appends WHERE + where to the base query and spreads
 * params as positional $N parameters.
 *
 * Design: each call to addClause() allocates the next positional index so that
 * callers can append additional params (e.g. for LIMIT / keyset pagination)
 * starting at nextParamIndex.
 */

export interface EventFilters {
  /** Filter by actor_id */
  actor?: string;
  /** Filter by action */
  action?: string;
  /** Filter by resource_type */
  resourceType?: string;
  /** Filter by resource_id */
  resourceId?: string;
  /** Lower bound on ts (inclusive) */
  from?: string;
  /** Upper bound on ts (inclusive) */
  to?: string;
  /** If true, only rows where justification IS NOT NULL */
  breakGlassOnly?: boolean;
  /** Keyset pagination: only rows with id > afterId */
  afterId?: string;
}

export interface FilterResult {
  /** SQL fragment: "col1 = $1 AND col2 >= $2" (empty string when no filters) */
  where: string;
  /** Positional parameter values matching $1, $2, … in where */
  params: unknown[];
  /** The next available positional index ($N) after all filters */
  nextParamIndex: number;
}

/**
 * Build a parameterized WHERE clause from the provided filters.
 *
 * @param filters  - Parsed query parameters
 * @param startAt  - First positional parameter index (default 1).
 *                   Pass a value >1 if you already have bound params.
 * @returns FilterResult with where clause, bound params, and next index.
 */
export function buildFilterClause(
  filters: EventFilters,
  startAt = 1,
): FilterResult {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let idx = startAt;

  function addClause(sql: string, value: unknown): void {
    clauses.push(sql.replace("?", `$${idx}`));
    params.push(value);
    idx++;
  }

  if (filters.actor !== undefined && filters.actor !== "") {
    addClause("actor_id = ?", filters.actor);
  }

  if (filters.action !== undefined && filters.action !== "") {
    addClause("action = ?", filters.action);
  }

  if (filters.resourceType !== undefined && filters.resourceType !== "") {
    addClause("resource_type = ?", filters.resourceType);
  }

  if (filters.resourceId !== undefined && filters.resourceId !== "") {
    addClause("resource_id = ?", filters.resourceId);
  }

  if (filters.from !== undefined && filters.from !== "") {
    addClause("ts >= ?", filters.from);
  }

  if (filters.to !== undefined && filters.to !== "") {
    addClause("ts <= ?", filters.to);
  }

  if (filters.breakGlassOnly === true) {
    // No parameter needed — just a predicate
    clauses.push("justification IS NOT NULL");
  }

  if (filters.afterId !== undefined && filters.afterId !== "") {
    addClause("id > ?", BigInt(filters.afterId));
  }

  const where = clauses.length > 0 ? clauses.join(" AND ") : "";

  return { where, params, nextParamIndex: idx };
}
