import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  CircleCheck,
  Eye,
  EyeOff,
  Clock3,
  FileText,
  Fingerprint,
  Inbox,
  Layers,
  List,
  Lock,
  LockKeyhole,
  LogOut,
  Mail,
  MessageCircle,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  ScrollText,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { api, ApiError, mapConversation, mapMessage, type RawConversation, type RawMessage, type StaffSession } from "./api";
import { avatarUrl, type Conversation, type SavedReply, type Staff, type Status } from "./data";

const pages = [
  { name: "Inbox", icon: Inbox },
  { name: "Customers", icon: Users },
  { name: "Reports", icon: BarChart3 },
  { name: "Knowledge base", icon: BookOpen },
  { name: "Team", icon: Users },
];

const pageSubtitles: Record<string, string> = {
  Inbox: "Good conversations start here.",
  Customers: "Verified customers from your primary app.",
  Reports: "A current view of the support workload.",
  "Knowledge base": "Your team’s shared saved replies.",
  Team: "Manage access to your support workspace.",
};

function Avatar({ person, size = 38 }: { person: { name: string; avatar: string; color: string }; size?: number }) {
  const url = avatarUrl(person.avatar);
  return (
    <span className="avatar" style={{ width: size, height: size, background: person.color }}>
      {url && <img src={url} alt="" onError={(event) => (event.currentTarget.style.display = "none")} />}
      <span>{person.name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>
    </span>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function Login({ onLogin }: { onLogin: (session: StaffSession) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [needsOtp, setNeedsOtp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(await api.login(email.trim(), password, otp.trim() || undefined));
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "mfa_required") setNeedsOtp(true);
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <div className="login-topline">
          <div className="login-brand"><img src="/safer-logo.png" alt="Safer Logo" /><strong>SAFER</strong></div>
          <span className="login-status"><i />Staff only</span>
        </div>
        <div className="login-brand-copy">
          <h1>Customer support,<span>under control.</span></h1>
          <p>Authorized Safer support staff only. Conversations come from verified customers and update in real time.</p>
        </div>
        <div className="login-highlights">
          <div><Fingerprint size={22} /><strong>Secure sessions</strong><span>Short-lived, MFA ready</span></div>
          <div><ShieldCheck size={22} /><strong>Verified customers</strong><span>From the Safer app</span></div>
          <div><ScrollText size={22} /><strong>Live inbox</strong><span>Real-time updates</span></div>
        </div>
      </section>
      <section className="login-form-panel">
        <div className="login-form-wrap">
          <div className="login-brand login-mobile-brand"><img src="/safer-logo.png" alt="Safer Logo" /><strong>SAFER</strong></div>
          <span className="login-eyebrow">Support console</span>
          <h2>Sign in</h2>
          <p>Use your Safer support credentials to continue.</p>
          <form onSubmit={submit} className="login-form">
            <label className="login-field">Email address
              <div className="login-input"><Mail size={20} /><input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@saference.com" /></div>
            </label>
            <label className="login-field">Password
              <div className="login-input"><Lock size={20} /><input type={showPassword ? "text" : "password"} autoComplete="current-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••••" /><button type="button" className="login-reveal" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button></div>
            </label>
            {needsOtp && <label className="login-field">Authenticator code
              <div className="login-input"><ShieldCheck size={20} /><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={otp} onChange={(event) => setOtp(event.target.value)} placeholder="000000" /></div>
            </label>}
            {error && <div className="login-error" role="alert">{error}</div>}
            <button className="login-submit" disabled={busy}><span>{busy ? "Signing in…" : "Continue securely"}</span><i><ArrowRight size={20} /></i></button>
          </form>
          <div className="login-footer"><span>Need access? Ask an administrator.</span><span><ShieldCheck size={16} />Secure session</span></div>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState<StaffSession | null>(() => api.session());
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [replies, setReplies] = useState<SavedReply[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [page, setPage] = useState("Inbox");
  const [queue, setQueue] = useState("All conversations");
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState("");
  const [navOpen, setNavOpen] = useState(true);
  const [listOpen, setListOpen] = useState(true);
  const [detailOpen, setDetailOpen] = useState(() => window.innerWidth > 1100);
  const [replyMenu, setReplyMenu] = useState(false);
  const [replyForm, setReplyForm] = useState(false);
  const [replyTitle, setReplyTitle] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentEmail, setAgentEmail] = useState("");
  const [agentRole, setAgentRole] = useState<Staff["role"]>("agent");
  const [invitationSentTo, setInvitationSentTo] = useState("");
  const [creatingAgent, setCreatingAgent] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const joinedRef = useRef("");
  const selectedIdRef = useRef("");
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const selected = conversations.find((item) => item.id === selectedId);
  selectedIdRef.current = selectedId;
  const me = useMemo(() => ({ name: session?.staff.name ?? "Staff", avatar: "", color: "#dbeafe" }), [session]);

  const notify = useCallback((message: string) => setToast(message), []);

  const loadWorkspace = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [conversationResult, replyResult, staffResult] = await Promise.allSettled([
        api.conversations(),
        api.savedReplies(),
        api.staff(),
      ]);
      if (conversationResult.status === "rejected") throw conversationResult.reason;
      setConversations((current) => conversationResult.value.map((next) => {
        const existing = current.find((item) => item.id === next.id);
        return existing ? { ...next, messages: existing.messages } : next;
      }));
      setSelectedId((current) => current && conversationResult.value.some((item) => item.id === current) ? current : conversationResult.value[0]?.id ?? "");
      setReplies(replyResult.status === "fulfilled" ? replyResult.value : []);
      setStaff(staffResult.status === "fulfilled" ? staffResult.value : session ? [session.staff] : []);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setSession(null);
      else notify(errorMessage(error));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [notify, session]);

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const messages = await api.messages(conversationId);
      setConversations((items) => items.map((item) => item.id === conversationId ? { ...item, messages } : item));
    } catch (error) {
      notify(errorMessage(error));
    }
  }, [notify]);

  useEffect(() => {
    if (session) void loadWorkspace();
  }, [session, loadWorkspace]);

  useEffect(() => {
    if (!session) return;
    let disposed = false;
    let socket: Socket | null = null;
    let refreshingSocketToken = false;
    let recovering = false;
    const reload = () => void loadWorkspace(true);
    const onMessage = (raw: RawMessage) => {
      const message = mapMessage(raw);
      setConversations((items) => items.map((item) => {
        if (item.id !== raw.conversationId || item.messages.some((entry) => entry.id === message.id)) return item;
        return { ...item, messages: [...item.messages, message], preview: message.kind === "note" ? item.preview : message.text || "Attachment", time: "Now" };
      }));
    };
    const onConversationUpdate = (raw: RawConversation) => setConversations((items) => items.map((item) => item.id === raw.id ? mapConversation(raw, item) : item));
    const joinSelected = () => {
      const conversationId = selectedIdRef.current;
      if (!socket?.connected || !conversationId) return;
      if (joinedRef.current && joinedRef.current !== conversationId) {
        socket.emit("conversation:leave", joinedRef.current);
      }
      socket.emit("conversation:join", conversationId, (result: { ok?: boolean }) => {
        if (!result?.ok || disposed || selectedIdRef.current !== conversationId) return;
        joinedRef.current = conversationId;
        void loadMessages(conversationId);
      });
    };
    const start = async () => {
      try {
        const token = await api.realtimeAccessToken();
        if (disposed) return;
        socket = io({
          path: "/socket.io",
          auth: { token },
          autoConnect: false,
          reconnection: true,
        });
        socketRef.current = socket;
        socket.on("connect", () => {
          refreshingSocketToken = false;
          joinedRef.current = "";
          joinSelected();
          void loadWorkspace(true);
        });
        socket.on("disconnect", () => {
          joinedRef.current = "";
        });
        socket.on("conversation:created", reload);
        socket.on("message:created", onMessage);
        socket.on("message:private-note", onMessage);
        socket.on("conversation:updated", onConversationUpdate);
        socket.on("connect_error", async (error) => {
          if (disposed || refreshingSocketToken) return;
          if (error.message === "unauthorized") {
            refreshingSocketToken = true;
            try {
              const refreshedToken = await api.realtimeAccessToken(true);
              if (disposed || !socket) return;
              socket.auth = { token: refreshedToken };
              socket.connect();
            } catch (refreshError) {
              if (!disposed) notify(errorMessage(refreshError));
            } finally {
              refreshingSocketToken = false;
            }
            return;
          }
          notify("Realtime connection interrupted. Reconnecting…");
        });
        socket.connect();
      } catch (error) {
        if (!disposed) notify(errorMessage(error));
      }
    };
    const recover = async () => {
      if (disposed || recovering || document.visibilityState === "hidden") return;
      recovering = true;
      try {
        const token = await api.realtimeAccessToken();
        if (disposed || !socket) return;
        socket.auth = { token };
        if (socket.connected) joinSelected();
        else socket.connect();
        const conversationId = selectedIdRef.current;
        await Promise.allSettled([
          loadWorkspace(true),
          conversationId ? loadMessages(conversationId) : Promise.resolve(),
        ]);
      } catch (error) {
        if (!disposed) notify(errorMessage(error));
      } finally {
        recovering = false;
      }
    };
    const recoverWhenVisible = () => {
      if (document.visibilityState === "visible") void recover();
    };
    const reconcileTimer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const conversationId = selectedIdRef.current;
      if (!socket?.connected) {
        void recover();
      } else if (conversationId) {
        void loadMessages(conversationId);
      }
    }, 15_000);
    window.addEventListener("focus", recoverWhenVisible);
    window.addEventListener("online", recoverWhenVisible);
    document.addEventListener("visibilitychange", recoverWhenVisible);
    void start();
    return () => {
      disposed = true;
      window.clearInterval(reconcileTimer);
      window.removeEventListener("focus", recoverWhenVisible);
      window.removeEventListener("online", recoverWhenVisible);
      document.removeEventListener("visibilitychange", recoverWhenVisible);
      socket?.removeAllListeners();
      socket?.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
      joinedRef.current = "";
    };
  }, [session, loadWorkspace, loadMessages, notify]);

  useEffect(() => {
    if (!selectedId) return;
    const socket = socketRef.current;
    if (socket?.connected) {
      if (joinedRef.current && joinedRef.current !== selectedId) {
        socket.emit("conversation:leave", joinedRef.current);
      }
      socket.emit("conversation:join", selectedId, (result: { ok?: boolean }) => {
        if (result?.ok && selectedIdRef.current === selectedId) {
          joinedRef.current = selectedId;
        }
      });
    }
    void loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [selectedId, selected?.messages.length]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function patchSelected(patch: Record<string, unknown>, success: string) {
    if (!selected) return;
    try {
      const updated = await api.patchConversation(selected, patch);
      setConversations((items) => items.map((item) => item.id === selected.id ? updated : item));
      notify(success);
    } catch (error) {
      notify(errorMessage(error));
      if (error instanceof ApiError && error.code === "version_conflict") void loadWorkspace();
    }
  }

  function waitForAttachment(id: string) {
    return new Promise<void>((resolve, reject) => {
      const socket = socketRef.current;
      if (!socket) return reject(new Error("Realtime connection is required to scan this file"));
      const timeout = window.setTimeout(() => {
        socket.off("attachment:available", listener);
        reject(new Error("The file scan is taking longer than expected. Please try again."));
      }, 60_000);
      const listener = (payload: { id?: string }) => {
        if (payload.id !== id) return;
        window.clearTimeout(timeout);
        socket.off("attachment:available", listener);
        resolve();
      };
      socket.on("attachment:available", listener);
    });
  }

  async function sendMessage() {
    if (!selected || (!draft.trim() && !attachment) || sending) return;
    setSending(true);
    try {
      const attachmentIds: string[] = [];
      if (attachment) {
        const initiated = await api.initiateAttachment(selected.id, attachment);
        await api.uploadAttachment(initiated.upload.url, attachment);
        const available = waitForAttachment(initiated.attachment.id);
        await api.completeAttachment(selected.id, initiated.attachment.id);
        notify("Scanning attachment securely…");
        await available;
        attachmentIds.push(initiated.attachment.id);
      }
      const message = await api.sendMessage(selected.id, draft.trim(), note, attachmentIds);
      setConversations((items) => items.map((item) => item.id === selected.id && !item.messages.some((entry) => entry.id === message.id)
        ? { ...item, messages: [...item.messages, message], preview: note ? item.preview : message.text || attachment?.name || "Attachment", time: "Now", version: item.version + 1 }
        : item));
      setDraft("");
      setAttachment(null);
      setReplyMenu(false);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setSending(false);
    }
  }

  async function saveReply(event: React.FormEvent) {
    event.preventDefault();
    try {
      const created = await api.createSavedReply(replyTitle.trim(), replyBody.trim());
      setReplies((items) => [...items, created]);
      setReplyTitle("");
      setReplyBody("");
      setReplyForm(false);
      notify("Saved reply added");
    } catch (error) {
      notify(errorMessage(error));
    }
  }

  async function createAgent(event: React.FormEvent) {
    event.preventDefault();
    if (!session || session.staff.role !== "admin") return;
    setCreatingAgent(true);
    try {
      const created = await api.createStaff({
        email: agentEmail.trim(),
        name: agentName.trim(),
        role: agentRole,
        team: session.staff.team,
      });
      setStaff((items) => [...items, created].sort((a, b) => a.name.localeCompare(b.name)));
      setInvitationSentTo(created.email);
      setAgentName("");
      setAgentEmail("");
      setAgentRole("agent");
      notify("Account created and credentials queued");
      window.setTimeout(() => void api.staff().then(setStaff).catch(() => undefined), 3_000);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setCreatingAgent(false);
    }
  }

  async function resendCredentials(person: Staff) {
    try {
      await api.resendStaffCredentials(person.id);
      setStaff((items) => items.map((item) => item.id === person.id ? { ...item, invitationStatus: "queued", invitationSentAt: null } : item));
      setInvitationSentTo(person.email);
      notify("New login credentials queued");
      window.setTimeout(() => void api.staff().then(setStaff).catch(() => undefined), 3_000);
    } catch (error) {
      notify(errorMessage(error));
    }
  }

  async function downloadAttachment(conversationId: string, attachmentId: string) {
    try {
      const { blob, fileName } = await api.downloadAttachment(conversationId, attachmentId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      notify(errorMessage(error));
    }
  }

  async function logout() {
    await api.logout();
    socketRef.current?.disconnect();
    setSession(null);
    setConversations([]);
  }

  if (!session) return <Login onLogin={setSession} />;

  const counts = {
    all: conversations.length,
    unassigned: conversations.filter((item) => !item.assignedStaffId && item.status !== "Resolved").length,
    mine: conversations.filter((item) => item.assignedStaffId === session.staff.id && item.status !== "Resolved").length,
    team: conversations.filter((item) => item.assignedStaffId && item.assignedStaffId !== session.staff.id && item.status !== "Resolved").length,
  };
  const queued = conversations.filter((item) =>
    queue === "All conversations" ||
    (queue === "Unassigned" && !item.assignedStaffId) ||
    (queue === "Assigned to me" && item.assignedStaffId === session.staff.id) ||
    (queue === "Team inbox" && item.assignedStaffId && item.assignedStaffId !== session.staff.id),
  );
  const filtered = queued.filter((item) =>
    (filter === "All" || (filter === "Open" && item.status === "Open") || (filter === "Resolved" && item.status === "Resolved")) &&
    `${item.name} ${item.email} ${item.subject} ${item.preview}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="app-shell">
      <aside id="navigation-sidebar" className={`sidebar ${navOpen ? "" : "panel-hidden"}`}>
        <button className="sidebar-close" aria-label="Close navigation" onClick={() => setNavOpen(false)}><X size={16} /></button>
        <button className="brand" onClick={() => setPage("Inbox")}><span className="brand-icon"><img src="/safer-logo.png" alt="" /></span><span>safer<span className="brand-dot">.</span><small>SUPPORT</small></span></button>
        <div className="workspace-switch"><span className="workspace-letter">S</span><span>Safer workspace<small>{session.staff.team}</small></span><ShieldCheck size={15} /></div>
        <div className="nav-label">WORKSPACE</div>
        <nav>{pages.map((item) => <button key={item.name} className={`nav-item ${page === item.name ? "active" : ""}`} onClick={() => { setPage(item.name); setSearch(""); }}><item.icon size={18} /><span>{item.name}</span>{item.name === "Inbox" && <span className="nav-badge">{counts.all}</span>}</button>)}</nav>
        <div className="nav-label queue-label">YOUR INBOXES</div>
        <div className="queues">{[
          { name: "All conversations", icon: Layers, count: counts.all },
          { name: "Unassigned", icon: Inbox, count: counts.unassigned },
          { name: "Assigned to me", icon: MessageCircle, count: counts.mine },
          { name: "Team inbox", icon: Users, count: counts.team },
        ].map((item) => <button className={`queue ${queue === item.name && page === "Inbox" ? "selected" : ""}`} key={item.name} onClick={() => { setQueue(item.name); setPage("Inbox"); setFilter("All"); }}><item.icon size={16} /><span>{item.name}</span><span className="queue-count">{item.count}</span></button>)}</div>
        <div className="sidebar-bottom">
          <div className="team-card"><div className="team-card-top"><span className="online-dot" />Connected to live support</div><p>Messages and assignments update in real time.</p></div>
          <div className="profile"><Avatar person={me} size={34} /><span>{session.staff.name}<small><i className="online-dot" />{session.staff.role}</small></span><button aria-label="Sign out" onClick={() => void logout()}><LogOut size={17} /></button></div>
        </div>
      </aside>
      <main className="main-workspace">
        <header className="topbar">
          <div className="topbar-leading"><div className="panel-controls"><button className="icon-button" aria-label="Toggle navigation" onClick={() => setNavOpen(!navOpen)}>{navOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</button>{page === "Inbox" && <><button className="icon-button" aria-label="Toggle conversation list" onClick={() => setListOpen(!listOpen)}><List size={18} /></button><button className="icon-button" aria-label="Toggle customer details" onClick={() => setDetailOpen(!detailOpen)}>{detailOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button></>}</div><div className="page-title"><h1>{page}</h1><p>{pageSubtitles[page]}</p></div></div>
          <div className="top-actions"><span className="live-label"><span className="online-dot" />Live</span><button className="global-search" onClick={() => { setPage("Inbox"); setListOpen(true); setTimeout(() => searchRef.current?.focus(), 0); }}><Search size={16} /><span>Search conversations</span><kbd>⌘ K</kbd></button>{page === "Knowledge base" && <button className="primary-button" onClick={() => setReplyForm(true)}><Plus size={16} />New saved reply</button>}<Avatar person={me} size={32} /></div>
        </header>
        {page === "Inbox" ? (
          <div className="inbox-layout">
            <section id="conversation-sidebar" className={`conversation-panel ${listOpen ? "" : "panel-hidden"}`}>
              <div className="list-heading"><h2>{queue} <span>{filtered.length}</span></h2><button className="icon-button list-close" aria-label="Close conversation list" onClick={() => setListOpen(false)}><X size={15} /></button></div>
              <div className="list-search"><Search size={16} /><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" /></div>
              <div className="list-tabs">{["All", "Open", "Resolved"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div>
              <div className="list-subtitle"><span>{filtered.length} conversations</span><span>Newest first <ChevronDown size={12} /></span></div>
              <div className="conversation-list">
                {filtered.map((item) => <button className={`conversation-row ${item.id === selectedId ? "active" : ""}`} key={item.id} onClick={() => { setSelectedId(item.id); setDraft(""); setAttachment(null); }}><div className="conversation-top"><Avatar person={item} /><div><strong>{item.name}</strong><span className="conversation-subject">{item.subject}</span></div><time>{item.time}</time></div><p>{item.preview}</p><div className="conversation-bottom"><span className={`tag-chip ${item.priority === "High" || item.priority === "Urgent" ? "amber" : ""}`}>{item.priority}</span><span className="row-status"><span className="status-dot" />{item.status}</span></div></button>)}
                {!loading && !filtered.length && <div className="empty-list"><Inbox size={30} /><h3>No conversations yet</h3><p>New conversations created by verified customers in the primary app will appear here.</p></div>}
                {loading && <div className="empty-list"><p>Loading live conversations…</p></div>}
              </div>
              <div className="list-footer"><ShieldCheck size={14} />Live data from Safer Support API</div>
            </section>
            {selected ? <>
              <section className="thread-panel">
                <div className="thread-header"><Avatar person={selected} size={40} /><div className="thread-title"><h2>{selected.name}<span className="verified"><Check size={9} /></span></h2><span>Conversation #{selected.id.slice(-5)} <span>·</span> Safer app</span></div><div className="thread-actions"><button className="icon-button" aria-label="Snooze conversation" onClick={() => void patchSelected({ status: selected.status === "Snoozed" ? "open" : "snoozed" }, selected.status === "Snoozed" ? "Conversation reopened" : "Conversation snoozed")}><Clock3 size={18} /></button><button className={`resolve-button ${selected.status === "Resolved" ? "resolved" : ""}`} onClick={() => void patchSelected({ status: selected.status === "Resolved" ? "open" : "resolved" }, selected.status === "Resolved" ? "Conversation reopened" : "Conversation resolved")}><Check size={15} /><span>{selected.status === "Resolved" ? "Reopen" : "Resolve"}</span></button></div></div>
                <div className="thread-subject"><span className="subject-icon"><MessageCircle size={14} /></span><strong>{selected.subject}</strong><span className={`status-pill ${selected.status.toLowerCase()}`}><i />{selected.status}</span></div>
                <div className="message-area" ref={threadRef}>
                  <div className="date-divider"><span />{new Date(selected.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}<span /></div>
                  <div className="security-notice"><ShieldCheck size={14} />Verified customer identity supplied by the primary app.</div>
                  {selected.messages.map((message) => message.kind === "event" ? <div className="event-message" key={message.id}><span><ArrowDownLeft size={12} /></span>{message.text}<time>{message.time}</time></div> : <div key={message.id} className={`message-row ${message.kind}`}>
                    {message.kind === "customer" && <Avatar person={selected} size={28} />}
                    <div className="message-content"><div className="message-author">{message.kind === "customer" ? selected.name.split(" ")[0] : message.kind === "note" ? <><LockKeyhole size={10} />Private note · {session.staff.name.split(" ")[0]}</> : "You"}<time>{message.time}</time></div><div className="message-bubble">{message.text && <p>{message.text}</p>}{message.attachmentIds.map((id) => <button className="attachment-preview" onClick={() => void downloadAttachment(selected.id, id)} key={id}><span className="pdf-icon"><FileText size={20} /></span><span><strong>Secure attachment</strong><small>Malware scanned</small></span></button>)}</div>{message.kind === "agent" && <div className="message-delivered"><CheckCheck size={12} />Delivered</div>}</div>
                    {message.kind === "agent" && <Avatar person={me} size={28} />}
                  </div>)}
                  {!selected.messages.length && <div className="empty-thread-messages">No messages in this conversation.</div>}
                  <div className="thread-spacer" />
                </div>
                <div className="composer-wrapper"><div className={`composer ${note ? "note-composer" : ""}`}><div className="composer-top"><button className={!note ? "chosen" : ""} onClick={() => setNote(false)}>Reply</button><button className={note ? "chosen" : ""} onClick={() => setNote(true)}>Private note</button><span>{note ? "Visible only to staff" : `To: ${selected.name.split(" ")[0]}`}</span></div><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={note ? "Leave a private note…" : "Write a reply…"} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} />{attachment && <div className="attached-file"><Paperclip size={14} />{attachment.name}<button onClick={() => setAttachment(null)}><X size={13} /></button></div>}<div className="composer-tools"><div><input ref={fileRef} type="file" accept="image/png,image/jpeg,application/pdf,text/plain" hidden onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} /><button className="icon-button" aria-label="Add attachment" onClick={() => fileRef.current?.click()}><Paperclip size={18} /></button><div className="menu-container"><button className="saved-replies-button" onClick={() => setReplyMenu(!replyMenu)}><BookOpen size={16} />Saved replies<ChevronDown size={13} /></button>{replyMenu && <div className="popover reply-popover">{replies.length ? replies.map((reply) => <button key={reply.id} onClick={() => { setDraft(reply.text); setReplyMenu(false); }}><strong>{reply.title}</strong><span>{reply.text}</span></button>) : <p>No saved replies yet.</p>}</div>}</div></div><button className="send-button" disabled={sending || (!draft.trim() && !attachment)} onClick={() => void sendMessage()}>{sending ? "Sending…" : "Send"}<ArrowRight size={16} /></button></div></div></div>
              </section>
              <aside id="customer-sidebar" className={`customer-panel ${detailOpen ? "" : "panel-hidden"}`}><div className="customer-panel-title"><h3>Customer details</h3><button className="icon-button" onClick={() => setDetailOpen(false)}><X size={15} /></button></div><div className="customer-profile"><Avatar person={selected} size={66} /><h2>{selected.name}<span className="verified"><Check size={9} /></span></h2><p>{selected.email || "No email shared"}</p></div><div className="details-section"><h4>Conversation details</h4><div className="detail-row"><span>Assignee</span><select value={selected.assignedStaffId ?? ""} onChange={(event) => void patchSelected({ assignedStaffId: event.target.value || null }, "Assignee updated")}><option value="">Unassigned</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.id === session.staff.id ? "You" : person.name}</option>)}</select></div><div className="detail-row"><span>Priority</span><select value={selected.priority.toLowerCase()} onChange={(event) => void patchSelected({ priority: event.target.value }, "Priority updated")}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div><div className="detail-row"><span>Status</span><select value={selected.status.toLowerCase()} onChange={(event) => void patchSelected({ status: event.target.value }, "Status updated")}><option value="open">Open</option><option value="waiting">Waiting</option><option value="snoozed">Snoozed</option><option value="resolved">Resolved</option></select></div></div><div className="details-section"><h4>Primary app identity</h4><div className="identity-value"><strong>Customer UID</strong><code>{selected.customerUid}</code></div><div className="identity-value"><strong>Internal customer ID</strong><code>{selected.customerId}</code></div></div><div className="details-footer"><ShieldCheck size={14} />Only verified support profile data is shared.</div></aside>
            </> : <section className="thread-panel empty-workspace"><ShieldCheck size={42} /><h2>Your live inbox is ready</h2><p>When a verified customer starts a conversation from the primary app, it will appear here instantly.</p></section>}
          </div>
        ) : (
          <div className="alternate-page">
            {page === "Customers" && <><div className="section-toolbar"><h2>Verified customers <span>{conversations.length}</span></h2><div className="list-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customers" /></div></div><div className="table-wrapper"><table><thead><tr><th>Customer</th><th>Email address</th><th>Latest conversation</th><th>Status</th><th /></tr></thead><tbody>{conversations.filter((item) => `${item.name} ${item.email}`.toLowerCase().includes(search.toLowerCase())).map((item) => <tr key={item.id}><td><Avatar person={item} size={34} /><strong>{item.name}</strong></td><td>{item.email || "—"}</td><td>{item.subject}</td><td><span className={`status-pill ${item.status.toLowerCase()}`}><i />{item.status}</span></td><td><button className="icon-button" onClick={() => { setSelectedId(item.id); setPage("Inbox"); }}><ArrowUpRight size={17} /></button></td></tr>)}</tbody></table>{!conversations.length && <div className="empty-list"><Users size={30} /><h3>No customers yet</h3><p>Customers appear after the primary app creates their first support conversation.</p></div>}</div></>}
            {page === "Reports" && <><div className="section-toolbar"><h2>Workspace overview</h2><span className="report-period"><Clock3 size={14} />Live data</span></div><div className="report-cards">{[
              { name: "Total conversations", value: conversations.length, icon: MessageCircle },
              { name: "Open conversations", value: conversations.filter((item) => item.status === "Open").length, icon: Inbox },
              { name: "Resolved conversations", value: conversations.filter((item) => item.status === "Resolved").length, icon: CircleCheck },
              { name: "Unassigned", value: counts.unassigned, icon: Users },
            ].map((item) => <div className="report-card" key={item.name}><item.icon size={19} /><span>{item.name}</span><strong>{item.value}</strong><small>Current server data</small></div>)}</div><div className="report-chart"><h2>Conversations by agent</h2><p>Current distribution across active team members.</p>{[...staff, { id: "", name: "Unassigned", email: "", role: "agent" as const, team: session.staff.team }].map((person) => { const count = conversations.filter((item) => person.id ? item.assignedStaffId === person.id : !item.assignedStaffId).length; return <div className="bar-row" key={person.id || "unassigned"}><span>{person.id === session.staff.id ? "You" : person.name}</span><div><i style={{ width: `${conversations.length ? Math.max((count / conversations.length) * 100, 2) : 0}%` }} /></div><strong>{count}</strong></div>; })}</div></>}
            {page === "Knowledge base" && <><div className="knowledge-intro"><span className="knowledge-icon"><BookOpen size={26} /></span><h2>Reusable answers for your team.</h2><p>Saved replies are stored in the support API and shared with your team.</p></div><div className="knowledge-grid">{replies.map((reply) => <button className="knowledge-card" key={reply.id} onClick={() => { setDraft(reply.text); setSelectedId(conversations[0]?.id ?? ""); setPage("Inbox"); }}><span><FileText size={21} /><ArrowUpRight size={17} /></span><h3>{reply.title}</h3><p>{reply.text}</p><small>Saved reply <i>·</i> {session.staff.team}</small></button>)}</div>{!replies.length && <div className="empty-list"><BookOpen size={30} /><h3>No saved replies yet</h3><p>Create the first answer for your support team.</p></div>}</>}
            {page === "Team" && <div className="team-layout">
              <section className="team-list-card"><div className="section-toolbar"><h2>Team members <span>{staff.length}</span></h2><span className="report-period"><ShieldCheck size={14} />{session.staff.team}</span></div><div className="team-member-list">{staff.map((person) => <div className="team-member" key={person.id}><Avatar person={{ name: person.name, avatar: "", color: "#dbeafe" }} size={38} /><span><strong>{person.name}{person.id === session.staff.id ? " (You)" : ""}</strong><small>{person.email}{person.invitationStatus === "queued" ? " · Credentials queued" : person.invitationStatus === "failed" ? " · Delivery failed" : person.invitationSentAt ? ` · Credentials sent ${new Date(person.invitationSentAt).toLocaleDateString()}` : ""}</small></span><span className="tag-chip">{person.role}</span>{session.staff.role === "admin" && person.id !== session.staff.id && <button className="resend-button" onClick={() => void resendCredentials(person)}>Resend login</button>}</div>)}</div></section>
              <section className="team-form-card"><span className="modal-symbol"><UserPlus size={24} /></span><h2>Add a team member</h2>{session.staff.role === "admin" ? <><p>Cloudflare will email the new team member a secure initial password and the Safer Support login link.</p><form onSubmit={(event) => void createAgent(event)}><label>Full name<input required minLength={2} value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder="e.g. Sarah Miller" /></label><label>Email address<input required type="email" value={agentEmail} onChange={(event) => setAgentEmail(event.target.value)} placeholder="agent@saference.com" /></label><label>Role<select value={agentRole} onChange={(event) => setAgentRole(event.target.value as Staff["role"])}><option value="agent">Agent</option><option value="supervisor">Supervisor</option><option value="admin">Administrator</option></select></label><button className="primary-button full-width" disabled={creatingAgent}>{creatingAgent ? "Creating and emailing…" : "Create account & send email"}<ArrowRight size={16} /></button></form></> : <div className="info-box"><LockKeyhole size={18} /><p>Only administrators can add staff accounts. Ask an administrator to create the account for you.</p></div>}</section>
              {invitationSentTo && <section className="credentials-card"><div><ShieldCheck size={22} /><span><strong>Credentials email queued</strong><small>The encrypted login email for {invitationSentTo} is in the durable delivery queue. The password was generated on the server and was not exposed in this dashboard.</small></span></div><button className="icon-button" aria-label="Dismiss message" onClick={() => setInvitationSentTo("")}><X size={16} /></button></section>}
            </div>}
          </div>
        )}
      </main>
      {toast && <div className="toast" role="status"><CircleCheck size={17} />{toast}<button onClick={() => setToast("")}><X size={14} /></button></div>}
      {replyForm && <div className="modal-overlay" onClick={() => setReplyForm(false)}><section className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><button className="modal-close icon-button" onClick={() => setReplyForm(false)}><X size={20} /></button><span className="modal-symbol"><BookOpen size={24} /></span><h2>New saved reply</h2><p>Create a reusable answer for the support team.</p><form onSubmit={(event) => void saveReply(event)}><label>Title<input required minLength={2} value={replyTitle} onChange={(event) => setReplyTitle(event.target.value)} /></label><label>Reply text<textarea required value={replyBody} onChange={(event) => setReplyBody(event.target.value)} /></label><button className="primary-button full-width">Save reply <Check size={16} /></button></form></section></div>}
    </div>
  );
}
