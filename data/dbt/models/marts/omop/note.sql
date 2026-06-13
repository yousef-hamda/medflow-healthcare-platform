-- OMOP CDM v5.4 — note
-- One row per de-identified clinical note. note_text holds the de-identified
-- body only (raw PHI text never reaches silver, hence never reaches gold).
with notes as (
    select * from {{ ref('stg_notes') }}
)
select
    {{ generate_omop_id('note', 'note_id') }}               as note_id,
    {{ generate_person_id('patient_id') }}                  as person_id,
    note_date,
    note_datetime,
    32817                                                   as note_type_concept_id,  -- EHR note
    0                                                       as note_class_concept_id,
    note_title                                              as note_title,
    deid_text                                               as note_text,
    32678                                                   as encoding_concept_id,  -- UTF-8
    4180186                                                 as language_concept_id,  -- English
    cast(null as bigint)                                    as provider_id,
    case when encounter_id is not null
         then {{ generate_omop_id('visit', 'encounter_id') }}
         else cast(null as bigint) end                      as visit_occurrence_id,
    cast(null as bigint)                                    as visit_detail_id,
    note_type_code                                          as note_source_value,
    cast(null as bigint)                                    as note_event_id,
    cast(null as bigint)                                    as note_event_field_concept_id
from notes
