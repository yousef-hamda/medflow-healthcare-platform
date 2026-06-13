/** Centralized, typed environment access. */

export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

export const OAUTH_CLIENT_ID: string =
  process.env.EXPO_PUBLIC_OAUTH_CLIENT_ID ?? "medflow-patient-mobile";
