# @medflow/fhir-types

Hand-written TypeScript interfaces for the FHIR **R4** resources MedFlow uses:

`Patient`, `Encounter`, `Observation`, `Condition`, `MedicationRequest`,
`DiagnosticReport`, `ImagingStudy`, `DocumentReference`, `ServiceRequest`,
`Bundle`, `OperationOutcome` — plus the general-purpose data types they depend
on (`CodeableConcept`, `Identifier`, `HumanName`, `ContactPoint`, `Address`,
`Quantity`, `Reference`, `Period`, `Attachment`, ...).

## Scope: a pragmatic subset

This package deliberately models only the elements MedFlow reads and writes,
typed faithfully to the [R4 spec](http://hl7.org/fhir/R4/). It is **not** a
complete rendering of FHIR. The trade-off is reviewable, dependency-free types
with precise unions for status codes.

> Alternative: full machine-generated typings via
> [`@types/fhir`](https://www.npmjs.com/package/@types/fhir) (or codegen from
> the FHIR StructureDefinitions). If MedFlow's resource coverage grows beyond
> this curated set, switch rather than hand-extending indefinitely.

## Type guards

Runtime guards for wire payloads: `isFhirResource`, `isPatient`,
`isObservation`, `isBundle`, `isOperationOutcome`, etc., plus
`resourcesOfType(bundle, guard)` to extract typed entries from a searchset.

## Build

Dual ESM + CJS via tsup:

```bash
pnpm --filter @medflow/fhir-types build
pnpm --filter @medflow/fhir-types test
```
