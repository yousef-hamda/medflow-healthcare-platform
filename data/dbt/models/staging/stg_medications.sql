-- Medications staging: silver/medications → OMOP drug_exposure source.
with src as (
    select * from {{ source('silver', 'medications') }}
)
select
    medication_request_id,
    patient_id,
    encounter_id,
    status,
    intent,
    rxnorm_code,
    medication_display,
    cast(authored_datetime as timestamp)    as authored_datetime,
    cast(authored_date as date)             as authored_date,
    dosage_text
from src
where medication_request_id is not null
  and patient_id is not null
