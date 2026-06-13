import { io, type Socket } from "socket.io-client";

import type {
  KafkaAlertEvent,
  PredictionEvent,
  VitalsReading,
} from "@medflow/shared-types";

import { env } from "@/lib/env";
import { getAuthSnapshot } from "@/lib/auth/store";

/** Server→client event payloads emitted by the realtime gateway. */
export interface ServerToClientEvents {
  "sepsis-alert": (event: KafkaAlertEvent) => void;
  "vitals-update": (reading: VitalsReading) => void;
  prediction: (event: PredictionEvent) => void;
}

/** Client→server events (room subscriptions). */
export interface ClientToServerEvents {
  "subscribe:patient": (patientId: string) => void;
  "unsubscribe:patient": (patientId: string) => void;
}

export type RealtimeSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: RealtimeSocket | null = null;

/** Lazily creates the (initially disconnected) Socket.IO client. */
export function getSocket(): RealtimeSocket {
  if (socket) return socket;
  socket = io(env.realtimeUrl, {
    autoConnect: false,
    transports: ["websocket"],
    auth: () => {
      const session = getAuthSnapshot();
      return session?.accessToken ? { token: session.accessToken } : {};
    },
  });
  return socket;
}

export function connectSocket(): RealtimeSocket {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket(): void {
  if (socket?.connected) socket.disconnect();
}
