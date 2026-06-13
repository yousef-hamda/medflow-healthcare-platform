-- OMOP CDM v5.4 — person
-- One row per patient. gender_concept_id uses the OMOP Gender vocabulary
-- (8507 MALE, 8532 FEMALE, 0 = No matching concept for unknown/other).
with patients as (
    select * from {{ ref('stg_patients') }}
)
select
    {{ generate_person_id('patient_id') }}                  as person_id,
    case lower(gender)
        when 'male' then 8507
        when 'm' then 8507
        when 'female' then 8532
        when 'f' then 8532
        else 0
    end                                                     as gender_concept_id,
    year_of_birth,
    month_of_birth,
    day_of_birth,
    cast(birth_date as timestamp)                           as birth_datetime,
    0                                                       as race_concept_id,
    0                                                       as ethnicity_concept_id,
    cast(null as bigint)                                    as location_id,
    cast(null as bigint)                                    as provider_id,
    cast(null as bigint)                                    as care_site_id,
    patient_id                                              as person_source_value,
    gender                                                  as gender_source_value,
    cast(null as bigint)                                    as gender_source_concept_id,
    cast(null as string)                                    as race_source_value,
    cast(null as bigint)                                    as race_source_concept_id,
    cast(null as string)                                    as ethnicity_source_value,
    cast(null as bigint)                                    as ethnicity_source_concept_id
from patients
where year_of_birth is not null
