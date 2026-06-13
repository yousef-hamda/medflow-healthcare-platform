-- Procedures staging → OMOP procedure_occurrence source.
--
-- Procedures are surfaced in silver/observations under the 'procedure' category
-- (Synthea encodes Procedure resources with SNOMED procedure codes). Imaging
-- studies (silver/imaging_studies) are also procedures, mapped by modality.
with from_observations as (
    select
        patient_id,
        encounter_id,
        code                                    as procedure_source_code,
        code_display                            as procedure_source_value,
        effective_datetime                      as procedure_datetime,
        effective_date                          as procedure_date
    from {{ source('silver', 'observations') }}
    where lower(coalesce(category_code, '')) in ('procedure')
      and code is not null
),
from_imaging as (
    select
        patient_id,
        cast(null as string)                    as encounter_id,
        modality                                as procedure_source_code,
        coalesce(study_description, body_part)  as procedure_source_value,
        cast(study_date as timestamp)           as procedure_datetime,
        study_date                              as procedure_date
    from {{ source('silver', 'imaging_studies') }}
    where modality is not null
),
unioned as (
    select * from from_observations
    union all
    select * from from_imaging
)
select
    patient_id,
    encounter_id,
    procedure_source_code,
    procedure_source_value,
    cast(procedure_datetime as timestamp)   as procedure_datetime,
    cast(procedure_date as date)            as procedure_date
from unioned
where patient_id is not null
  and procedure_source_code is not null
