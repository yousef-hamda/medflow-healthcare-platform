-- OMOP CDM v5.4 — visit_occurrence
-- One row per encounter; visit_concept_id mapped from FHIR Encounter.class.
-- person_id is the deterministic hash of patient_id (see generate_person_id),
-- so it matches person.person_id without a join.
with enc as (
    select * from {{ ref('stg_encounters') }}
)
select
    {{ generate_omop_id('visit', 'encounter_id') }}        as visit_occurrence_id,
    {{ generate_person_id('patient_id') }}                 as person_id,
    visit_concept_id,
    cast(start_datetime as date)                           as visit_start_date,
    start_datetime                                         as visit_start_datetime,
    cast(coalesce(end_datetime, start_datetime) as date)   as visit_end_date,
    coalesce(end_datetime, start_datetime)                 as visit_end_datetime,
    32817                                                  as visit_type_concept_id,  -- EHR
    cast(null as bigint)                                   as provider_id,
    cast(null as bigint)                                   as care_site_id,
    class_code                                             as visit_source_value,
    cast(null as bigint)                                   as visit_source_concept_id,
    cast(null as bigint)                                   as admitted_from_concept_id,
    cast(null as string)                                   as admitted_from_source_value,
    cast(null as bigint)                                   as discharged_to_concept_id,
    cast(null as string)                                   as discharged_to_source_value,
    cast(null as bigint)                                   as preceding_visit_occurrence_id
from enc
where start_datetime is not null
