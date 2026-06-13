import { describe, it, expect } from 'vitest';
import { buildCohortQuery, quoteLiteral } from '../src/modules/analytics/cohort-sql';

describe('cohort SQL builder — injection safety', () => {
  it('quoteLiteral doubles single quotes and wraps in quotes', () => {
    expect(quoteLiteral("Robert'); DROP TABLE person;--")).toBe(
      "'Robert''); DROP TABLE person;--'",
    );
  });

  it('renders numeric concept ids without interpolating raw strings', () => {
    const { countSql } = buildCohortQuery({
      conditions: [201826, 4329847],
      medications: [1503297],
    });
    expect(countSql).toContain('condition_concept_id IN (201826, 4329847)');
    expect(countSql).toContain('drug_concept_id IN (1503297)');
  });

  it('rejects non-integer condition ids (would-be injection vector)', () => {
    expect(() =>
      // @ts-expect-error — deliberately passing a malicious string at runtime
      buildCohortQuery({ conditions: ['1); DROP TABLE person;--'] }),
    ).toThrow();
  });

  it('rejects non-finite / fractional ages', () => {
    expect(() => buildCohortQuery({ ageRange: { min: 1.5 } })).toThrow();
    expect(() => buildCohortQuery({ ageRange: { max: Number.POSITIVE_INFINITY } })).toThrow();
  });

  it('produces no WHERE clause for empty criteria', () => {
    const { countSql } = buildCohortQuery({});
    expect(countSql).not.toContain('WHERE');
    expect(countSql).toContain('count(DISTINCT p.person_id)');
  });

  it('maps gender to a fixed numeric concept id', () => {
    const { countSql } = buildCohortQuery({ gender: 'female' });
    expect(countSql).toContain('p.gender_concept_id = 8532');
  });

  it('builds demographics grouping SQL', () => {
    const { demographicsSql } = buildCohortQuery({ gender: 'male' });
    expect(demographicsSql).toContain('GROUP BY 1, 2');
    expect(demographicsSql).toContain('age_band');
  });
});
