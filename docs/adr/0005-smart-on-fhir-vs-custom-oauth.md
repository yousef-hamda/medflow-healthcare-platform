# ADR-0005: SMART on FHIR scopes (over plain OAuth2 scopes or custom RBAC claims)

## Status

Accepted (2024-Q4). Realized in the api-gateway authorization stack
([architecture.md §2.7](../architecture.md#27-application-layer),
[compliance.md §3](../compliance.md#3-access-control)). Pairs with — does not replace — the
ABAC layer (care-team, break-glass), which is the subject of a separate design note inside
compliance.md §3.3.

## Context

The api-gateway is the single ingress for the clinician dashboard, patient portal, Expo mobile
app, CDS Hooks, and backend bulk-export clients, fronting a **FHIR R4** server, ml-serving, and
Trino. We need an authorization model for *clinical resource access* that:

- Expresses **patient-compartment** restriction (a portal token may read only its own patient's
  resources) and **resource-type** granularity (`Observation.read` vs `*.read`).
- Supports **patient-facing apps, clinician apps, and backend services** with the right OAuth2
  flows (authorization code + PKCE for apps, client-credentials for backend bulk).
- Is **recognized by the FHIR/CDS ecosystem** — CDS Hooks, SMART app launch, and any third-party
  FHIR client speak a known dialect, so we are not inventing an authorization vocabulary that
  only MedFlow understands.
- Composes with **scope narrowing** at the proxy (a downstream call never carries broader scopes
  than the route needs) and with field-level masking.

Crucially, scopes answer *"what classes of resource may this token touch?"* They do **not**
answer *"is this specific clinician on this specific patient's care team right now?"* — that is a
relationship/attribute question. The decision below is about the **scope** layer; the
relationship layer is ABAC and is intentionally separate.

## Decision

Use **SMART on FHIR scopes** (`patient/*.read`, `user/Observation.read`, `user/*.write`,
`system/*.read`, plus a custom `phi:contact`) as the gateway's coarse authorization vocabulary,
issued by an OAuth2/OIDC authorization server (dev: self-issued; production: enterprise IdP
federation), enforced by the FHIR proxy (compartment restriction + scope narrowing + masking),
**layered under** RBAC roles and ABAC attributes.

## Alternatives considered

### Plain OAuth2 scopes (ad-hoc strings like `read:patients`, `write:observations`)

Functionally similar — OAuth2 scopes are just strings — but rejected as the *vocabulary*:

- **Reinvents SMART, worse.** SMART scopes already encode the
  `context/resourceType.interaction` structure (patient- vs user- vs system-level, per resource
  type) with published semantics including the v2 `.rs`/`.cruds` forms. Rolling our own string
  convention means re-deriving compartment and resource-type semantics nobody else recognizes.
- **No ecosystem interop:** SMART app launch, CDS Hooks SMART links, and third-party FHIR apps
  expect SMART scopes. A bespoke scheme breaks the CDS Hooks app-link story in
  [interop.md](../interop.md) and forecloses ever onboarding a standard SMART app.
- We *do* add one custom scope (`phi:contact`) — but as a **deliberate, documented extension to**
  the SMART vocabulary for a need SMART doesn't express (unmasking telecom + triggering Vault
  decrypt), not as a wholesale replacement.

### Custom RBAC claims in the JWT (role → hard-coded permission matrix in the gateway)

i.e. skip scopes; put `role: clinician` in the token and let the gateway map roles to
permissions in code. Rejected **as the whole story**, kept **as a layer**:

- **Roles ≠ resource scoping.** A role does not express "this token is restricted to the
  `Patient/123` compartment" — that is exactly what `patient/*.read` does. Encoding compartment
  restriction in role logic recreates SMART's scope semantics in imperative code.
- **No third-party delegation:** OAuth2/SMART scopes let an external app be granted a *subset* of
  a user's access at consent time; a role-only model has no vocabulary for "this app may read
  Observations but not Conditions."
- **But RBAC is still here:** roles (`clinician`, `nurse`, `patient`, `researcher`,
  `ml-engineer`, `auditor`, `admin`) gate *which scopes a principal may obtain* and back the
  ABAC checks. The decision is layered: **RBAC** (what role) → **SMART scopes** (what resource
  classes/compartment) → **ABAC** (which specific patients, via care-team/break-glass). No single
  layer is sufficient; that is the point.

## Consequences

**Positive**

- **Ecosystem interop:** standard SMART app launch, CDS Hooks SMART links, and third-party FHIR
  clients work against the gateway without bespoke glue.
- **Compartment + resource-type granularity for free:** `patient/*.read` compartment-restricts to
  the token's patient; `user/Observation.read` scopes a clinician to a resource type — the proxy
  enforces these directly.
- **Proper flows per client class:** auth-code+PKCE for apps, client-credentials (`system/*.read`)
  for backend bulk export with per-client rate limits and resource-type allowlists.
- **Scope narrowing is meaningful** because scopes have structure: the proxy strips a downstream
  request to the minimum scope its route needs, so a compromised downstream call can't replay an
  over-scoped token.
- The model **forces the honest separation** between class-of-access (scopes) and
  relationship-of-access (ABAC) — preventing the common bug of thinking a broad scope equals
  permission to a specific patient.

**Negative / costs (honest)**

- **Scopes are necessary but not sufficient — and that's a trap if forgotten.** `user/*.read`
  does **not** mean "may read any patient"; without the care-team ABAC check it would be exactly
  the over-broad access HIPAA minimum-necessary forbids. The gateway must *always* run ABAC after
  scopes; this ADR exists partly to document that scopes alone are not authorization.
- **SMART scope semantics have sharp edges:** the v1 vs v2 scope syntax
  (`patient/*.read` vs `patient/*.rs`), wildcard expansion, and which interactions a wildcard
  implies are a real source of subtle bugs; the proxy normalizes and tests them.
- **More moving parts than role-only:** an OAuth2/OIDC authorization server, scope-to-route
  mapping, narrowing logic, and the custom `phi:contact` extension are more to build and test
  than a role lookup — justified only because of the interop and granularity above.
- **The custom `phi:contact` scope is non-standard** and must be documented wherever scopes are
  (it is, in compliance.md §3.4) so it doesn't masquerade as a SMART-blessed scope.
