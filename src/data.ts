export type Status = "Open" | "Waiting" | "Snoozed" | "Resolved";

export type Message = {
  id: string;
  sequence: number;
  kind: "customer" | "agent" | "note" | "event";
  text: string;
  time: string;
  createdAt: string;
  attachmentIds: string[];
  receipt?: { deliveredAt?: string | null; readAt?: string | null } | null;
};

export type Conversation = {
  id: string;
  customerId: string;
  customerUid: string;
  name: string;
  email: string;
  avatar: string;
  color: string;
  subject: string;
  preview: string;
  time: string;
  lastMessageAt: string;
  createdAt: string;
  version: number;
  status: Status;
  priority: string;
  assignedStaffId: string | null;
  assignee: string;
  tags: string[];
  unread: number;
  messages: Message[];
  firstResponseDueAt?: string | null;
  resolutionDueAt?: string | null;
  firstResponseAt?: string | null;
  slaBreachedAt?: string | null;
  reopenedCount: number;
};

export type Staff = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "supervisor" | "agent";
  team: string;
  invitationSentAt?: string | null;
  invitationStatus?: "queued" | "sent" | "failed" | null;
};

export type SavedReply = { id: string; title: string; text: string };
export type KnowledgeArticle = { id: string; title: string; summary: string; body: string; category: string; isPublished: boolean; updatedAt: string };
export type ReportOverview = {
  summary: { total: number; open: number; resolved: number; unassigned: number; sla_breached: number; avg_first_response_minutes: number; avg_resolution_minutes: number; csat: string; feedback_count: number };
  queueAge: { average_minutes: number; oldest_minutes: number };
  agents: Array<{ id: string; display_name: string; availability_status: string; assigned: number; resolved: number; csat: string }>;
  daily: Array<{ day: string; created: number; resolved: number }>;
};

export const avatarUrl = (value: string) =>
  /^https:\/\//i.test(value) ? value : "";

export function displayTime(value: string) {
  const date = new Date(value);
  const elapsed = Date.now() - date.getTime();
  if (elapsed < 60_000) return "Now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function messageTime(value: string) {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
