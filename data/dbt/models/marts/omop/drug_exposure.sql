-- OMOP CDM v5.4 — drug_exposure
-- drug_concept_id resolved via the RxNorm→OMOP seed concept map.
with meds as (
    select * from {{ ref('stg_medications') }}
),
mapped as (
    select
        m.*,
        cm.target_concept_id as drug_concept_id
    from meds m
    left join {{ ref('concept_map_meds') }} cm
        on m.rxnorm_code = cm.source_code
)
select
    {{ generate_omop_id('drug', 'medication_request_id') }} as drug_exposure_id,
    {{ generate_person_id('patient_id') }}                  as person_id,
    coalesce(drug_concept_id, 0)                            as drug_concept_id,
    authored_date                                           as drug_exposure_start_date,
    authored_datetime                                       as drug_exposure_start_datetime,
    authored_date                                           as drug_exposure_end_date,
    authored_datetime                                       as drug_exposure_end_datetime,
    cast(null as date)                                      as verbatim_end_date,
    38000177                                                as drug_type_concept_id,  -- Prescription written
    cast(null as string)                                    as stop_reason,
    cast(null as int)                                       as refills,
    cast(null as double)                                    as quantity,
    cast(null as int)                                       as days_supply,
    dosage_text                                             as sig,
    cast(null as bigint)                                    as route_concept_id,
    cast(null as string)                                    as lot_number,
    cast(null as bigint)                                    as provider_id,
    case when encounter_id is not null
         then {{ generate_omop_id('visit', 'encounter_id') }}
         else cast(null as bigint) end                      as visit_occurrence_id,
    cast(null as bigint)                                    as visit_detail_id,
    rxnorm_code                                             as drug_source_value,
    cast(null as bigint)                                    as drug_source_concept_id,
    cast(null as string)                                    as route_source_value,
    cast(null as string)                                    as dose_unit_source_value
from mapped
where authored_date is not null
