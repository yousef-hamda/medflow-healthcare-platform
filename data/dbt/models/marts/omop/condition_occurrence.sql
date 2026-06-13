-- OMOP CDM v5.4 — condition_occurrence
-- condition_concept_id resolved via the SNOMED→OMOP seed concept map.
with conditions as (
    select * from {{ ref('stg_conditions') }}
),
mapped as (
    select
        c.*,
        cm.target_concept_id as condition_concept_id
    from conditions c
    left join {{ ref('concept_map_conditions') }} cm
        on c.condition_source_code = cm.source_code
)
select
    {{ generate_omop_id('condition', "concat(patient_id, ':', condition_source_code, ':', coalesce(cast(condition_date as string), 'na'))") }} as condition_occurrence_id,
    {{ generate_person_id('patient_id') }}                  as person_id,
    coalesce(condition_concept_id, 0)                       as condition_concept_id,
    condition_date                                          as condition_start_date,
    condition_datetime                                     as condition_start_datetime,
    cast(null as date)                                      as condition_end_date,
    cast(null as timestamp)                                 as condition_end_datetime,
    32817                                                   as condition_type_concept_id,  -- EHR
    cast(null as bigint)                                    as condition_status_concept_id,
    cast(null as string)                                    as stop_reason,
    cast(null as bigint)                                    as provider_id,
    case when encounter_id is not null
         then {{ generate_omop_id('visit', 'encounter_id') }}
         else cast(null as bigint) end                      as visit_occurrence_id,
    cast(null as bigint)                                    as visit_detail_id,
    condition_source_code                                   as condition_source_value,
    cast(null as bigint)                                    as condition_source_concept_id,
    cast(null as string)                                    as condition_status_source_value
from mapped
where condition_date is not null
