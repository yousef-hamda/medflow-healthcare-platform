/**
 * SMART on FHIR v1 scope grammar (http://hl7.org/fhir/smart-app-launch/):
 *
 *   ( "patient" | "user" | "system" ) "/" ( ResourceType | "*" ) "." ( "read" | "write" | "*" )
 *
 * MedFlow extension: the `.full` permission is `.read` plus access to
 * minimum-necessary-masked fields (identifier / telecom / address). It is a
 * deliberate, documented deviation used by the fhir-proxy masking middleware.
 */

export type SmartScopeContext = "patient" | "user" | "system";
export type SmartScopePermission = "read" | "write" | "*" | "full";

export interface SmartScope {
  /** Compartment the authorization is rooted in. */
  context: SmartScopeContext;
  /** FHIR resource type (e.g. "Observation") or "*" for all types. */
  resourceType: string;
  permission: SmartScopePermission;
}

/** Launch-context and OIDC scopes that are valid but carry no resource grant. */
export const SPECIAL_SCOPES = [
  "launch",
  "launch/patient",
  "launch/encounter",
  "openid",
  "fhirUser",
  "profile",
  "offline_access",
  "online_access",
] as const;
export type SpecialScope = (typeof SPECIAL_SCOPES)[number];

export interface ParsedScopes {
  resourceScopes: SmartScope[];
  specialScopes: SpecialScope[];
  /** Anything that matched neither grammar — callers should reject or ignore. */
  unrecognized: string[];
}

const RESOURCE_SCOPE_RE = /^(patient|user|system)\/([A-Z][A-Za-z]*|\*)\.(read|write|\*|full)$/;

export function isSpecialScope(scope: string): scope is SpecialScope {
  return (SPECIAL_SCOPES as readonly string[]).includes(scope);
}

/**
 * Parses a single resource scope such as `patient/Observation.read`.
 * Returns null for special scopes and malformed input.
 */
export function parseSmartScope(scope: string): SmartScope | null {
  const match = RESOURCE_SCOPE_RE.exec(scope.trim());
  if (!match) return null;
  const [, context, resourceType, permission] = match;
  return {
    context: context as SmartScopeContext,
    resourceType: resourceType as string,
    permission: permission as SmartScopePermission,
  };
}

/**
 * Parses a space-delimited scope string (or pre-split array) into resource
 * scopes, special scopes, and unrecognized leftovers.
 */
export function parseSmartScopes(scopes: string | readonly string[]): ParsedScopes {
  const list = typeof scopes === "string" ? scopes.split(/\s+/) : scopes;
  const result: ParsedScopes = { resourceScopes: [], specialScopes: [], unrecognized: [] };
  for (const raw of list) {
    const scope = raw.trim();
    if (scope.length === 0) continue;
    if (isSpecialScope(scope)) {
      result.specialScopes.push(scope);
      continue;
    }
    const parsed = parseSmartScope(scope);
    if (parsed) {
      result.resourceScopes.push(parsed);
    } else {
      result.unrecognized.push(scope);
    }
  }
  return result;
}

export interface ScopeRequirement {
  /** When omitted, any context satisfies the requirement. */
  context?: SmartScopeContext;
  resourceType: string;
  permission: Exclude<SmartScopePermission, "*">;
}

function permissionSatisfies(
  granted: SmartScopePermission,
  required: ScopeRequirement["permission"],
): boolean {
  if (granted === "*") return true;
  if (granted === required) return true;
  // `.full` is a superset of `.read` (read + unmasked fields).
  return granted === "full" && required === "read";
}

/** Returns true when any granted scope satisfies the requirement. */
export function scopesAllow(
  granted: readonly SmartScope[],
  required: ScopeRequirement,
): boolean {
  return granted.some(
    (scope) =>
      (required.context === undefined || scope.context === required.context) &&
      (scope.resourceType === "*" || scope.resourceType === required.resourceType) &&
      permissionSatisfies(scope.permission, required.permission),
  );
}

/** True when scopes include unmasked access (`.full` or wildcard permission). */
export function hasFullFieldAccess(granted: readonly SmartScope[], resourceType: string): boolean {
  return granted.some(
    (scope) =>
      (scope.resourceType === "*" || scope.resourceType === resourceType) &&
      (scope.permission === "full" || scope.permission === "*"),
  );
}

/** Serializes a SmartScope back to its canonical string form. */
export function formatSmartScope(scope: SmartScope): string {
  return `${scope.context}/${scope.resourceType}.${scope.permission}`;
}
