-- OMOP CDM v5.4 — note_nlp
-- One row per NLP-extracted entity. The deid-service returns detected entities
-- as a JSON array in silver/notes_deid.entities_json; we explode it so each
-- entity span (term, type, offset) becomes a note_nlp row tied back to note.
with notes as (
    select
        note_id,
        entities_json,
        note_datetime
    from {{ ref('stg_notes') }}
    where entities_json is not null
      and entities_json <> '[]'
),
entities as (
    select
        note_id,
        note_datetime,
        from_json(
            entities_json,
            'array<struct<text:string,type:string,start:int,end:int>>'
        ) as ents
    from notes
),
exploded as (
    select
        note_id,
        note_datetime,
        posexplode(ents) as (entity_pos, entity)
    from entities
)
select
    {{ generate_omop_id('note_nlp', "concat(cast(note_id as string), ':', cast(entity_pos as string))") }} as note_nlp_id,
    {{ generate_omop_id('note', 'note_id') }}               as note_id,
    cast(null as int)                                       as section_concept_id,
    entity.text                                             as snippet,
    cast(entity.start as string)                            as "offset",
    entity.text                                             as lexical_variant,
    0                                                       as note_nlp_concept_id,
    cast(null as bigint)                                    as note_nlp_source_concept_id,
    'medflow-deid-service'                                  as nlp_system,
    note_datetime                                           as nlp_date,
    note_datetime                                           as nlp_datetime,
    cast(null as string)                                    as term_exists,
    cast(null as string)                                    as term_temporal,
    entity.type                                             as term_modifiers
from exploded
