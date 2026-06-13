# @medflow/patient-portal

A warm, accessible, patient-facing portal for the MedFlow platform. Built with
Next.js 14 (App Router), it lets patients view lab results in plain language,
track vitals, manage appointments, message their care team, and create secure,
time-limited data-sharing links.

> **Synthetic data disclaimer:** Every value displayed in this app is
> **synthetic** — it is **not** real patient data. A prominent banner reinforces
> this throughout the UI.

## Features

- **Overview** — active problems (Conditions), current medications
  (MedicationRequest), and allergies (AllergyIntolerance, with a synthetic
  fallback list).
- **Lab results** — Observations grouped by panel, each with value, unit,
  reference range, and a color-and-text flag (low/normal/high). Clicking a
  result opens a friendly dialog explaining what the test measures, backed by a
  ~20-code LOINC plain-language map (`src/lib/loinc-explanations.ts`).
- **Appointments** — list upcoming/past, book, and cancel with confirmation
  toasts.
- **Vitals** — Recharts trend charts (heart rate, blood pressure, weight, SpO2)
  with a time-window toggle and accessible chart summaries.
- **Messages** — secure threads with the care team and a compose box.
- **Share** — scope picker + expiry (capped at 72h, validated), QR code of the
  share URL, copy link, and a local revoke list.
- **Profile** — basic demographics from `/users/me` + FHIR `Patient`.
- **Auth** — standalone mock email/password login (sets `mf_authed` cookie +
  in-memory token) and a 4-step registration wizard with a **mocked** phone OTP
  (no SMS is sent; a demo code is shown). PKCE S256 helpers
  (`src/lib/auth/pkce.ts`) are included for a real OAuth redirect flow.

## Getting started

```bash
pnpm install              # from the monorepo root
pnpm --filter @medflow/patient-portal dev
# open http://localhost:3001
```

Scripts:

| Script      | Description                       |
| ----------- | --------------------------------- |
| `dev`       | Next dev server on port 3001      |
| `build`     | Production build (standalone)     |
| `start`     | Serve the production build (3001) |
| `lint`      | `next lint`                       |
| `typecheck` | `tsc --noEmit`                    |
| `test`      | Vitest unit tests                 |
| `e2e`       | Playwright end-to-end tests       |

## Environment

Copy `.env.example` to `.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:4000      # gateway
NEXT_PUBLIC_REALTIME_URL=http://localhost:4001 # realtime gateway
```

Values are validated with zod in `src/lib/env.ts`. The gateway provides OAuth
(`/oauth/authorize`, `/oauth/token`, PKCE S256), `/users/me`, a `/fhir/*` proxy
(FHIR search returns a `Bundle`), `/messages`, `/appointments`, and
`/share/tokens`. Registration/OTP are mocked entirely client-side.

## Internationalization & accessibility

- **i18n** via `next-intl` (v3) with locales `en`, `he`, `ar` and
  `localePrefix: "always"`. Navigation, common actions, and risk labels are
  fully translated; longer medical copy is English with he/ar falling back to
  English. The document `dir` switches to `rtl` for Hebrew and Arabic.
- **a11y (WCAG AA):** skip link, semantic landmarks (`<main id="main">`, labelled
  nav), form fields labelled with errors associated via `aria-describedby` /
  `aria-invalid`, keyboard-operable dialogs and the registration wizard,
  focus-visible rings, accessible charts (role="img" summary + a visually
  hidden data table), and flags that never rely on color alone (icon + text).

## Tests & e2e

- **Unit (Vitest, jsdom):** LOINC map lookups, share-form validation (no scope,
  >72h expiry, valid), date grouping, and the lab flag/grouping helpers.

  ```bash
  pnpm --filter @medflow/patient-portal test
  ```

- **E2E (Playwright, chromium):** `e2e/lab-results.spec.ts` mocks **all** network
  via `page.route`, logs in (mock), navigates to `/me/results`, asserts results
  render grouped by panel, and opens a detail dialog showing the plain-language
  explanation. It runs headless with **no backend**. A `@live` variant hits the
  real gateway and is skipped unless `PW_LIVE=1`.

  ```bash
  pnpm --filter @medflow/patient-portal e2e
  ```

## Docker

Multi-stage `Dockerfile` with `deps`, `builder`, and standalone `runner` stages,
plus a `dev` target for hot reloading on port 3001.
