/**
 * Push notifications via Expo: permission + token registration (POSTed to the
 * gateway at /devices) and category/deep-link handling for the two server
 * categories: "new-result" and "appointment-reminder".
 */
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { apiFetch } from "@/lib/api";
import { createLogger } from "@/lib/logger";

const log = createLogger("push");

export const NOTIFICATION_CATEGORIES = {
  newResult: "new-result",
  appointmentReminder: "appointment-reminder",
} as const;

export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });
}

export async function configureNotificationCategories(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(NOTIFICATION_CATEGORIES.newResult, [
    { identifier: "view-result", buttonTitle: "View", options: { opensAppToForeground: true } },
  ]);
  await Notifications.setNotificationCategoryAsync(
    NOTIFICATION_CATEGORIES.appointmentReminder,
    [
      { identifier: "view-appointment", buttonTitle: "View", options: { opensAppToForeground: true } },
    ],
  );
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "MedFlow",
      importance: Notifications.AndroidImportance.DEFAULT,
      // Hide content on the lock screen — notification text may reference PHI.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }
}

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    log.debug("push registration skipped (simulator)");
    return null;
  }
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== "granted") return null;

  const tokenResponse = await Notifications.getExpoPushTokenAsync();
  const token = tokenResponse.data;
  try {
    await apiFetch("/devices", {
      method: "POST",
      body: { expoPushToken: token, platform: Platform.OS },
    });
    log.info("push token registered with gateway");
  } catch (err) {
    log.warn("failed to register push token", err);
  }
  return token;
}

/** Maps a tapped notification to an in-app route. */
export function routeForNotification(
  response: Notifications.NotificationResponse,
): string | null {
  const content = response.notification.request.content;
  const category = content.categoryIdentifier;
  const data = content.data as Record<string, unknown> | undefined;
  if (category === NOTIFICATION_CATEGORIES.newResult) {
    const resultId = typeof data?.resultId === "string" ? data.resultId : null;
    return resultId ? `/result/${resultId}` : "/(tabs)/results";
  }
  if (category === NOTIFICATION_CATEGORIES.appointmentReminder) {
    return "/(tabs)";
  }
  return null;
}
