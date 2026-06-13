/** Non-sensitive user preferences, persisted in AsyncStorage. */
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Locale } from "@/i18n/locales";

export interface AppSettings {
  locale: Locale;
  theme: "system" | "light" | "dark";
  biometricEnabled: boolean;
  notificationsEnabled: boolean;
}

export const SETTINGS_KEY = "medflow.settings.v1";

export const DEFAULT_SETTINGS: AppSettings = {
  locale: "en",
  theme: "system",
  biometricEnabled: false,
  notificationsEnabled: true,
};

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
