/** Thin wrapper around expo-local-authentication. */
import * as LocalAuthentication from "expo-local-authentication";

export async function biometricsAvailable(): Promise<boolean> {
  const [hasHardware, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hasHardware && enrolled;
}

export async function authenticateWithBiometrics(promptMessage: string): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: "Cancel",
    // We provide our own PIN fallback screen, so disable the OS passcode sheet.
    disableDeviceFallback: true,
  });
  return result.success;
}
