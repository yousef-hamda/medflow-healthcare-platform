-- OMOP CDM v5.4 — measurement
-- Numeric / vital-signs / laboratory observations; measurement_concept_id and
-- unit_concept_id resolved via the LOINC→OMOP seed concept map.
with obs as (
    select * from {{ ref('stg_observations') }}
    where omop_domain = 'measurement'
),
mapped as (
    select
        o.*,
        cm.target_concept_id    as measurement_concept_id,
        cm.unit_concept_id      as unit_concept_id
    from obs o
    left join {{ ref('concept_map_labs') }} cm
        on o.code = cm.source_code
)
select
    {{ generate_omop_id('measurement', 'observation_id') }} as measurement_id,
    {{ generate_person_id('patient_id') }}                  as person_id,
    coalesce(measurement_concept_id, 0)                     as measurement_concept_id,
    effective_date                                          as measurement_date,
    effective_datetime                                      as measurement_datetime,
    cast(null as string)                                    as measurement_time,
    32817                                                   as measurement_type_concept_id,  -- EHR
    cast(null as bigint)                                    as operator_concept_id,
    value_as_number,
    cast(null as bigint)                                    as value_as_concept_id,
    coalesce(unit_concept_id, 0)                            as unit_concept_id,
    cast(null as double)                                    as range_low,
    cast(null as double)                                    as range_high,
    cast(null as bigint)                                    as provider_id,
    case when encounter_id is not null
         then {{ generate_omop_id('visit', 'encounter_id') }}
         else cast(null as bigint) end                      as visit_occurrence_id,
    cast(null as bigint)                                    as visit_detail_id,
    code                                                    as measurement_source_value,
    cast(null as bigint)                                    as measurement_source_concept_id,
    unit                                                    as unit_source_value,
    cast(null as bigint)                                    as unit_source_concept_id,
    cast(value_as_string as string)                         as value_source_value,
    cast(null as bigint)                                    as measurement_event_id,
    cast(null as bigint)                                    as meas_event_field_concept_id
from mapped
where effective_date is not null
