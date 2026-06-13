# Pull Request

## Summary

<!-- What does this change do and why? Link the issue (Closes #123). -->

## Type of change

- [ ] Feature
- [ ] Bug fix
- [ ] Refactor / chore
- [ ] Docs
- [ ] CI / infra

## Affected areas

<!-- e.g. apps/api-gateway, apps/ml-serving, data/dbt, infra/helm -->

## How was this tested?

<!-- Commands run, environments, screenshots/logs where relevant. -->

## Checklist

- [ ] **No PHI in logs** — ran `python scripts/hooks/check_phi_logging.py` (and the TS mode) over changed files; all data remains synthetic.
- [ ] **Conventional commit** — PR title / commits follow Conventional Commits (`type(scope): subject`).
- [ ] **Tests added** — new/changed behaviour is covered; coverage stays ≥ 70% per package.
- [ ] **Docs updated** — READMEs / `docs/` / `scripts/README.md` reflect the change.
- [ ] Lint, typecheck, and the relevant CI jobs pass locally (`make lint && make test`).
- [ ] No secrets committed (detect-secrets baseline is current).
- [ ] Breaking changes and migrations are called out above.

## HIPAA / compliance notes

<!-- Anything touching de-identification, audit logging, access control, or
     data retention? Note it here so the reviewer can check the posture. -->
