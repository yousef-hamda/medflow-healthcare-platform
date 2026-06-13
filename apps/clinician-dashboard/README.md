# MedFlow — Clinician Dashboard

A production-quality Next.js 14 (App Router) dashboard for clinicians: a
risk-ranked worklist, a patient 360 (vitals, risk/SHAP, imaging, notes,
messages), a cohort builder, and audit/model governance views.

> **Synthetic data only.** This application connects exclusively to the MedFlow
> synthetic-data platform. No real patient information is present anywhere in
> this app, its fixtures, or its tests.

## Stack

- **Next.js 14.2.5** (App Router, standalone output, RSC + client components)
- **React 18.3.1**, **TypeScript 5.5.4** (strict, no `any`)
- **@tanstack/react-query** for server state, **zustand** for client state
- **next-intl 3.17** for i18n (`en`, `he`, `ar`; RTL-aware)
- **recharts** for charts, **@cornerstonejs/core** + DICOM loader for imaging
- **socket.io-client** for realtime alerts/vitals/predictions
- **@medflow/ui** design system, **@medflow/shared-types**, **@medflow/fhir-types**
- **vitest** + Testing Library (unit), **Playwright** (e2e)

## Quick start

```bash
pnpm install                       # from the monorepo root
cp apps/clinician-dashboard/.env.example apps/clinician-dashboard/.env.local
pnpm --filter @medflow/clinician-dashboard dev   # http://localhost:3000
```

Scripts (run with `pnpm --filter @medflow/clinician-dashboard <script>`):

| Script      | Purpose                                  |
| ----------- | ---------------------------------------- |
| `dev`       | Dev server on :3000                      |
| `build`     | Production build (standalone)            |
| `start`     | Serve the production build               |
| `lint`      | ESLint (next + typescript-eslint)        |
| `typecheck` | `tsc --noEmit`                           |
| `test`      | Vitest unit tests                        |
| `e2e`       | Playwright tests                         |

## Environment

All configuration is public (`NEXT_PUBLIC_*`) and validated with zod in
`src/lib/env.ts`:

| Variable                    | Default                  | Service           |
| --------------------------- | ------------------------ | ----------------- |
| `NEXT_PUBLIC_API_URL`       | `http://localhost:4000`  | API gateway       |
| `NEXT_PUBLIC_REALTIME_URL`  | `http://localhost:4001`  | Socket.IO gateway |
| `NEXT_PUBLIC_CDS_URL`       | `http://localhost:8096`  | CDS Hooks         |

## Architecture

```
src/
  app/[locale]/            App Router tree (locale-prefixed)
    (auth)/login           Standalone + SMART-launch login
    (app)/                 Authenticated shell (sidebar/topbar)
      worklist             Risk-ranked, sortable, live-promoting table
      patient/[id]         Patient 360 tabs + break-glass MRN reveal
      cohort               Cohort builder
    admin/                 audit (hash-chain) + models (governance)
  app/callback             OAuth/SMART redirect target (own root layout)
  components/              Charts, dialogs, shell, patient tabs
  lib/
    api/                   typed fetch client, query hooks, query-keys
    auth/                  PKCE, SMART launch, in-memory session store
    realtime/             Socket.IO client + useRealtimeAlerts
    cohort.ts mrn.ts risk.ts cds.ts markdown.tsx
  data/valuesets.json      Synthetic SNOMED/RxNorm options for cohorts
  i18n.ts i18n/routing.ts  next-intl request config + locale helpers
  middleware.ts            next-intl + auth-cookie gate
messages/{en,he,ar}.json   Translations (nav/common/risk fully localized)
```

### Auth & SMART on FHIR

- **Standalone login** sets an in-memory access token and a non-sensitive
  `mf_authed` presence cookie that the middleware checks.
- **EHR launch** reads `?iss=&launch=` and performs Authorization Code + PKCE
  (S256) via `/oauth/authorize`; `/callback` exchanges the code at
  `/oauth/token`. Tokens live **in memory only**; the PKCE verifier/state are
  kept in `sessionStorage` for the redirect round-trip.
- The API client attaches the bearer token and attempts a single refresh on 401.

### Realtime

`useRealtimeAlerts` subscribes (SSR-safe, effect-only) to `sepsis-alert`,
`vitals-update` and `prediction`. Worklist sepsis alerts promote the patient to
the top and raise a toast; the Vitals tab appends live points.

### Imaging

The Imaging tab initializes Cornerstone3D + the WADO-URI DICOM loader via a
client-only dynamic import inside an effect, guarded with try/catch. When no
real `ImagingStudy`/instance is available it falls back to a synthetic phantom
canvas so the window/level sliders and the Grad-CAM overlay (base64 PNG from
`/ml/chest-xray`, opacity-composited via `mix-blend`) remain fully wired.

## Accessibility (WCAG AA)

Skip link to `#main`, semantic landmarks (`header`/`nav`/`main`/`footer`),
`aria-sort` on sortable headers, `aria-label` on icon buttons, focus-visible
rings, focus-trapped dialogs (from `@medflow/ui`), tables with `<caption>` and
`scope="col"`, and `role="img"` + summaries on every chart. The language
switcher updates `<html dir>` (RTL for `he`/`ar`).

## i18n

`nav`, `common` and `risk` namespaces are fully translated into English, Hebrew
and Arabic; longer medical strings are English-only and deep-merged over the
English base so nothing renders as a missing key.

## Testing

- **Unit** (`pnpm … test`): risk sort, PKCE (charset/length + RFC 7636 known
  vectors), cohort mapper + CSV, MRN masking.
- **E2E** (`pnpm … e2e`): the default specs mock **all** network with
  `page.route` and pass headless with **no backend**. Specs tagged `@live` in
  their describe title skip mocking and require the running stack.

## Docker

```bash
# Dev (hot reload), build context = monorepo root:
docker build -f apps/clinician-dashboard/Dockerfile --target dev -t cd:dev .
docker run -p 3000:3000 cd:dev

# Production (standalone runner):
docker build -f apps/clinician-dashboard/Dockerfile -t cd:prod .
docker run -p 3000:3000 cd:prod
```
