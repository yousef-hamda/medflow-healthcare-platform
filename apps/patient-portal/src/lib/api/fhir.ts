import type { AnyResource, Bundle, Resource } from "@medflow/fhir-types";
import { isBundle } from "@medflow/fhir-types";
import { apiClient, type RequestOptions } from "@/lib/api/client";

/** Extracts resources of a given type from a FHIR search Bundle. */
export function bundleResources<T extends Resource>(bundle: Bundle<AnyResource> | undefined, resourceType: T["resourceType"]): T[] {
  if (!bundle?.entry) return [];
  const out: T[] = [];
  for (const entry of bundle.entry) {
    const res = entry.resource;
    if (res && res.resourceType === resourceType) {
      out.push(res as unknown as T);
    }
  }
  return out;
}

/**
 * Performs a FHIR search via the gateway proxy and returns the typed Bundle.
 * Returns an empty Bundle if the gateway responds with a non-bundle payload.
 */
export async function fhirSearch(
  resourceType: string,
  params?: Record<string, string | number | boolean | undefined>,
  options?: RequestOptions,
): Promise<Bundle<AnyResource>> {
  const result = await apiClient.get<unknown>(`/fhir/${resourceType}`, { ...options, params });
  if (isBundle(result)) return result as Bundle<AnyResource>;
  return { resourceType: "Bundle", type: "searchset", entry: [] };
}
