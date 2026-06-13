# ADR-0002: OMOP CDM v5.4 as the gold analytical model

## Status

Accepted (2024-Q4). Constrains [ADR-0001](0001-lakehouse-on-delta.md) (Delta is the substrate
OMOP gold is built on). Revisit only if the analytical consumer base shifts from
cohort/quality/research toward operational/application reads (which the FHIR server already
serves) or toward a BI-team that would be better served by purpose-built star schemas.

## Context

The lakehouse's gold layer is the contract for analysts, the cohort builder, Superset
dashboards, and ML feature engineering. The operational canonical model is already FHIR R4
(the HAPI server, seconds-fresh, serving care). The question this ADR answers is *what shape
the analytical gold takes*, given:

- Sources are heterogeneous (FHIR, HL7v2→FHIR, DICOM metadata, vitals) but all land normalized
  toward FHIR in silver.
- Consumers are **research / quality / cohort / ML**, not transactional app reads — those go
  to the FHIR server via the gateway.
- We want analyses and tooling to be **portable and reviewable**, not bespoke to MedFlow's
  table names.
- De-identification (Safe Harbor, date-shift, ZIP3) is applied on the analytical path; the gold
  model must be comfortable with pseudonymized keys and shifted dates.

## Decision

Build gold as **OMOP CDM v5.4** (`person`, `visit_occurrence`, `condition_occurrence`,
`observation`, `measurement`, `drug_exposure`, `procedure_occurrence`, `observation_period`,
plus required vocabulary tables), materialized by a **dbt-spark** project from silver, gated by
Great Expectations on referential integrity and standard-concept mapping.

## Alternatives considered

### FHIR-native analytics (query FHIR resources directly, e.g. SQL-on-FHIR / flattened FHIR)

Tempting because silver is already FHIR-shaped — no second remodeling. Rejected because:

- FHIR is a **document/resource exchange model**, not an analytical schema: deeply nested,
  choice types (`value[x]`), reference-by-URL, and extension sprawl make population-scale
  `GROUP BY` queries painful and every analyst's flattening idiosyncratic.
- Analytical tooling (cohort definitions, quality measures, study packages) is not written
  against raw FHIR; it is written against OMOP or i2b2.
- SQL-on-FHIR (ViewDefinitions) is promising and we use FHIR-shaped silver as the staging
  input, but as the *gold contract* it would push the flattening burden onto every consumer.

We keep FHIR-shaped silver precisely so the FHIR-native path stays open for app/operational
reads — but those reads go to the live FHIR server, not the lake.

### i2b2 star schema

A respected clinical-research data model with a real user community. Rejected because:

- Its star/fact `observation_fact` design with concept dimensions is powerful but the
  ecosystem momentum, vocabulary tooling (Athena), analytics libraries (OHDSI: atlas,
  cohort generator, `CohortMethod`, `PatientLevelPrediction`), and network-study portability
  are with **OMOP**.
- OMOP's standardized vocabularies give us concept mapping as a first-class, reusable asset;
  i2b2 ontologies are more deployment-specific.

### Purpose-built dimensional star schema (Kimball facts/dims for our specific dashboards)

The classic BI answer. Rejected as the *gold contract* because:

- It optimizes for **today's known dashboards** at the cost of portability and re-use; every
  new question risks a new fact table.
- It encodes MedFlow-specific semantics that no external tool understands, undoing the main
  reason to have a standard model.
- **But not entirely rejected:** Superset-facing **marts** (denormalized, dashboard-shaped
  views) are built *on top of* OMOP within the dbt project. OMOP is the conformed model;
  star-shaped marts are a presentation layer derived from it. We get standardization *and*
  query-friendly dashboards, in that dependency order.

## Consequences

**Positive**

- **Tooling for free:** OHDSI analytics (cohort builder semantics, quality measures, patient-
  level prediction) target OMOP; our cohort builder issues OMOP SQL through Trino.
- **Portability:** analyses written against MedFlow gold are recognizable to anyone who knows
  OMOP; network studies are conceivable.
- **Standard vocabularies** make concept mapping a reviewable, testable artifact — GE asserts
  every `*_concept_id` resolves to a standard concept, every `visit_occurrence.person_id`
  exists in `person`.
- Clean separation: FHIR = operational/now, OMOP = analytical/research, each fit for purpose.

**Negative / costs (honest)**

- **ETL is lossy and opinionated:** FHIR → OMOP mapping discards FHIR's full fidelity
  (extensions, narrative, some modifiers). OMOP is a *research* model; it is the wrong place to
  reconstruct an exact clinical document. We accept this because the FHIR server retains full
  fidelity and is the source of truth.
- **Vocabulary mapping is real, ongoing work:** mapping source codes to OMOP standard concepts
  (and maintaining the vocabulary tables from Athena) is non-trivial and a recurring chore, not
  a one-time build.
- **Two models to keep coherent:** silver (FHIR-shaped) → gold (OMOP) is a genuine remodeling
  step with its own bugs; the GE gates and OpenLineage column lineage exist largely to keep
  this honest.
- **Mapping latency:** OMOP gold is ~24h fresh by design. This is fine for research/quality and
  explicitly *not* used for care decisions, which read the live FHIR server.
