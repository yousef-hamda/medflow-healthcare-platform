-- Encounters staging: silver/encounters → OMOP visit_occurrence source.
with src as (
    select * from {{ source('silver', 'encounters') }}
)
select
    encounter_id,
    patient_id,
    status,
    class_code,
    type_code,
    type_display,
    provider_org_id,
    cast(start_datetime as timestamp)   as start_datetime,
    cast(end_datetime as timestamp)     as end_datetime,
    cast(start_date as date)            as start_date,
    cast(end_datetime as date)         as end_date,
    reason_code,
    reason_display,
    -- OMOP visit_concept_id by HL7 v3 ActEncounterCode (FHIR Encounter.class).
    case upper(coalesce(class_code, ''))
        when 'IMP' then 9201   -- Inpatient Visit
        when 'ACUTE' then 9201
        when 'EMER' then 9203  -- Emergency Room Visit
        when 'AMB' then 9202   -- Outpatient Visit
        when 'OBSENC' then 9201
        when 'VR' then 5083    -- Telehealth
        else 0
    end as visit_concept_id
from src
where encounter_id is not null
  and patient_id is not null
