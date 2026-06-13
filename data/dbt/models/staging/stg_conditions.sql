-- Conditions staging → OMOP condition_occurrence source.
--
-- The silver layer has no dedicated Condition table (Synthea FHIR Condition
-- resources land in bronze and are surfaced two ways in silver): we derive
-- conditions from (a) observations carrying a SNOMED problem/condition category
-- and (b) encounter reason codes (the diagnosis driving the visit). Both are
-- unioned and de-duplicated on (patient, code, onset date).
with from_observations as (
    select
        patient_id,
        encounter_id,
        code                                    as condition_source_code,
        code_display                            as condition_source_value,
        effective_datetime                      as condition_datetime,
        effective_date                          as condition_date
    from {{ source('silver', 'observations') }}
    where lower(coalesce(category_code, '')) in ('problem-list-item', 'encounter-diagnosis', 'condition')
      and code is not null
),
from_encounters as (
    select
        patient_id,
        encounter_id,
        reason_code                             as condition_source_code,
        reason_display                          as condition_source_value,
        start_datetime                          as condition_datetime,
        cast(start_datetime as date)            as condition_date
    from {{ source('silver', 'encounters') }}
    where reason_code is not null
),
unioned as (
    select * from from_observations
    union all
    select * from from_encounters
)
select
    patient_id,
    encounter_id,
    condition_source_code,
    condition_source_value,
    cast(condition_datetime as timestamp)   as condition_datetime,
    cast(condition_date as date)            as condition_date
from unioned
where patient_id is not null
  and condition_source_code is not null
group by 1, 2, 3, 4, 5, 6
