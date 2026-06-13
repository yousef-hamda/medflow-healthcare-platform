{#
  Deterministic surrogate integer key for OMOP tables.

  OMOP CDM uses 64-bit integer primary keys (person_id, visit_occurrence_id, ...)
  whereas our silver layer keys on FHIR string ids. We hash the natural key to a
  stable non-negative bigint so the same source row always maps to the same OMOP
  id across full refreshes (idempotent) and across tables (referential joins).

  conv(substr(md5(x), 1, 15), 16, 10) takes 60 bits of the MD5 hex digest and
  converts to a positive decimal bigint — collision risk is negligible at
  synthetic-cohort scale and the value fits in a signed bigint.
#}
{% macro generate_person_id(natural_key) %}
    cast(conv(substr(md5(cast({{ natural_key }} as string)), 1, 15), 16, 10) as bigint)
{% endmacro %}

{% macro generate_omop_id(prefix, natural_key) %}
    cast(conv(substr(md5(concat('{{ prefix }}:', cast({{ natural_key }} as string))), 1, 15), 16, 10) as bigint)
{% endmacro %}
