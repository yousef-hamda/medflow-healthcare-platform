# ADR-0001: Delta Lake as the lakehouse table format

## Status

Accepted (2024-Q4). Supersedes nothing. Revisit if Iceberg's Spark write story and
multi-engine governance materially out-pace Delta, or if a managed warehouse is mandated.

## Context

MedFlow's analytical plane is a medallion lakehouse on object storage (MinIO locally,
S3 in AWS) with bronze → silver → gold layers, OMOP CDM as gold (see
[ADR-0002](0002-omop-as-gold.md)), built by Spark + dbt-spark, gated by Great Expectations,
queried interactively by Trino and Superset, with column-level lineage to Marquez
(see [data-lake.md](../data-lake.md)). We need an open table format on object storage that gives us:

- **ACID commits** so the hourly bronze DAGs and the daily silver/OMOP builds never expose
  half-written partitions to Trino or Superset readers.
- **Schema enforcement + evolution** because FHIR resources and HL7v2 mappings drift, and a
  silent type change must fail the GE gate, not corrupt gold.
- **Time travel** for logical-corruption recovery (a bad deploy writing garbage is a distinct
  failure from infra loss — see [compliance.md](../compliance.md#9-backup--disaster-recovery)).
- **Concurrent writers** because backfills run alongside scheduled DAGs.
- **First-class Spark write support** (our batch engine) and **good Trino read support**
  (our interactive engine), with no proprietary lock-in given the data is portable Parquet.

The data is single-organization, batch-dominated (hourly→bronze, daily→OMOP), with one
primary writer engine (Spark) and a small number of reader engines (Trino, Superset, Spark).
We are not running thousands of concurrent writers from heterogeneous engines.

## Decision

Use **Delta Lake** (`delta-spark` on Spark 3.5, Trino `delta` connector) as the table format
for all three medallion layers on `s3://lakehouse`.

## Alternatives considered

### Apache Iceberg

The closest competitor and a genuinely strong choice. Iceberg's hidden partitioning,
partition evolution, and engine-neutral catalog (REST catalog, multi-engine governance) are
arguably ahead of Delta for a many-engines future. We rejected it for MedFlow because:

- Our write path is Spark-centric and dbt-spark-centric; `dbt-spark` + Delta is the more
  trodden path with fewer sharp edges than dbt + Iceberg at the time of decision.
- Trino's Delta connector and Iceberg connector are both mature; this was a wash.
- Iceberg's biggest advantage (engine pluralism via a REST catalog) is value we do not yet
  cash in — we have one writer. Adopting Iceberg would buy flexibility we are not using while
  costing us the smoother Spark/dbt/Delta integration we are.

**Honest note:** if MedFlow grew to multiple write engines (Flink writing gold directly,
Snowflake/BigQuery reading via external tables) Iceberg's catalog story would likely win a
re-evaluation. This is the most defensible decision to revisit.

### Apache Hudi

Strongest where the workload is high-frequency upserts/CDC with record-level indexes
(copy-on-write / merge-on-read tuning). Our upsert needs are real but modest and batch-shaped
(daily MERGE in silver/OMOP), not streaming record-level mutation. Hudi's operational surface
(compaction, cleaning, table services tuning) is heavier than Delta's for the benefit we'd get.
Rejected: pays operational complexity for a streaming-upsert profile we do not have.

### Snowflake (managed warehouse, not a lakehouse format)

Excellent ergonomics, governance, and elasticity, and would erase a lot of operational toil.
Rejected for this project because:

- **Portfolio/learning intent:** MedFlow exists to demonstrate an open, self-hostable,
  vendor-neutral stack; a managed warehouse hides exactly the lineage/format/compaction
  mechanics we want to show.
- **Lock-in and cost shape:** proprietary storage format, egress and compute coupling, and a
  per-credit cost model that is wrong for a bursty batch workload running locally on a laptop.
- **Data residency / BAA:** another vendor in the PHI boundary needing a BAA
  (a named gap in [compliance.md](../compliance.md#11-gaps--roadmap-the-honest-table)).

## Consequences

**Positive**

- ACID commits make the Trino/Superset read path safe against in-flight DAG writes with no
  reader coordination — the property the whole "Kafka is the shock absorber, lake is the
  durable archive" stance depends on.
- Time travel gives us point-in-time logical recovery alongside PITR, cited directly in the
  DR design and the [restore-drill runbook](../runbooks/restore-drill.md).
- Schema enforcement composes with Great Expectations: structural drift fails the commit,
  semantic drift fails the GE gate.
- Parquet underneath means the data is not truly locked in; a future migration to Iceberg is
  a metadata reorganization, not a data rewrite.

**Negative / costs (honest)**

- **Vacuum/retention is a footgun for time travel:** `VACUUM` below the retention horizon
  silently destroys the snapshots DR relies on. We pin `delta.deletedFileRetentionDuration`
  and `logRetentionDuration` and treat them as DR parameters, not tuning knobs.
- **Small-file / OPTIMIZE toil:** frequent hourly bronze writes generate small files;
  `OPTIMIZE`/`ZORDER` is a scheduled chore, not free.
- **Connector version coupling:** Spark Delta version, Trino Delta connector version, and the
  `_delta_log` protocol version must be kept compatible; a protocol upgrade (e.g. deletion
  vectors) can outrun the Trino connector and break reads. We pin and test the matrix.
- We accept being on a less engine-neutral format than Iceberg in exchange for the smoothest
  Spark/dbt path today — and we wrote down (above) the trigger that would make us revisit.
