/**
 * Offline outbox for message sends. When the device is offline, sends are
 * queued in AsyncStorage and flushed (FIFO) when connectivity returns.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { apiFetch } from "@/lib/api";
import { createLogger } from "@/lib/logger";

const log = createLogger("outbox");

export const OUTBOX_KEY = "medflow.messageOutbox.v1";

export interface OutboxItem {
  id: string;
  threadId: string;
  body: string;
  queuedAt: string; // ISO
}

export async function readOutbox(): Promise<OutboxItem[]> {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    return raw ? (JSON.parse(raw) as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

async function writeOutbox(items: OutboxItem[]): Promise<void> {
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
}

export async function enqueueMessage(item: OutboxItem): Promise<void> {
  const items = await readOutbox();
  items.push(item);
  await writeOutbox(items);
  log.info("message queued for later delivery");
}

export async function clearOutbox(): Promise<void> {
  await AsyncStorage.removeItem(OUTBOX_KEY);
}

let flushing = false;

/** Sends queued messages in order. Stops at the first failure (retried later). */
export async function flushOutbox(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    let items = await readOutbox();
    while (items.length > 0) {
      const next = items[0];
      if (!next) break;
      try {
        await apiFetch(`/me/messages/${encodeURIComponent(next.threadId)}`, {
          method: "POST",
          body: { body: next.body, clientId: next.id },
        });
        items = items.slice(1);
        await writeOutbox(items);
        sent += 1;
      } catch (err) {
        log.warn("outbox flush halted; will retry on next connect", err);
        break;
      }
    }
  } finally {
    flushing = false;
  }
  if (sent > 0) log.info(`outbox flushed ${sent} message(s)`);
  return sent;
}
