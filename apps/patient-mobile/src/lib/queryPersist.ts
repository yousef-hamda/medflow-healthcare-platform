/**
 * TanStack Query v5 offline cache: AsyncStorage persister configuration.
 *
 * Only read-model queries (records, results, appointments, vitals, messages,
 * profile) are dehydrated. Anything marked `meta.noPersist` is excluded so we
 * never persist transient/sensitive queries.
 */
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient, type Query } from "@tanstack/react-query";
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";

export const PERSIST_STORAGE_KEY = "medflow.queryCache.v1";
/** Bump to invalidate previously persisted caches after breaking changes. */
export const PERSIST_BUSTER = "v1";
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

export const PERSISTED_SCOPES: readonly string[] = [
  "me",
  "records",
  "results",
  "appointments",
  "vitals",
  "messages",
];

export interface AsyncStringStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
}

export function shouldPersistQuery(query: Query): boolean {
  if (query.state.status !== "success") return false;
  if (query.meta?.noPersist === true) return false;
  const scope = query.queryKey[0];
  return typeof scope === "string" && PERSISTED_SCOPES.includes(scope);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Serve cached data instantly while offline; refetch when back online.
        networkMode: "offlineFirst",
        staleTime: 60_000,
        gcTime: CACHE_MAX_AGE_MS,
        retry: 2,
      },
      mutations: {
        networkMode: "offlineFirst",
      },
    },
  });
}

export function createPersistOptions(
  storage: AsyncStringStorage,
): Omit<PersistQueryClientOptions, "queryClient"> {
  return {
    persister: createAsyncStoragePersister({
      storage,
      key: PERSIST_STORAGE_KEY,
      throttleTime: 1_000,
    }),
    maxAge: CACHE_MAX_AGE_MS,
    buster: PERSIST_BUSTER,
    dehydrateOptions: {
      shouldDehydrateQuery: shouldPersistQuery,
    },
  };
}
