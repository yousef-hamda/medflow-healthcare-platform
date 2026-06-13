/**
 * FHIR R4 resource interfaces (pragmatic, hand-written subset).
 *
 * These cover the elements MedFlow actually reads/writes, typed faithfully to
 * http://hl7.org/fhir/R4. They are intentionally NOT exhaustive — see the
 * package README; full machine-generated typings (@types/fhir) are a documented
 * alternative if coverage needs grow.
 */

import type {
  Address,
  Annotation,
  Attachment,
  CodeableConcept,
  Coding,
  ContactPoint,
  Dosage,
  FhirCanonical,
  FhirCode,
  FhirDate,
  FhirDateTime,
  FhirId,
  FhirInstant,
  FhirUri,
  HumanName,
  Identifier,
  Meta,
  Narrative,
  Period,
  Quantity,
  Range,
  Ratio,
  Reference,
} from "./datatypes.js";

export interface Resource {
  resourceType: string;
  id?: FhirId;
  meta?: Meta;
  implicitRules?: FhirUri;
  language?: FhirCode;
}

export interface DomainResource extends Resource {
  text?: Narrative;
  contained?: AnyResource[];
}

// ───────────────────────────── Patient ─────────────────────────────

export interface PatientContact {
  relationship?: CodeableConcept[];
  name?: HumanName;
  telecom?: ContactPoint[];
  address?: Address;
  gender?: AdministrativeGender;
  organization?: Reference;
  period?: Period;
}

export type AdministrativeGender = "male" | "female" | "other" | "unknown";

export interface Patient extends DomainResource {
  resourceType: "Patient";
  identifier?: Identifier[];
  active?: boolean;
  name?: HumanName[];
  telecom?: ContactPoint[];
  gender?: AdministrativeGender;
  birthDate?: FhirDate;
  deceasedBoolean?: boolean;
  deceasedDateTime?: FhirDateTime;
  address?: Address[];
  maritalStatus?: CodeableConcept;
  contact?: PatientContact[];
  communication?: Array<{ language: CodeableConcept; preferred?: boolean }>;
  generalPractitioner?: Reference[];
  managingOrganization?: Reference;
}

// ───────────────────────────── Encounter ─────────────────────────────

export type EncounterStatus =
  | "planned"
  | "arrived"
  | "triaged"
  | "in-progress"
  | "onleave"
  | "finished"
  | "cancelled"
  | "entered-in-error"
  | "unknown";

export interface Encounter extends DomainResource {
  resourceType: "Encounter";
  identifier?: Identifier[];
  status: EncounterStatus;
  class: Coding;
  type?: CodeableConcept[];
  serviceType?: CodeableConcept;
  priority?: CodeableConcept;
  subject?: Reference;
  participant?: Array<{
    type?: CodeableConcept[];
    period?: Period;
    individual?: Reference;
  }>;
  period?: Period;
  reasonCode?: CodeableConcept[];
  diagnosis?: Array<{ condition: Reference; use?: CodeableConcept; rank?: number }>;
  hospitalization?: {
    admitSource?: CodeableConcept;
    dischargeDisposition?: CodeableConcept;
    destination?: Reference;
  };
  location?: Array<{ location: Reference; status?: "planned" | "active" | "reserved" | "completed"; period?: Period }>;
  serviceProvider?: Reference;
}

// ───────────────────────────── Observation ─────────────────────────────

export type ObservationStatus =
  | "registered"
  | "preliminary"
  | "final"
  | "amended"
  | "corrected"
  | "cancelled"
  | "entered-in-error"
  | "unknown";

export interface ObservationComponent {
  code: CodeableConcept;
  valueQuantity?: Quantity;
  valueCodeableConcept?: CodeableConcept;
  valueString?: string;
  valueBoolean?: boolean;
  valueInteger?: number;
  valueRange?: Range;
  valueRatio?: Ratio;
  dataAbsentReason?: CodeableConcept;
  interpretation?: CodeableConcept[];
  referenceRange?: ObservationReferenceRange[];
}

export interface ObservationReferenceRange {
  low?: Quantity;
  high?: Quantity;
  type?: CodeableConcept;
  text?: string;
}

export interface Observation extends DomainResource {
  resourceType: "Observation";
  identifier?: Identifier[];
  basedOn?: Reference[];
  status: ObservationStatus;
  category?: CodeableConcept[];
  code: CodeableConcept;
  subject?: Reference;
  encounter?: Reference;
  effectiveDateTime?: FhirDateTime;
  effectivePeriod?: Period;
  issued?: FhirInstant;
  performer?: Reference[];
  valueQuantity?: Quantity;
  valueCodeableConcept?: CodeableConcept;
  valueString?: string;
  valueBoolean?: boolean;
  valueInteger?: number;
  valueRange?: Range;
  valueRatio?: Ratio;
  dataAbsentReason?: CodeableConcept;
  interpretation?: CodeableConcept[];
  note?: Annotation[];
  bodySite?: CodeableConcept;
  method?: CodeableConcept;
  device?: Reference;
  referenceRange?: ObservationReferenceRange[];
  hasMember?: Reference[];
  derivedFrom?: Reference[];
  component?: ObservationComponent[];
}

// ───────────────────────────── Condition ─────────────────────────────

export interface Condition extends DomainResource {
  resourceType: "Condition";
  identifier?: Identifier[];
  clinicalStatus?: CodeableConcept;
  verificationStatus?: CodeableConcept;
  category?: CodeableConcept[];
  severity?: CodeableConcept;
  code?: CodeableConcept;
  bodySite?: CodeableConcept[];
  subject: Reference;
  encounter?: Reference;
  onsetDateTime?: FhirDateTime;
  onsetPeriod?: Period;
  abatementDateTime?: FhirDateTime;
  recordedDate?: FhirDateTime;
  recorder?: Reference;
  asserter?: Reference;
  note?: Annotation[];
}

// ───────────────────────────── MedicationRequest ─────────────────────────────

export type MedicationRequestStatus =
  | "active"
  | "on-hold"
  | "cancelled"
  | "completed"
  | "entered-in-error"
  | "stopped"
  | "draft"
  | "unknown";

export type MedicationRequestIntent =
  | "proposal"
  | "plan"
  | "order"
  | "original-order"
  | "reflex-order"
  | "filler-order"
  | "instance-order"
  | "option";

export interface MedicationRequest extends DomainResource {
  resourceType: "MedicationRequest";
  identifier?: Identifier[];
  status: MedicationRequestStatus;
  statusReason?: CodeableConcept;
  intent: MedicationRequestIntent;
  category?: CodeableConcept[];
  priority?: "routine" | "urgent" | "asap" | "stat";
  medicationCodeableConcept?: CodeableConcept;
  medicationReference?: Reference;
  subject: Reference;
  encounter?: Reference;
  authoredOn?: FhirDateTime;
  requester?: Reference;
  reasonCode?: CodeableConcept[];
  reasonReference?: Reference[];
  note?: Annotation[];
  dosageInstruction?: Dosage[];
  dispenseRequest?: {
    validityPeriod?: Period;
    numberOfRepeatsAllowed?: number;
    quantity?: Quantity;
    expectedSupplyDuration?: Quantity;
  };
  substitution?: { allowedBoolean?: boolean; reason?: CodeableConcept };
}

// ───────────────────────────── DiagnosticReport ─────────────────────────────

export type DiagnosticReportStatus =
  | "registered"
  | "partial"
  | "preliminary"
  | "final"
  | "amended"
  | "corrected"
  | "appended"
  | "cancelled"
  | "entered-in-error"
  | "unknown";

export interface DiagnosticReport extends DomainResource {
  resourceType: "DiagnosticReport";
  identifier?: Identifier[];
  basedOn?: Reference[];
  status: DiagnosticReportStatus;
  category?: CodeableConcept[];
  code: CodeableConcept;
  subject?: Reference;
  encounter?: Reference;
  effectiveDateTime?: FhirDateTime;
  effectivePeriod?: Period;
  issued?: FhirInstant;
  performer?: Reference[];
  resultsInterpreter?: Reference[];
  result?: Reference[];
  imagingStudy?: Reference[];
  media?: Array<{ comment?: string; link: Reference }>;
  conclusion?: string;
  conclusionCode?: CodeableConcept[];
  presentedForm?: Attachment[];
}

// ───────────────────────────── ImagingStudy ─────────────────────────────

export type ImagingStudyStatus = "registered" | "available" | "cancelled" | "entered-in-error" | "unknown";

export interface ImagingStudySeriesInstance {
  uid: FhirId;
  sopClass: Coding;
  number?: number;
  title?: string;
}

export interface ImagingStudySeries {
  uid: FhirId;
  number?: number;
  modality: Coding;
  description?: string;
  numberOfInstances?: number;
  endpoint?: Reference[];
  bodySite?: Coding;
  started?: FhirDateTime;
  instance?: ImagingStudySeriesInstance[];
}

export interface ImagingStudy extends DomainResource {
  resourceType: "ImagingStudy";
  identifier?: Identifier[];
  status: ImagingStudyStatus;
  modality?: Coding[];
  subject: Reference;
  encounter?: Reference;
  started?: FhirDateTime;
  basedOn?: Reference[];
  referrer?: Reference;
  endpoint?: Reference[];
  numberOfSeries?: number;
  numberOfInstances?: number;
  procedureCode?: CodeableConcept[];
  reasonCode?: CodeableConcept[];
  description?: string;
  series?: ImagingStudySeries[];
}

// ───────────────────────────── DocumentReference ─────────────────────────────

export type DocumentReferenceStatus = "current" | "superseded" | "entered-in-error";

export interface DocumentReference extends DomainResource {
  resourceType: "DocumentReference";
  masterIdentifier?: Identifier;
  identifier?: Identifier[];
  status: DocumentReferenceStatus;
  docStatus?: "preliminary" | "final" | "amended" | "entered-in-error";
  type?: CodeableConcept;
  category?: CodeableConcept[];
  subject?: Reference;
  date?: FhirInstant;
  author?: Reference[];
  authenticator?: Reference;
  custodian?: Reference;
  description?: string;
  securityLabel?: CodeableConcept[];
  content: Array<{ attachment: Attachment; format?: Coding }>;
  context?: {
    encounter?: Reference[];
    event?: CodeableConcept[];
    period?: Period;
    facilityType?: CodeableConcept;
    practiceSetting?: CodeableConcept;
    related?: Reference[];
  };
}

// ───────────────────────────── ServiceRequest ─────────────────────────────

export type ServiceRequestStatus =
  | "draft"
  | "active"
  | "on-hold"
  | "revoked"
  | "completed"
  | "entered-in-error"
  | "unknown";

export type ServiceRequestIntent =
  | "proposal"
  | "plan"
  | "directive"
  | "order"
  | "original-order"
  | "reflex-order"
  | "filler-order"
  | "instance-order"
  | "option";

export interface ServiceRequest extends DomainResource {
  resourceType: "ServiceRequest";
  identifier?: Identifier[];
  basedOn?: Reference[];
  status: ServiceRequestStatus;
  intent: ServiceRequestIntent;
  category?: CodeableConcept[];
  priority?: "routine" | "urgent" | "asap" | "stat";
  code?: CodeableConcept;
  orderDetail?: CodeableConcept[];
  subject: Reference;
  encounter?: Reference;
  occurrenceDateTime?: FhirDateTime;
  occurrencePeriod?: Period;
  authoredOn?: FhirDateTime;
  requester?: Reference;
  performer?: Reference[];
  reasonCode?: CodeableConcept[];
  reasonReference?: Reference[];
  note?: Annotation[];
}

// ───────────────────────────── OperationOutcome ─────────────────────────────

export type IssueSeverity = "fatal" | "error" | "warning" | "information";

export interface OperationOutcomeIssue {
  severity: IssueSeverity;
  code: FhirCode;
  details?: CodeableConcept;
  diagnostics?: string;
  expression?: string[];
}

export interface OperationOutcome extends DomainResource {
  resourceType: "OperationOutcome";
  issue: OperationOutcomeIssue[];
}

// ───────────────────────────── Bundle ─────────────────────────────

export type BundleType =
  | "document"
  | "message"
  | "transaction"
  | "transaction-response"
  | "batch"
  | "batch-response"
  | "history"
  | "searchset"
  | "collection";

export interface BundleLink {
  relation: string;
  url: FhirUri;
}

export interface BundleEntry<T extends Resource = AnyResource> {
  fullUrl?: FhirUri;
  resource?: T;
  search?: { mode?: "match" | "include" | "outcome"; score?: number };
  request?: {
    method: "GET" | "HEAD" | "POST" | "PUT" | "DELETE" | "PATCH";
    url: FhirUri;
    ifNoneMatch?: string;
    ifNoneExist?: string;
  };
  response?: {
    status: string;
    location?: FhirUri;
    etag?: string;
    lastModified?: FhirInstant;
    outcome?: AnyResource;
  };
}

export interface Bundle<T extends Resource = AnyResource> extends Resource {
  resourceType: "Bundle";
  identifier?: Identifier;
  type: BundleType;
  timestamp?: FhirInstant;
  total?: number;
  link?: BundleLink[];
  entry?: Array<BundleEntry<T>>;
  signature?: { type: Coding[]; when: FhirInstant; who: Reference };
}

// ───────────────────────────── Union ─────────────────────────────

export type AnyResource =
  | Patient
  | Encounter
  | Observation
  | Condition
  | MedicationRequest
  | DiagnosticReport
  | ImagingStudy
  | DocumentReference
  | ServiceRequest
  | OperationOutcome
  | Bundle<Resource>;

export type AnyResourceType = AnyResource["resourceType"];
