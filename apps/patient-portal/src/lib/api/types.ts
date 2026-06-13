/** Domain response interfaces for the gateway endpoints the portal calls. */

export interface UserMeResponse {
  id: string;
  name: string;
  email: string;
  patientId?: string;
  phone?: string;
}

export type AppointmentStatus = "booked" | "pending" | "cancelled" | "completed";

export interface Appointment {
  id: string;
  reason: string;
  provider: string;
  start: string;
  end?: string;
  status: AppointmentStatus;
}

export interface BookAppointmentInput {
  reason: string;
  provider: string;
  start: string;
}

export interface MessageThreadMessage {
  id: string;
  author: "patient" | "care-team";
  authorName?: string;
  body: string;
  sentAt: string;
}

export interface MessageThread {
  id: string;
  subject: string;
  messages: MessageThreadMessage[];
  updatedAt: string;
}

export interface SendMessageInput {
  threadId?: string;
  subject?: string;
  body: string;
}

export interface CreateShareTokenInput {
  scopes: string[];
  expiresAt: string;
}

export interface ShareTokenResponse {
  token: string;
  url: string;
  expiresAt: string;
}
