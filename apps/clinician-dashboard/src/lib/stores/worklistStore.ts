"use client";

import { create } from "zustand";

import type { SortDirection, WorklistSortKey } from "@/lib/risk";

interface WorklistState {
  sortKey: WorklistSortKey;
  sortDirection: SortDirection;
  /** Patient ids promoted to the top by live alerts, newest first. */
  promotions: string[];
  setSort: (key: WorklistSortKey) => void;
  promote: (patientId: string) => void;
  clearPromotions: () => void;
}

export const useWorklistStore = create<WorklistState>((set) => ({
  sortKey: "primary",
  sortDirection: "desc",
  promotions: [],
  setSort: (key) =>
    set((state) => {
      if (state.sortKey === key) {
        return { sortDirection: state.sortDirection === "asc" ? "desc" : "asc" };
      }
      // New column defaults: text ascending, scores/dates descending.
      return { sortKey: key, sortDirection: key === "name" ? "asc" : "desc" };
    }),
  promote: (patientId) =>
    set((state) => ({
      promotions: [patientId, ...state.promotions.filter((id) => id !== patientId)],
    })),
  clearPromotions: () => set({ promotions: [] }),
}));
