/** expo-secure-store adapter implementing the KeyValueStore interface. */
import * as SecureStore from "expo-secure-store";

import type { KeyValueStore } from "@/lib/auth";

export const secureStorage: KeyValueStore = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    }),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};
