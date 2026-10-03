export type Status = "Open" | "Waiting" | "Snoozed" | "Resolved";

export type Message = {
  id: string;
  sequence: number;
  kind: "customer" | "agent" | "note" | "event";
  text: string;
  time: string;
  createdAt: string;
  attachmentIds: string[];
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
