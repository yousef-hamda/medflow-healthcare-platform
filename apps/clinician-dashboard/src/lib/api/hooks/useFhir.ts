"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  isCondition,
  isDocumentReference,
  isImagingStudy,
  isMedicationRequest,
  isObservation,
  isPatient,
  resourcesOfType,
  type Bundle,
  type Condition,
  type DocumentReference,
  type ImagingStudy,
  type MedicationRequest,
  type Observation,
  type Patient,
  type Resource,
} from "@medflow/fhir-types";

import { apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";

function entriesFromBundle<T extends Resource>(
  bundle: Bundle<Resource>,
  guard: (v: unknown) => v is T,
): T[] {
  return resourcesOfType<T>(bundle, guard);
}

export function usePatient(id: string): UseQueryResult<Patient> {
  return useQuery({
    queryKey: queryKeys.patient(id),
    enabled: Boolean(id),
    queryFn: async () => {
      const resource = await apiClient.get<Patient>(`/fhir/Patient/${id}`);
      if (!isPatient(resource)) throw new Error("Expected a Patient resource");
      return resource;
    },
  });
}

export interface ObservationParams {
  /** LOINC/category codes, comma-joined per FHIR search. */
  code?: string;
  category?: string;
  date?: string;
  _count?: number;
}

export function useObservations(
  patientId: string,
  params?: ObservationParams,
): UseQueryResult<Observation[]> {
  return useQuery({
    queryKey: queryKeys.observations(patientId, params),
    enabled: Boolean(patientId),
    queryFn: async () => {
      const bundle = await apiClient.get<Bundle<Resource>>("/fhir/Observation", {
        query: {
          patient: patientId,
          code: params?.code,
          category: params?.category,
          date: params?.date,
          _count: params?._count ?? 200,
          _sort: "date",
        },
      });
      return entriesFromBundle(bundle, isObservation);
    },
  });
}

export function useConditions(patientId: string): UseQueryResult<Condition[]> {
  return useQuery({
    queryKey: queryKeys.conditions(patientId),
    enabled: Boolean(patientId),
    queryFn: async () => {
      const bundle = await apiClient.get<Bundle<Resource>>("/fhir/Condition", {
        query: { patient: patientId, "clinical-status": "active", _count: 100 },
      });
      return entriesFromBundle(bundle, isCondition);
    },
  });
}

export function useMedications(patientId: string): UseQueryResult<MedicationRequest[]> {
  return useQuery({
    queryKey: queryKeys.medications(patientId),
    enabled: Boolean(patientId),
    queryFn: async () => {
      const bundle = await apiClient.get<Bundle<Resource>>("/fhir/MedicationRequest", {
        query: { patient: patientId, status: "active", _count: 100 },
      });
      return entriesFromBundle(bundle, isMedicationRequest);
    },
  });
}

export function useImagingStudies(patientId: string): UseQueryResult<ImagingStudy[]> {
  return useQuery({
    queryKey: queryKeys.imagingStudies(patientId),
    enabled: Boolean(patientId),
    queryFn: async () => {
      const bundle = await apiClient.get<Bundle<Resource>>("/fhir/ImagingStudy", {
        query: { patient: patientId, _count: 50 },
      });
      return entriesFromBundle(bundle, isImagingStudy);
    },
  });
}

export function useDocumentReferences(
  patientId: string,
): UseQueryResult<DocumentReference[]> {
  return useQuery({
    queryKey: queryKeys.documentReferences(patientId),
    enabled: Boolean(patientId),
    queryFn: async () => {
      const bundle = await apiClient.get<Bundle<Resource>>("/fhir/DocumentReference", {
        query: { patient: patientId, _count: 100, _sort: "-date" },
      });
      return entriesFromBundle(bundle, isDocumentReference);
    },
  });
}
