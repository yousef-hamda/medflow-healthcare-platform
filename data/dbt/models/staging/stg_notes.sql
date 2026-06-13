-- Notes staging: silver/notes_deid → OMOP note + note_nlp source.
-- Only successfully de-identified notes flow downstream (PHI safety).
with src as (
    select * from {{ source('silver', 'notes_deid') }}
)
select
    note_id,
    patient_id,
    encounter_id,
    cast(note_datetime as timestamp)    as note_datetime,
    cast(note_datetime as date)         as note_date,
    note_type_code,
    note_title,
    content_type,
    deid_text,
    entities_json,
    deid_status
from src
where note_id is not null
  and patient_id is not null
  and deid_status = 'deidentified'
  and deid_text is not null
