# MedFlow — Falco runtime threat detection

Falco watches syscalls (via an eBPF probe) on every node and raises alerts when
container behaviour deviates from MedFlow's threat model. Events are forwarded
through **falcosidekick** to **Loki**, where they sit alongside application logs
and feed the Grafana *security-audit* dashboard.

## Files

| File | Purpose |
|------|---------|
| `falco-rules-medflow.yaml` | Custom MedFlow detection rules, macros and lists. |
| `values-falco.yaml` | Helm values for the upstream `falcosecurity/falco` chart. |

## Deploy

```bash
helm repo add falcosecurity https://falcosecurity.github.io/charts
helm repo update

helm upgrade --install falco falcosecurity/falco \
  -n falco --create-namespace \
  -f infra/falco/values-falco.yaml \
  --set-file customRules."falco-rules-medflow\.yaml"=infra/falco/falco-rules-medflow.yaml
```

The `falco` namespace is already an approved ArgoCD destination
(`infra/argocd/project.yaml`), so this can also be wrapped in an ArgoCD
`Application` pointing at the `falcosecurity` Helm repo.

## Rule rationale

MedFlow handles PHI, so the rules focus on the integrity of the audit trail,
the secrecy of Vault material, and the immutability of tightly-scoped images.

| Rule | Why it matters | Priority |
|------|----------------|----------|
| **Shell spawned in MedFlow container** | MedFlow images run one service process and ship no shell. A `bash`/`sh` exec means a debug session, a compromised container, or lateral movement against PHI workloads. | WARNING |
| **Unexpected audit-service egress** | The audit-service must only ship immutable logs to WORM object storage (S3/MinIO). Any other outbound connection points at exfiltration of the audit trail or C2 beaconing. | CRITICAL |
| **Vault token file read by unexpected process** | Reading `.vault-token` or `/vault/secrets/*` from anything but the Vault agent toolchain indicates secret theft or a sidecar escape. | CRITICAL |
| **Write under /etc in container** | Images are immutable and config arrives via env/ConfigMaps. Writing to `/etc` (passwd, cron, `ld.so.preload`, ssh) is tampering / persistence. | ERROR |
| **Cryptominer process name** | A known miner binary (xmrig, minerd, …) in a MedFlow container is never legitimate; it signals a compromised workload abusing cluster compute. | CRITICAL |

## Tuning

- Allowlists (`medflow_audit_egress_allowlist`, `medflow_vault_trusted_procs`,
  `medflow_image_repositories`) are defined at the top of the rules file —
  adjust them as service identities, image repos, or object-store endpoints
  change. Prefer extending lists over loosening conditions.
- `minimumpriority` in `values-falco.yaml` controls what falcosidekick forwards
  to Loki; raise it to reduce noise once the baseline is tuned.
- Validate edits before shipping:
  `python3 -c "import yaml,sys; list(yaml.safe_load_all(open('infra/falco/falco-rules-medflow.yaml')))"`.
