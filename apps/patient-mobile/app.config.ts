import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * MedFlow patient app config.
 *
 * Privacy notes:
 * - iOS cannot truly block screenshots (there is no public "allowsTrueScreenshots"
 *   style API). expo-screen-capture's preventScreenCaptureAsync() sets
 *   FLAG_SECURE on Android (blocks screenshots + app-switcher snapshot) and on
 *   iOS only obscures *screen recordings*. For the iOS app-switcher snapshot we
 *   render an opaque overlay when AppState becomes "inactive" — see
 *   src/components/PrivacyShield.tsx.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "MedFlow",
  slug: "medflow-patient",
  scheme: "medflow",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  newArchEnabled: false,
  platforms: ["ios", "android"],
  splash: {
    backgroundColor: "#0f766e",
    resizeMode: "contain",
  },
  ios: {
    bundleIdentifier: "com.medflow.patient",
    buildNumber: "1",
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      NSFaceIDUsageDescription:
        "MedFlow uses Face ID to unlock your health record.",
      UIBackgroundModes: ["remote-notification"],
    },
  },
  android: {
    package: "com.medflow.patient",
    versionCode: 1,
    adaptiveIcon: { backgroundColor: "#0f766e" },
    permissions: ["USE_BIOMETRIC", "USE_FINGERPRINT", "POST_NOTIFICATIONS"],
  },
  locales: {},
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-localization",
    [
      "expo-local-authentication",
      { faceIDPermission: "MedFlow uses Face ID to unlock your health record." },
    ],
    [
      "expo-notifications",
      { color: "#0f766e", mode: "production" },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    router: { origin: false },
    eas: {
      // Replace with your real EAS project id before building.
      projectId: "00000000-0000-0000-0000-000000000000",
    },
  },
  runtimeVersion: { policy: "sdkVersion" },
  updates: {
    url: "https://u.expo.dev/00000000-0000-0000-0000-000000000000",
  },
});
