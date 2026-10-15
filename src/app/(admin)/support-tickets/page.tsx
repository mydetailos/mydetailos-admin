"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  FileText,
  LifeBuoy,
  Mic,
  MicOff,
  Paperclip,
  Search,
  Send,
  Smile,
  X,
} from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { ErrorBanner } from "@/components/shared/error-banner";
import { RefreshingBar } from "@/components/shared/loading";
import { FilterSelect } from "@/components/shared/filter-bar";
import { EmojiPicker } from "@/components/support/emoji-picker";
import {
  getPlatformSupportTicket,
  listPlatformSupportTickets,
  patchPlatformSupportTicket,
  replyPlatformSupportTicket,
  type PlatformSupportTicket,
  type PlatformSupportTicketAttachment,
  type PlatformSupportTicketListItem,
  type PlatformSupportTicketStatus,
} from "@/api/platform";
import {
  isSupportTicketUnread,
  useSupportTicketsStore,
} from "@/store/support-tickets-store";
import { formatDateTime } from "@/lib/utils";

const MAX_ATTACHMENT_BYTES = 1_500_000;

const STATUS_OPTIONS = [
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "WAITING_ON_CUSTOMER", label: "Waiting" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
];

type ChatFilter = "ALL" | "UNREAD" | "OPEN" | "RESOLVED";

function initials(name: string | null | undefined): string {
  const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function chatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
  }).format(d);
}

function dayDividerLabel(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayMs = 86_400_000;
  if (startMsg === startToday) return "Today";
  if (startMsg === startToday - dayMs) return "Yesterday";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

function dayKey(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function avatarColor(seed: string): string {
  const colors = ["#50B0A0", "#0d9488", "#0891b2", "#2563eb", "#7c3aed", "#db2777", "#ea580c"];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return colors[hash % colors.length]!;
}

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read recording"));
    reader.readAsDataURL(blob);
  });
}

export default function SupportTicketsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ticketFromUrl = searchParams.get("ticket");
  const refreshNotify = useSupportTicketsStore((s) => s.refresh);
  const markTicketSeen = useSupportTicketsStore((s) => s.markTicketSeen);
  const seenKeys = useSupportTicketsStore((s) => s.seenKeys);
  const unreadCount = useSupportTicketsStore((s) => s.unreadCount);

  const [tickets, setTickets] = useState<PlatformSupportTicketListItem[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [chatFilter, setChatFilter] = useState<ChatFilter>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlatformSupportTicket | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PlatformSupportTicketAttachment[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const emojiWrapRef = useRef<HTMLDivElement>(null);

  const selectedListItem = useMemo(
    () => tickets.find((t) => t.id === selectedId) ?? null,
    [tickets, selectedId]
  );

  const selectTicket = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      const params = new URLSearchParams(searchParams.toString());
      if (id) params.set("ticket", id);
      else params.delete("ticket");
      const q = params.toString();
      router.replace(q ? `/support-tickets?${q}` : "/support-tickets", { scroll: false });
    },
    [router, searchParams]
  );

  const loadList = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const res = await listPlatformSupportTickets({
          limit: 200,
          search: search.trim() || undefined,
        });
        setTickets(res?.tickets ?? []);
        setOpenCount(res?.openCount ?? 0);
        void refreshNotify({ silentToast: true });
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load support tickets");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [search, refreshNotify]
  );

  useEffect(() => {
    if (ticketFromUrl) setSelectedId(ticketFromUrl);
  }, [ticketFromUrl]);

  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      if (chatFilter === "UNREAD") return isSupportTicketUnread(t, seenKeys);
      if (chatFilter === "OPEN") {
        return t.status === "OPEN" || t.status === "IN_PROGRESS";
      }
      if (chatFilter === "RESOLVED") {
        return t.status === "RESOLVED" || t.status === "CLOSED";
      }
      return true;
    });
  }, [tickets, chatFilter, seenKeys]);

  const localUnreadCount = useMemo(
    () => tickets.filter((t) => isSupportTicketUnread(t, seenKeys)).length,
    [tickets, seenKeys]
  );
  const unreadBadge = Math.max(unreadCount, localUnreadCount);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await getPlatformSupportTicket(id);
      setDetail(res.ticket);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load ticket");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadList();
    }, 250);
    return () => clearTimeout(t);
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setReply("");
      setPendingAttachments([]);
      setEmojiOpen(false);
      return;
    }
    void loadDetail(selectedId);
    const row = tickets.find((t) => t.id === selectedId);
    if (row) markTicketSeen(row);
  }, [selectedId, loadDetail, tickets, markTicketSeen]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail?.messages.length, selectedId]);

  useEffect(() => {
    if (selectedId) composerRef.current?.focus();
  }, [selectedId]);

  useEffect(() => {
    if (!emojiOpen) return;
    function onDown(e: MouseEvent) {
      if (emojiWrapRef.current && !emojiWrapRef.current.contains(e.target as Node)) {
        setEmojiOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [emojiOpen]);

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const next: PlatformSupportTicketAttachment[] = [];
    for (const file of Array.from(files).slice(0, 5)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setError(`"${file.name}" is too large (max 1.5 MB)`);
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        next.push({
          id: newId("att"),
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          dataUrl,
          createdAt: new Date().toISOString(),
          kind: "file",
        });
      } catch {
        setError(`Could not attach ${file.name}`);
      }
    }
    if (next.length) {
      setPendingAttachments((prev) => [...prev, ...next].slice(0, 5));
      setError(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function toggleVoice() {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size > MAX_ATTACHMENT_BYTES) {
          setError("Voice note is too large (max 1.5 MB)");
          return;
        }
        try {
          const dataUrl = await blobToDataUrl(blob);
          setPendingAttachments((prev) =>
            [
              ...prev,
              {
                id: newId("voice"),
                name: `voice-note-${new Date().toISOString().slice(0, 19)}.webm`,
                mimeType: blob.type || "audio/webm",
                size: blob.size,
                dataUrl,
                createdAt: new Date().toISOString(),
                kind: "voice" as const,
              },
            ].slice(0, 5)
          );
          setError(null);
        } catch {
          setError("Could not save voice note");
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError("Microphone access denied");
    }
  }

  function insertEmoji(emoji: string) {
    const el = composerRef.current;
    if (!el) {
      setReply((prev) => prev + emoji);
      return;
    }
    const start = el.selectionStart ?? reply.length;
    const end = el.selectionEnd ?? reply.length;
    const next = reply.slice(0, start) + emoji + reply.slice(end);
    setReply(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function handleReply() {
    if (!selectedId) return;
    if (!reply.trim() && pendingAttachments.length === 0) return;
    setReplySending(true);
    setError(null);
    setEmojiOpen(false);
    try {
      const res = await replyPlatformSupportTicket(selectedId, {
        body: reply.trim(),
        status: detail?.status === "OPEN" ? "IN_PROGRESS" : undefined,
        attachments: pendingAttachments.length ? pendingAttachments : undefined,
      });
      setDetail(res.ticket);
      setReply("");
      setPendingAttachments([]);
      await loadList(true);
      composerRef.current?.focus();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send reply");
    } finally {
      setReplySending(false);
    }
  }

  const canSend = Boolean(reply.trim() || pendingAttachments.length > 0);

  async function handleStatusChange(next: PlatformSupportTicketStatus) {
    if (!selectedId || !detail || detail.status === next) return;
    setStatusSaving(true);
    setError(null);
    try {
      const res = await patchPlatformSupportTicket(selectedId, { status: next });
      setDetail(res.ticket);
      await loadList(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setStatusSaving(false);
    }
  }

  const chatTitle =
    detail?.organizationName ||
    selectedListItem?.organizationName ||
    detail?.createdByName ||
    "Workshop";
  const chatSubtitle = detail?.subject || selectedListItem?.subject || "";

  const messageRows = useMemo(() => {
    const messages = detail?.messages ?? [];
    let last = "";
    return messages.map((msg, idx) => {
      const key = dayKey(msg.createdAt);
      const showDay = key !== last;
      if (showDay) last = key;
      return {
        msg,
        showDay,
        isLast: idx === messages.length - 1,
      };
    });
  }, [detail?.messages]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <RefreshingBar show={refreshing || detailLoading} />
      <Topbar
        title="Support Tickets"
        description={`Workshop Help & Support · ${openCount} open / in progress`}
      />

      {error && <ErrorBanner message={error} onRetry={() => loadList()} />}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          overflow: "hidden",
          background: "var(--card)",
        }}
      >
        {/* Conversation list */}
        <aside
          className={selectedId ? "hidden md:flex" : "flex"}
          style={{
            width: "100%",
            maxWidth: 380,
            flexDirection: "column",
            borderRight: "1px solid var(--border)",
            minHeight: 0,
            background: "var(--card)",
          }}
        >
          <div
            style={{
              padding: "10px 14px 12px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              background: "var(--card)",
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--foreground)", letterSpacing: "-0.02em" }}>
              Chats
            </div>
            <div style={{ position: "relative" }}>
              <Search
                size={15}
                style={{
                  position: "absolute",
                  left: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#54656f",
                }}
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search or start a new chat"
                style={{
                  width: "100%",
                  height: 38,
                  padding: "0 14px 0 40px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--secondary)",
                  fontSize: 14,
                  outline: "none",
                  boxSizing: "border-box",
                  color: "var(--foreground)",
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                overflowX: "auto",
                paddingBottom: 2,
              }}
            >
              {(
                [
                  { id: "ALL", label: "All" },
                  {
                    id: "UNREAD",
                    label: unreadBadge > 0 ? `Unread ${unreadBadge}` : "Unread",
                  },
                  { id: "OPEN", label: "Open" },
                  { id: "RESOLVED", label: "Resolved" },
                ] as const
              ).map((chip) => {
                const active = chatFilter === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setChatFilter(chip.id)}
                    style={{
                      height: 32,
                      padding: "0 14px",
                      borderRadius: 999,
                      border: "none",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                      background: active ? "#EFF8F6" : "var(--secondary)",
                      color: active ? "#3D8F82" : "var(--muted-foreground)",
                    }}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--card)" }}>
            {loading ? (
              <div style={{ padding: 24, color: "#667781", fontSize: 13 }}>
                Loading chats…
              </div>
            ) : filteredTickets.length === 0 ? (
              <div
                style={{
                  padding: 32,
                  textAlign: "center",
                  color: "#667781",
                  fontSize: 13,
                }}
              >
                <LifeBuoy size={28} style={{ margin: "0 auto 10px", opacity: 0.5 }} />
                {tickets.length === 0
                  ? "No support chats yet"
                  : chatFilter === "UNREAD"
                    ? "No unread chats"
                    : "No chats in this filter"}
              </div>
            ) : (
              filteredTickets.map((row) => {
                const active = row.id === selectedId;
                const unread = isSupportTicketUnread(row, seenKeys);
                const seed = row.organizationName || row.createdByName || row.id;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => selectTicket(row.id)}
                    style={{
                      display: "flex",
                      gap: 14,
                      width: "100%",
                      padding: "12px 16px",
                      border: "none",
                      borderBottom: "1px solid var(--border)",
                      background: active ? "var(--secondary)" : "var(--card)",
                      cursor: "pointer",
                      textAlign: "left",
                      color: "inherit",
                    }}
                  >
                    <span
                      style={{
                        width: 49,
                        height: 49,
                        borderRadius: "50%",
                        background: avatarColor(seed),
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 16,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {initials(row.organizationName || row.createdByName)}
                    </span>
                    <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                          alignItems: "baseline",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 16,
                            fontWeight: unread ? 700 : 500,
                            color: "var(--foreground)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row.organizationName || "Workshop"}
                        </span>
                        <span
                          style={{
                            fontSize: 12,
                            color: unread ? "#50B0A0" : "var(--muted-foreground)",
                            flexShrink: 0,
                            fontWeight: unread ? 600 : 400,
                          }}
                        >
                          {chatTime(row.lastMessageAt ?? row.updatedAt)}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          marginTop: 3,
                          alignItems: "center",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 14,
                            color: unread ? "var(--foreground)" : "var(--muted-foreground)",
                            fontWeight: unread ? 600 : 400,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            minWidth: 0,
                          }}
                        >
                          {row.lastMessageAuthor === "SUPPORT" ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <CheckCheck size={16} color="#53bdeb" />
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                                {row.lastMessagePreview || row.subject}
                              </span>
                            </span>
                          ) : (
                            row.lastMessagePreview || row.subject
                          )}
                        </span>
                        {unread ? (
                          <span
                            style={{
                              minWidth: 22,
                              height: 22,
                              padding: "0 6px",
                              borderRadius: 999,
                              background: "#50B0A0",
                              color: "#fff",
                              fontSize: 12,
                              fontWeight: 700,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                            title="Unread"
                          >
                            {Math.max(1, row.messageCount)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Chat pane */}
        <section
          className={selectedId ? "flex" : "hidden md:flex"}
          style={{
            flex: 1,
            minWidth: 0,
            flexDirection: "column",
            minHeight: 0,
            background: "var(--page-bg)",
          }}
        >
          {!selectedId ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                padding: 32,
                background: "var(--page-bg)",
                color: "var(--muted-foreground)",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: "50%",
                  background: "rgba(80,176,160,0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#50B0A0",
                }}
              >
                <LifeBuoy size={32} />
              </div>
              <div style={{ fontSize: 22, fontWeight: 500, color: "var(--foreground)" }}>
                MY DETAIL OS Support
              </div>
              <p style={{ margin: 0, maxWidth: 360, fontSize: 14, lineHeight: 1.5 }}>
                Select a workshop chat on the left to reply. Messages sync live with Help & Support.
              </p>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div
                style={{
                  height: 60,
                  padding: "0 12px 0 8px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: "var(--card)",
                  borderBottom: "1px solid var(--border)",
                  flexShrink: 0,
                }}
              >
                <button
                  type="button"
                  className="flex md:hidden"
                  aria-label="Back to chats"
                  onClick={() => selectTicket(null)}
                  style={{
                    width: 36,
                    height: 36,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    color: "#54656f",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <ArrowLeft size={20} />
                </button>
                <span
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background: avatarColor(chatTitle),
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {initials(chatTitle)}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: "var(--foreground)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {chatTitle}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--muted-foreground)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {chatSubtitle}
                    {detail ? ` · ${detail.messages.length} messages` : ""}
                    {detail?.createdByName ? ` · ${detail.createdByName}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <FilterSelect
                    value={detail?.status ?? "OPEN"}
                    onChange={(v) => void handleStatusChange(v as PlatformSupportTicketStatus)}
                    options={STATUS_OPTIONS.filter((o) => o.value !== "ALL")}
                    aria-label="Update ticket status"
                    minWidth={120}
                    disabled={!detail || statusSaving}
                  />
                </div>
              </div>

              {/* Messages */}
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflow: "auto",
                  padding: "12px 7% 8px",
                  background: "var(--page-bg)",
                }}
              >
                {detailLoading && !detail ? (
                  <div style={{ textAlign: "center", padding: 24, color: "#667781", fontSize: 13 }}>
                    Loading messages…
                  </div>
                ) : (
                  <>
                    {detail?.description ? (
                      <div style={{ display: "flex", justifyContent: "center", margin: "8px 0 14px" }}>
                        <div
                          style={{
                            maxWidth: 420,
                            background: "var(--card)",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            padding: "8px 12px",
                            fontSize: 12,
                            color: "var(--muted-foreground)",
                            textAlign: "center",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          <strong style={{ color: "var(--foreground)" }}>Ticket:</strong>{" "}
                          {detail.description}
                        </div>
                      </div>
                    ) : null}

                    {messageRows.map(({ msg, showDay, isLast }) => {
                      const isSupport = msg.author === "SUPPORT";
                      const linked = (msg.attachmentIds ?? [])
                        .map((id) => detail?.attachments.find((a) => a.id === id))
                        .filter((a): a is PlatformSupportTicketAttachment => Boolean(a));

                      return (
                        <div key={msg.id}>
                          {showDay && (
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "center",
                                margin: "10px 0",
                              }}
                            >
                              <span
                                style={{
                                  background: "var(--card)",
                                  color: "var(--muted-foreground)",
                                  fontSize: 12,
                                  fontWeight: 500,
                                  padding: "5px 12px",
                                  borderRadius: 8,
                                  border: "1px solid var(--border)",
                                }}
                              >
                                {dayDividerLabel(msg.createdAt)}
                              </span>
                            </div>
                          )}
                          <div
                            style={{
                              display: "flex",
                              justifyContent: isSupport ? "flex-end" : "flex-start",
                              marginBottom: 3,
                            }}
                          >
                            <div
                              style={{
                                position: "relative",
                                maxWidth: "min(65%, 520px)",
                                padding: "6px 8px 4px 9px",
                                borderRadius: isSupport
                                  ? "8px 0 8px 8px"
                                  : "0 8px 8px 8px",
                                background: isSupport ? "#EFF8F6" : "var(--card)",
                                border: `1px solid ${isSupport ? "#A8D9D0" : "var(--border)"}`,
                                boxShadow: "none",
                                color: "var(--foreground)",
                              }}
                            >
                              {!isSupport && (
                                <div
                                  style={{
                                    fontSize: 12.5,
                                    fontWeight: 700,
                                    color: avatarColor(msg.authorName || "W"),
                                    marginBottom: 2,
                                  }}
                                >
                                  {msg.authorName || "Workshop"}
                                </div>
                              )}
                              {linked.length > 0 && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 4 }}>
                                  {linked.map((a) =>
                                    a.mimeType.startsWith("image/") ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        key={a.id}
                                        src={a.dataUrl}
                                        alt={a.name}
                                        style={{
                                          maxWidth: "100%",
                                          maxHeight: 240,
                                          borderRadius: 8,
                                          display: "block",
                                        }}
                                      />
                                    ) : a.kind === "voice" || a.mimeType.startsWith("audio/") ? (
                                      <audio
                                        key={a.id}
                                        controls
                                        src={a.dataUrl}
                                        style={{ width: "100%", maxWidth: 280, height: 36 }}
                                      />
                                    ) : (
                                      <a
                                        key={a.id}
                                        href={a.dataUrl}
                                        download={a.name}
                                        style={{
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: 6,
                                          fontSize: 13,
                                          color: "#027eb5",
                                          textDecoration: "none",
                                          background: "rgba(0,0,0,0.04)",
                                          padding: "8px 10px",
                                          borderRadius: 8,
                                        }}
                                      >
                                        <FileText size={14} />
                                        {a.name}
                                      </a>
                                    )
                                  )}
                                </div>
                              )}
                              {msg.body &&
                              msg.body !== "📎 Attachment" &&
                              msg.body !== "🎤 Voice note" ? (
                                <div
                                  style={{
                                    fontSize: 14,
                                    lineHeight: 1.45,
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word",
                                    paddingRight: 4,
                                  }}
                                >
                                  {msg.body}
                                </div>
                              ) : !linked.length ? (
                                <div
                                  style={{
                                    fontSize: 14,
                                    lineHeight: 1.45,
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word",
                                    paddingRight: 4,
                                  }}
                                >
                                  {msg.body}
                                </div>
                              ) : null}
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "flex-end",
                                  alignItems: "center",
                                  gap: 3,
                                  marginTop: 2,
                                  marginLeft: 12,
                                }}
                              >
                                <span
                                  style={{ fontSize: 11, color: "#667781", lineHeight: 1 }}
                                  title={formatDateTime(msg.createdAt)}
                                >
                                  {chatTime(msg.createdAt)}
                                </span>
                                {isSupport &&
                                  (isLast ? (
                                    <CheckCheck size={14} color="#53bdeb" />
                                  ) : (
                                    <Check size={14} color="#667781" />
                                  ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={threadEndRef} />
                  </>
                )}
              </div>

              {/* Composer */}
              <div
                style={{
                  padding: "6px 10px 10px",
                  background: "var(--card)",
                  borderTop: "1px solid var(--border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  flexShrink: 0,
                  position: "relative",
                }}
              >
                {pendingAttachments.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      padding: "4px 4px 0",
                    }}
                  >
                    {pendingAttachments.map((a) => (
                      <div
                        key={a.id}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          background: "var(--secondary)",
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          padding: "6px 8px",
                          fontSize: 12,
                          color: "var(--foreground)",
                          maxWidth: 220,
                        }}
                      >
                        {a.mimeType.startsWith("image/") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={a.dataUrl}
                            alt=""
                            style={{ width: 28, height: 28, borderRadius: 4, objectFit: "cover" }}
                          />
                        ) : a.kind === "voice" || a.mimeType.startsWith("audio/") ? (
                          <Mic size={14} color="#00a884" />
                        ) : (
                          <Paperclip size={14} color="#667781" />
                        )}
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {a.name}
                        </span>
                        <button
                          type="button"
                          aria-label="Remove attachment"
                          onClick={() =>
                            setPendingAttachments((prev) => prev.filter((x) => x.id !== a.id))
                          }
                          style={{
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            padding: 0,
                            color: "#667781",
                            display: "flex",
                          }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {emojiOpen && (
                  <div
                    ref={emojiWrapRef}
                    style={{
                      position: "absolute",
                      bottom: "100%",
                      left: 10,
                      marginBottom: 6,
                      zIndex: 30,
                    }}
                  >
                    <EmojiPicker
                      onPick={insertEmoji}
                      onClose={() => setEmojiOpen(false)}
                    />
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                    <div
                      style={{
                        flex: 1,
                        background: "var(--secondary)",
                        borderRadius: 24,
                        border: "1px solid var(--border)",
                        padding: "6px 8px 6px 6px",
                        minHeight: 48,
                        display: "flex",
                        alignItems: "flex-end",
                        gap: 2,
                      }}
                    >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*,audio/*,.pdf,.doc,.docx,.txt"
                      hidden
                      onChange={(e) => void addFiles(e.target.files)}
                    />
                    <button
                      type="button"
                      aria-label="Attach file"
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        width: 40,
                        height: 40,
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        color: "#54656f",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        borderRadius: "50%",
                      }}
                    >
                      <Paperclip size={22} />
                    </button>
                    <button
                      type="button"
                      aria-label="Emoji"
                      aria-pressed={emojiOpen}
                      onClick={() => setEmojiOpen((v) => !v)}
                      style={{
                        width: 40,
                        height: 40,
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        color: emojiOpen ? "#50B0A0" : "var(--muted-foreground)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        borderRadius: "50%",
                      }}
                    >
                      <Smile size={22} />
                    </button>
                    <textarea
                      ref={composerRef}
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder="Type a message"
                      rows={1}
                      style={{
                        flex: 1,
                        border: "none",
                        outline: "none",
                        resize: "none",
                        maxHeight: 120,
                        minHeight: 28,
                        fontSize: 15,
                        lineHeight: 1.4,
                        fontFamily: "inherit",
                        background: "transparent",
                        color: "var(--foreground)",
                        padding: "8px 6px",
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void handleReply();
                        }
                      }}
                    />
                  </div>
                  {canSend ? (
                    <button
                      type="button"
                      aria-label="Send message"
                      disabled={replySending}
                      onClick={() => void handleReply()}
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: "50%",
                        border: "none",
                        background: replySending ? "#94a3b8" : "#50B0A0",
                        color: "#fff",
                        cursor: replySending ? "not-allowed" : "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Send size={20} style={{ marginLeft: 2 }} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label={recording ? "Stop recording" : "Record voice note"}
                      onClick={() => void toggleVoice()}
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: "50%",
                        border: "none",
                        background: recording ? "#ef4444" : "#50B0A0",
                        color: "#fff",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {recording ? <MicOff size={20} /> : <Mic size={20} />}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
