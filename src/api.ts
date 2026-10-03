import type { Conversation, KnowledgeArticle, Message, ReportOverview, SavedReply, Staff, Status } from "./data";
import { displayTime, messageTime } from "./data";

const API_ROOT = "/api/v1";
const SESSION_KEY = "safer-support-session";

type RawSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresAt?: string;
};

export type StaffSession = { session: RawSession; staff: Staff };

export type RawConversation = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  team: string;
  version: number;
  assignedStaffId: string | null;
  assigneeName: string | null;
  lastMessageAt: string;
  createdAt: string;
  preview?: string | null;
  unreadCount?: number;
  firstResponseDueAt?: string | null;
  resolutionDueAt?: string | null;
  firstResponseAt?: string | null;
  slaBreachedAt?: string | null;
  reopenedCount?: number;
  customer?: {
    id: string;
    uid: string;
    name: string;
    email?: string | null;
    avatarUrl?: string | null;
  };
};

export type RawMessage = {
  id: string;
  conversationId: string;
  sequence: number;
  kind: "customer" | "agent" | "private_note" | "system";
  body: string;
  metadata?: { attachmentIds?: string[]; financialDataMasked?: boolean };
  receipt?: { deliveredAt?: string | null; readAt?: string | null } | null;
  createdAt: string;
};

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function colorFor(value: string) {
  const colors = ["#dbeafe", "#e0e7ff", "#dcfce7", "#fef3c7", "#fce7f3"];
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

export function mapConversation(raw: RawConversation, current?: Conversation): Conversation {
  const customer = raw.customer;
  return {
    id: raw.id,
    customerId: customer?.id ?? current?.customerId ?? "",
    customerUid: customer?.uid ?? current?.customerUid ?? "",
    name: customer?.name ?? current?.name ?? "Customer",
    email: customer?.email ?? current?.email ?? "",
    avatar: customer?.avatarUrl ?? current?.avatar ?? "",
    color: current?.color ?? colorFor(customer?.uid ?? raw.id),
    subject: raw.subject ?? current?.subject ?? "Support conversation",
    preview: raw.preview ?? current?.preview ?? "No messages yet",
    time: displayTime(raw.lastMessageAt),
    lastMessageAt: raw.lastMessageAt,
    createdAt: raw.createdAt,
    version: raw.version,
    status: `${raw.status.charAt(0).toUpperCase()}${raw.status.slice(1)}` as Status,
    priority: `${raw.priority.charAt(0).toUpperCase()}${raw.priority.slice(1)}`,
    assignedStaffId: raw.assignedStaffId,
    assignee: raw.assigneeName ?? "Unassigned",
    tags: current?.tags ?? [],
    unread: raw.unreadCount ?? current?.unread ?? 0,
    messages: current?.messages ?? [],
    firstResponseDueAt: raw.firstResponseDueAt ?? null,
    resolutionDueAt: raw.resolutionDueAt ?? null,
    firstResponseAt: raw.firstResponseAt ?? null,
    slaBreachedAt: raw.slaBreachedAt ?? null,
    reopenedCount: raw.reopenedCount ?? 0,
  };
}

export function mapMessage(raw: RawMessage): Message {
  return {
    id: raw.id,
    sequence: raw.sequence,
    kind:
      raw.kind === "private_note"
        ? "note"
        : raw.kind === "system"
          ? "event"
          : raw.kind,
    text: raw.body,
    time: messageTime(raw.createdAt),
    createdAt: raw.createdAt,
    attachmentIds: raw.metadata?.attachmentIds ?? [],
    receipt: raw.receipt ?? null,
  };
}

function loadSession(): StaffSession | null {
  try {
    const value = sessionStorage.getItem(SESSION_KEY);
    return value ? (JSON.parse(value) as StaffSession) : null;
  } catch {
    return null;
  }
}

let currentSession = loadSession();
let refreshPromise: Promise<void> | null = null;

function tokenExpiresSoon(token: string) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return true;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(padded)) as { exp?: number };
    return typeof decoded.exp !== 'number' || decoded.exp * 1000 <= Date.now() + 30_000;
  } catch {
    return true;
  }
}

function saveSession(value: StaffSession | null) {
  currentSession = value;
  if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else sessionStorage.removeItem(SESSION_KEY);
}

async function parseError(response: Response) {
  const payload = await response.json().catch(() => ({}));
  const error = payload?.error;
  return new ApiError(
    response.status,
    error?.code ?? "request_failed",
    error?.message ?? "The request could not be completed",
  );
}

async function refresh() {
  if (!currentSession?.session.refreshToken) throw new ApiError(401, "signed_out", "Please sign in again");
  const response = await fetch(`${API_ROOT}/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: currentSession.session.refreshToken }),
  });
  if (!response.ok) {
    saveSession(null);
    throw await parseError(response);
  }
  const payload = await response.json();
  saveSession({ ...currentSession, session: { ...currentSession.session, ...payload.session } });
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof Blob) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (currentSession?.session.accessToken) {
    headers.set("authorization", `Bearer ${currentSession.session.accessToken}`);
  }
  const response = await fetch(`${API_ROOT}${path}`, { ...init, headers });
  if (response.status === 401 && retry && currentSession) {
    refreshPromise ??= refresh().finally(() => (refreshPromise = null));
    await refreshPromise;
    return request<T>(path, init, false);
  }
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  session: () => currentSession,
  accessToken: () => currentSession?.session.accessToken ?? "",
  async realtimeAccessToken(forceRefresh = false) {
    const token = currentSession?.session.accessToken;
    if (!token) throw new ApiError(401, "signed_out", "Please sign in again");
    if (forceRefresh || tokenExpiresSoon(token)) {
      refreshPromise ??= refresh().finally(() => (refreshPromise = null));
      await refreshPromise;
    }
    return currentSession?.session.accessToken ?? "";
  },
  async login(email: string, password: string, otp?: string) {
    const response = await fetch(`${API_ROOT}/auth/staff/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, ...(otp ? { otp } : {}) }),
    });
    if (!response.ok) throw await parseError(response);
    const value = (await response.json()) as StaffSession;
    saveSession(value);
    return value;
  },
  async logout() {
    const token = currentSession?.session.refreshToken;
    try {
      if (token) await request<void>("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken: token }) }, false);
    } finally {
      saveSession(null);
    }
  },
  async conversations() {
    const payload = await request<{ data: RawConversation[] }>("/staff/conversations?view=all&limit=100");
    return payload.data.map((item) => mapConversation(item));
  },
  async messages(id: string) {
    const payload = await request<{ data: RawMessage[] }>(`/conversations/${id}/messages?after=0&limit=100`);
    return payload.data.map(mapMessage);
  },
  async sendMessage(id: string, body: string, note: boolean, attachmentIds: string[]) {
    const payload = await request<{ message: RawMessage }>(`/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({
        clientMessageId: crypto.randomUUID(),
        body,
        visibility: note ? "private_note" : "public",
        ...(attachmentIds.length ? { attachmentIds } : {}),
      }),
    });
    return mapMessage(payload.message);
  },
  async receipt(conversationId: string, messageIds: string[], state: "delivered" | "read") {
    if (!messageIds.length) return;
    await request(`/conversations/${conversationId}/receipts`, {
      method: "POST", body: JSON.stringify({ messageIds, state }),
    });
  },
  async patchConversation(conversation: Conversation, patch: Record<string, unknown>) {
    const payload = await request<{ conversation: RawConversation }>(`/staff/conversations/${conversation.id}`, {
      method: "PATCH",
      body: JSON.stringify({ expectedVersion: conversation.version, ...patch }),
    });
    return mapConversation(payload.conversation, conversation);
  },
  async staff() {
    const payload = await request<{ data: Array<{ id: string; email: string; display_name: string; role: Staff["role"]; team: string; is_active: boolean; invitation_sent_at?: string | null; invitation_status?: Staff["invitationStatus"] }> }>("/staff/users");
    return payload.data.filter((item) => item.is_active).map((item) => ({
      id: item.id,
      email: item.email,
      name: item.display_name,
      role: item.role,
      team: item.team,
      invitationSentAt: item.invitation_sent_at ?? null,
      invitationStatus: item.invitation_status ?? null,
    }));
  },
  async createStaff(input: {
    email: string;
    name: string;
    role: Staff["role"];
    team: string;
  }) {
    const payload = await request<{ staff: { id: string; email: string; display_name: string; role: Staff["role"]; team: string; invitation_sent_at?: string | null; invitation_status?: Staff["invitationStatus"] } }>(
      "/staff/users",
      { method: "POST", body: JSON.stringify(input) },
    );
    return {
      id: payload.staff.id,
      email: payload.staff.email,
      name: payload.staff.display_name,
      role: payload.staff.role,
      team: payload.staff.team,
      invitationSentAt: payload.staff.invitation_sent_at ?? null,
      invitationStatus: payload.staff.invitation_status ?? null,
    } satisfies Staff;
  },
  async resendStaffCredentials(id: string) {
    await request(`/staff/users/${id}/resend-credentials`, { method: "POST" });
  },
  async savedReplies() {
    const payload = await request<{ data: Array<{ id: string; title: string; body: string }> }>("/staff/saved-replies");
    return payload.data.map((item) => ({ id: item.id, title: item.title, text: item.body }));
  },
  async createSavedReply(title: string, body: string): Promise<SavedReply> {
    const payload = await request<{ savedReply: { id: string; title: string; body: string } }>("/staff/saved-replies", {
      method: "POST",
      body: JSON.stringify({ title, body }),
    });
    return { id: payload.savedReply.id, title: payload.savedReply.title, text: payload.savedReply.body };
  },
  async knowledgeArticles(): Promise<KnowledgeArticle[]> {
    const payload = await request<{ data: Array<{ id: string; title: string; summary: string; body: string; category: string; is_published: boolean; updated_at: string }> }>("/staff/knowledge/articles");
    return payload.data.map((item) => ({ id: item.id, title: item.title, summary: item.summary, body: item.body, category: item.category, isPublished: item.is_published, updatedAt: item.updated_at }));
  },
  async createKnowledgeArticle(input: { title: string; summary: string; body: string; category: string; isPublished: boolean }): Promise<KnowledgeArticle> {
    const payload = await request<{ article: { id: string; title: string; summary: string; body: string; category: string; is_published: boolean; updated_at: string } }>("/staff/knowledge/articles", { method: "POST", body: JSON.stringify(input) });
    const item = payload.article;
    return { id: item.id, title: item.title, summary: item.summary, body: item.body, category: item.category, isPublished: item.is_published, updatedAt: item.updated_at };
  },
  async reports(): Promise<ReportOverview> {
    return request<ReportOverview>("/staff/operations/reports/overview?days=30");
  },
  async setAvailability(status: "available" | "busy" | "offline") {
    return request<{ status: string }>("/staff/operations/availability", { method: "PATCH", body: JSON.stringify({ status }) });
  },
  async assignmentHistory(conversationId: string) {
    const payload = await request<{ data: Array<{ id: string; reason: string; created_at: string; previous_name: string | null; new_name: string | null; changed_by_name: string | null }> }>(`/staff/conversations/${conversationId}/assignment-history`);
    return payload.data;
  },
  async initiateAttachment(conversationId: string, file: File) {
    return request<{ attachment: { id: string }; upload: { url: string; method: string; headers: Record<string, string> } }>(
      `/conversations/${conversationId}/attachments/initiate`,
      {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, contentType: file.type, byteSize: file.size }),
      },
    );
  },
  async uploadAttachment(url: string, file: File) {
    const response = await fetch(url, {
      method: "PUT",
      headers: { authorization: `Bearer ${api.accessToken()}`, "content-type": file.type },
      body: file,
    });
    if (!response.ok) throw await parseError(response);
  },
  async completeAttachment(conversationId: string, attachmentId: string) {
    await request(`/conversations/${conversationId}/attachments/${attachmentId}/complete`, { method: "POST" });
  },
  async downloadAttachment(conversationId: string, attachmentId: string) {
    const response = await fetch(
      `${API_ROOT}/conversations/${conversationId}/attachments/${attachmentId}/download`,
      { headers: { authorization: `Bearer ${api.accessToken()}` } },
    );
    if (!response.ok) throw await parseError(response);
    const disposition = response.headers.get("content-disposition") ?? "";
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    return {
      blob: await response.blob(),
      fileName: encodedName ? decodeURIComponent(encodedName) : "attachment",
    };
  },
};
