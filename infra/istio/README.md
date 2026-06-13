# MedFlow Istio mesh policy

Service-mesh layer for the `medflow` namespace: strict mTLS everywhere,
deny-by-default L7 authorization, and the north-south Gateway/VirtualService
routes for the three public hosts.

## Files

| File | What it does |
|------|--------------|
| `peer-authentication.yaml` | `STRICT` mTLS for `medflow` (PHI plane); `PERMISSIVE` for `medflow-data` (sidecar-less stateful components). |
| `destination-rules.yaml` | `ISTIO_MUTUAL` client TLS for all `*.medflow.svc` hosts + connection pools / outlier detection for `api-gateway` and `ml-serving`. |
| `authorization-policies.yaml` | Deny-all default, then explicit allows. Notable: `ml-serving` only accepts calls from `api-gateway`, `cds-hooks-service`, and the `flink` SA in `medflow-data`; `audit-service` is append-only (POST from service SAs, GET only from `api-gateway`). |
| `gateway.yaml` | Ingress gateway servers for `app.`, `portal.`, `api.medflow.example.com` with HTTP→HTTPS redirect (TLS secret `medflow-tls` in `istio-system`). |
| `virtualservices.yaml` | Host routes: dashboard, portal, API (with `/realtime` → `realtime-gateway`, infinite timeout for WebSockets). |

## Apply order

```bash
istioctl install --set profile=default -y          # or via ArgoCD
kubectl label namespace medflow istio-injection=enabled --overwrite   # already set by infra/k8s/namespace.yaml
kubectl apply -f infra/istio/peer-authentication.yaml
kubectl apply -f infra/istio/destination-rules.yaml
kubectl apply -f infra/istio/authorization-policies.yaml
kubectl apply -f infra/istio/gateway.yaml
kubectl apply -f infra/istio/virtualservices.yaml
```

Restart app pods after enabling injection so sidecars attach
(`kubectl -n medflow rollout restart deploy`).

## Identity model

AuthorizationPolicies match SPIFFE principals of the per-service
ServiceAccounts created by the Helm chart
(`cluster.local/ns/medflow/sa/<service>`); the Flink jobs run in
`medflow-data` under the `flink` SA. Adding a caller therefore means adding
its principal to the relevant policy — never widening to `namespaces:`.

## Notes & gotchas

- **Health probes** keep working under STRICT + deny-all because Istio
  rewrites kubelet HTTP probes to the pilot-agent port (15020), which is not
  subject to AuthorizationPolicy.
- **Prometheus scrapes**: under STRICT mTLS, scrape the sidecar-merged
  metrics port (15020, `/stats/prometheus` merged with app metrics) or run
  Prometheus with Istio certs. The pod annotations set by the chart assume
  metrics merging is enabled (Istio default).
- **MLLP (2575) and DICOM (11112)** are raw TCP. They are still mTLS-wrapped
  pod-to-pod inside the mesh, but external ingest must enter through a TCP
  server on the gateway (not configured here) or a dedicated LB.
- **Local kind**: the gateway NodePorts map to host ports 8090/8443 via
  `infra/k8s/kind-config.yaml`; in `values-local.yaml` injection is disabled
  entirely, so none of these policies apply locally unless you install Istio.
