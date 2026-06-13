"use client";

import { useEffect, useRef, useState } from "react";

import type {
  KafkaAlertEvent,
  PredictionEvent,
  VitalsReading,
} from "@medflow/shared-types";

import { connectSocket, getSocket } from "@/lib/realtime/socket";

export interface RealtimeHandlers {
  onSepsisAlert?: (event: KafkaAlertEvent) => void;
  onVitals?: (reading: VitalsReading) => void;
  onPrediction?: (event: PredictionEvent) => void;
  /** Restrict vitals/predictions to a single patient room. */
  patientId?: string;
  /** Connect the socket when mounted (default true). */
  enabled?: boolean;
}

export interface RealtimeState {
  /** Most recent alerts, newest first (capped). */
  alerts: KafkaAlertEvent[];
  latestVitals: VitalsReading | null;
  latestPrediction: PredictionEvent | null;
  connected: boolean;
}

const MAX_ALERTS = 50;

/**
 * SSR-safe subscription to realtime events. Effects only run client-side, so
 * the socket is never touched during render or on the server.
 */
export function useRealtimeAlerts(handlers: RealtimeHandlers = {}): RealtimeState {
  const { onSepsisAlert, onVitals, onPrediction, patientId, enabled = true } = handlers;

  const [alerts, setAlerts] = useState<KafkaAlertEvent[]>([]);
  const [latestVitals, setLatestVitals] = useState<VitalsReading | null>(null);
  const [latestPrediction, setLatestPrediction] = useState<PredictionEvent | null>(null);
  const [connected, setConnected] = useState(false);

  // Keep latest callbacks without re-subscribing every render.
  const handlersRef = useRef({ onSepsisAlert, onVitals, onPrediction });
  handlersRef.current = { onSepsisAlert, onVitals, onPrediction };

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const socket = connectSocket();

    const handleConnect = (): void => setConnected(true);
    const handleDisconnect = (): void => setConnected(false);

    const handleAlert = (event: KafkaAlertEvent): void => {
      setAlerts((prev) => [event, ...prev].slice(0, MAX_ALERTS));
      handlersRef.current.onSepsisAlert?.(event);
    };
    const handleVitals = (reading: VitalsReading): void => {
      if (patientId && reading.patientId !== patientId) return;
      setLatestVitals(reading);
      handlersRef.current.onVitals?.(reading);
    };
    const handlePrediction = (event: PredictionEvent): void => {
      if (patientId && event.patientId !== patientId) return;
      setLatestPrediction(event);
      handlersRef.current.onPrediction?.(event);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("sepsis-alert", handleAlert);
    socket.on("vitals-update", handleVitals);
    socket.on("prediction", handlePrediction);

    if (patientId) socket.emit("subscribe:patient", patientId);
    setConnected(socket.connected);

    return () => {
      if (patientId) socket.emit("unsubscribe:patient", patientId);
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("sepsis-alert", handleAlert);
      socket.off("vitals-update", handleVitals);
      socket.off("prediction", handlePrediction);
    };
  }, [enabled, patientId]);

  return { alerts, latestVitals, latestPrediction, connected };
}

/** Imperative access to the socket for advanced use (kept for parity). */
export { getSocket };
