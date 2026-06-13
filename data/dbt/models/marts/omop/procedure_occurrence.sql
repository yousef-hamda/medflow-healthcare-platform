-- OMOP CDM v5.4 — procedure_occurrence
-- Procedures from observations (SNOMED procedure category) and imaging studies.
-- No dedicated procedure seed map ships here, so concept_id defaults to 0 and
-- the SNOMED/modality code is preserved in procedure_source_value for later
-- vocabulary mapping (Athena/OMOP standard concept join in production).
with procs as (
    select * from {{ ref('stg_procedures') }}
)
select
    {{ generate_omop_id('procedure', "concat(patient_id, ':', procedure_source_code, ':', coalesce(cast(procedure_date as string), 'na'))") }} as procedure_occurrence_id,
    {{ generate_person_id('patient_id') }}                  as person_id,
    0                                                       as procedure_concept_id,
    procedure_date                                          as procedure_date,
    procedure_datetime                                      as procedure_datetime,
    cast(null as date)                                      as procedure_end_date,
    cast(null as timestamp)                                 as procedure_end_datetime,
    32817                                                   as procedure_type_concept_id,  -- EHR
    cast(null as bigint)                                    as modifier_concept_id,
    cast(null as int)                                       as quantity,
    cast(null as bigint)                                    as provider_id,
    case when encounter_id is not null
         then {{ generate_omop_id('visit', 'encounter_id') }}
         else cast(null as bigint) end                      as visit_occurrence_id,
    cast(null as bigint)                                    as visit_detail_id,
    procedure_source_code                                   as procedure_source_value,
    cast(null as bigint)                                    as procedure_source_concept_id,
    cast(null as string)                                    as modifier_source_value
from procs
where procedure_date is not null
