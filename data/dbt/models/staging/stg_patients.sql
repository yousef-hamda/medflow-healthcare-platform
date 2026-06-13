-- Patients staging: silver/patients normalised for the OMOP person mart.
with src as (
    select * from {{ source('silver', 'patients') }}
)
select
    patient_id,
    lower(gender)                                   as gender,
    cast(birth_date as date)                        as birth_date,
    year(birth_date)                                as year_of_birth,
    month(birth_date)                               as month_of_birth,
    day(birth_date)                                 as day_of_birth,
    cast(deceased_datetime as timestamp)            as deceased_datetime,
    family_name,
    given_name,
    city,
    state,
    zip,
    country,
    marital_status
from src
where patient_id is not null
