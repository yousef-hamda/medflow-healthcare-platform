-- OMOP CDM v5.4 — observation
-- Non-numeric / coded clinical observations that are not measurements.
with obs as (
    select * from {{ ref('stg_observations') }}
    where omop_domain = 'observation'
)
select
    {{ generate_omop_id('observation', 'observation_id') }} as observation_id,
    {{ generate_person_id('patient_id') }}                  as person_id,
    0                                                       as observation_concept_id,
    effective_date                                          as observation_date,
    effective_datetime                                      as observation_datetime,
    32817                                                   as observation_type_concept_id,  -- EHR
    value_as_number,
    value_as_string,
    cast(null as bigint)                                    as value_as_concept_id,
    cast(null as bigint)                                    as qualifier_concept_id,
    cast(null as bigint)                                    as unit_concept_id,
    cast(null as bigint)                                    as provider_id,
    case when encounter_id is not null
         then {{ generate_omop_id('visit', 'encounter_id') }}
         else cast(null as bigint) end                      as visit_occurrence_id,
    cast(null as bigint)                                    as visit_detail_id,
    code                                                    as observation_source_value,
    cast(null as bigint)                                    as observation_source_concept_id,
    unit                                                    as unit_source_value,
    cast(null as string)                                    as qualifier_source_value,
    cast(value_as_string as string)                         as value_source_value,
    cast(null as bigint)                                    as observation_event_id,
    cast(null as bigint)                                    as obs_event_field_concept_id
from obs
where effective_date is not null
