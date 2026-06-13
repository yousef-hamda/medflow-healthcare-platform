"use client";

import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type {
  ChestXrayResult,
  PredictionResult,
} from "@/lib/api/types";

export interface PredictionInput {
  patientId: string;
  encounterId?: string;
}

export function useSepsisPrediction(): UseMutationResult<
  PredictionResult,
  Error,
  PredictionInput
> {
  return useMutation({
    mutationFn: (input) => apiClient.post<PredictionResult>("/ml/sepsis", input),
  });
}

export function useReadmissionPrediction(): UseMutationResult<
  PredictionResult,
  Error,
  PredictionInput
> {
  return useMutation({
    mutationFn: (input) => apiClient.post<PredictionResult>("/ml/readmission", input),
  });
}

export interface ChestXrayInput {
  patientId: string;
  studyUid?: string;
  instanceUid?: string;
}

export function useChestXray(): UseMutationResult<ChestXrayResult, Error, ChestXrayInput> {
  return useMutation({
    mutationFn: (input) => apiClient.post<ChestXrayResult>("/ml/chest-xray", input),
  });
}
