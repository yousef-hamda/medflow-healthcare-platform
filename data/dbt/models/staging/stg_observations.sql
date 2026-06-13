-- Observations staging: silver/observations split by category for OMOP routing.
-- Numeric/lab-style observations → measurement; coded/non-numeric → observation.
with src as (
    select * from {{ source('silver', 'observations') }}
)
select
    observation_id,
    patient_id,
    encounter_id,
    status,
    lower(coalesce(category_code, '')) as category_code,
    code_system,
    code,
    code_display,
    cast(effective_datetime as timestamp)   as effective_datetime,
    cast(effective_date as date)            as effective_date,
    cast(value_as_number as double)         as value_as_number,
    unit,
    value_as_string,
    value_code,
    -- A measurement is anything with a numeric value or that is a vital-signs /
    -- laboratory observation; everything else is a clinical observation.
    case
        when value_as_number is not null
          or lower(coalesce(category_code, '')) in ('vital-signs', 'laboratory')
        then 'measurement'
        else 'observation'
    end as omop_domain
from src
where observation_id is not null
  and patient_id is not null
