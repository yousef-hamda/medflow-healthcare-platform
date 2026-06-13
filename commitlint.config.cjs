module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      1,
      "always",
      [
        "repo",
        "fhir",
        "hl7v2",
        "dicom",
        "wearables",
        "deid",
        "ml",
        "ml-serving",
        "ml-batch",
        "gateway",
        "realtime",
        "cds",
        "audit",
        "dashboard",
        "portal",
        "mobile",
        "data",
        "airflow",
        "flink",
        "dbt",
        "infra",
        "k8s",
        "ci",
        "docs",
        "compliance",
        "scripts"
      ]
    ],
    "body-max-line-length": [1, "always", 200]
  }
};
