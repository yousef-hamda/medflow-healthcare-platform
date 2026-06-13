/**
 * FHIR R4 general-purpose data types (pragmatic subset).
 * Field shapes follow http://hl7.org/fhir/R4/datatypes.html.
 */

/** FHIR `instant` / `dateTime` / `date` are carried as ISO-8601 strings. */
export type FhirDateTime = string;
export type FhirDate = string;
export type FhirInstant = string;
export type FhirUri = string;
export type FhirCanonical = string;
export type FhirCode = string;
export type FhirId = string;
export type FhirMarkdown = string;

export interface Element {
  id?: string;
  extension?: Extension[];
}

export interface Extension extends Element {
  url: FhirUri;
  valueString?: string;
  valueCode?: FhirCode;
  valueBoolean?: boolean;
  valueInteger?: number;
  valueDecimal?: number;
  valueDateTime?: FhirDateTime;
  valueCoding?: Coding;
  valueCodeableConcept?: CodeableConcept;
  valueReference?: Reference;
}

export interface Coding extends Element {
  system?: FhirUri;
  version?: string;
  code?: FhirCode;
  display?: string;
  userSelected?: boolean;
}

export interface CodeableConcept extends Element {
  coding?: Coding[];
  text?: string;
}

export interface Period extends Element {
  start?: FhirDateTime;
  end?: FhirDateTime;
}

export interface Identifier extends Element {
  use?: "usual" | "official" | "temp" | "secondary" | "old";
  type?: CodeableConcept;
  system?: FhirUri;
  value?: string;
  period?: Period;
  assigner?: Reference;
}

export interface Reference extends Element {
  /** Literal reference, e.g. "Patient/123". */
  reference?: string;
  type?: FhirUri;
  identifier?: Identifier;
  display?: string;
}

export interface HumanName extends Element {
  use?: "usual" | "official" | "temp" | "nickname" | "anonymous" | "old" | "maiden";
  text?: string;
  family?: string;
  given?: string[];
  prefix?: string[];
  suffix?: string[];
  period?: Period;
}

export interface ContactPoint extends Element {
  system?: "phone" | "fax" | "email" | "pager" | "url" | "sms" | "other";
  value?: string;
  use?: "home" | "work" | "temp" | "old" | "mobile";
  rank?: number;
  period?: Period;
}

export interface Address extends Element {
  use?: "home" | "work" | "temp" | "old" | "billing";
  type?: "postal" | "physical" | "both";
  text?: string;
  line?: string[];
  city?: string;
  district?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  period?: Period;
}

export interface Quantity extends Element {
  value?: number;
  comparator?: "<" | "<=" | ">=" | ">";
  unit?: string;
  system?: FhirUri;
  code?: FhirCode;
}

export interface Range extends Element {
  low?: Quantity;
  high?: Quantity;
}

export interface Ratio extends Element {
  numerator?: Quantity;
  denominator?: Quantity;
}

export interface Annotation extends Element {
  authorReference?: Reference;
  authorString?: string;
  time?: FhirDateTime;
  text: FhirMarkdown;
}

export interface Attachment extends Element {
  contentType?: FhirCode;
  language?: FhirCode;
  /** Base64-encoded inline data. */
  data?: string;
  url?: FhirUri;
  size?: number;
  hash?: string;
  title?: string;
  creation?: FhirDateTime;
}

export interface Narrative extends Element {
  status: "generated" | "extensions" | "additional" | "empty";
  div: string;
}

export interface Meta extends Element {
  versionId?: FhirId;
  lastUpdated?: FhirInstant;
  source?: FhirUri;
  profile?: FhirCanonical[];
  security?: Coding[];
  tag?: Coding[];
}

export interface Dosage extends Element {
  sequence?: number;
  text?: string;
  patientInstruction?: string;
  asNeededBoolean?: boolean;
  route?: CodeableConcept;
  doseAndRate?: Array<{
    type?: CodeableConcept;
    doseQuantity?: Quantity;
    doseRange?: Range;
    rateQuantity?: Quantity;
    rateRatio?: Ratio;
  }>;
}
