"use client";

import { create } from "zustand";
import { toast } from "sonner";
import {
  listPlatformSupportTickets,
  type PlatformSupportTicketListItem,
} from "@/api/platform";

const SEEN_KEY = "admin_support_ticket_seen_keys";

/** Unread key = ticketId + last workshop activity time (so new replies re-notify). */
export function supportTicketActivityKey(item: PlatformSupportTicketListItem): string {
  return `${item.id}:${item.lastMessageAt ?? item.updatedAt}`;
}

export function supportTicketNeedsAttention(item: PlatformSupportTicketListItem): boolean {
  if (item.status === "RESOLVED" || item.status === "CLOSED") return false;
  // Brand-new open tickets always need attention (even after auto-ack).
  if (item.status === "OPEN") return true;
  // Otherwise only when the workshop spoke last.
  return item.lastMessageAuthor === "WORKSHOP";
}

function activityKey(item: PlatformSupportTicketListItem): string {
  return supportTicketActivityKey(item);
}

function needsAttention(item: PlatformSupportTicketListItem): boolean {
  return supportTicketNeedsAttention(item);
}

/** True when ticket needs attention and has not been opened yet. */
export function isSupportTicketUnread(
  item: PlatformSupportTicketListItem,
  seenKeys: Set<string>
): boolean {
  return needsAttention(item) && !seenKeys.has(activityKey(item));
}

function loadSeenKeys(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function persistSeenKeys(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore quota */
  }
}

function unreadFrom(items: PlatformSupportTicketListItem[], seen: Set<string>): number {
  return items.filter((item) => needsAttention(item) && !seen.has(activityKey(item))).length;
}

interface SupportTicketsNotifyState {
  /** Open + in-progress count (sidebar badge). */
  openCount: number;
  /** Unseen tickets awaiting a support reply (bell badge). */
  unreadCount: number;
  /** Recent tickets that need attention (notification list). */
  items: PlatformSupportTicketListItem[];
  seenKeys: Set<string>;
  loading: boolean;
  lastFetchedAt: number;
  refresh: (opts?: { silentToast?: boolean }) => Promise<void>;
  markSeen: () => void;
  markTicketSeen: (ticket: PlatformSupportTicketListItem) => void;
  startPolling: (intervalMs?: number) => () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<void> | null = null;

export const useSupportTicketsStore = create<SupportTicketsNotifyState>((set, get) => ({
  openCount: 0,
  unreadCount: 0,
  items: [],
  seenKeys: new Set(),
  loading: false,
  lastFetchedAt: 0,

  refresh: async (opts) => {
    if (inflight) return inflight;
    inflight = (async () => {
      set({ loading: true });
      try {
        const prevUnread = get().unreadCount;
        const hadFetched = get().lastFetchedAt > 0;
        const seenKeys =
          get().seenKeys.size > 0 || get().lastFetchedAt > 0
            ? get().seenKeys
            : loadSeenKeys();

        const res = await listPlatformSupportTickets({ limit: 50 });
        const attention = (res?.tickets ?? [])
          .filter(needsAttention)
          .sort((a, b) => {
            const aT = Date.parse(a.lastMessageAt ?? a.updatedAt) || 0;
            const bT = Date.parse(b.lastMessageAt ?? b.updatedAt) || 0;
            return bT - aT;
          })
          .slice(0, 10);

        const activeKeys = new Set(attention.map(activityKey));
        const prunedSeen = new Set([...seenKeys].filter((k) => activeKeys.has(k)));
        if (prunedSeen.size !== seenKeys.size) persistSeenKeys(prunedSeen);

        const unreadCount = unreadFrom(attention, prunedSeen);

        set({
          openCount: res.openCount,
          items: attention,
          seenKeys: prunedSeen,
          unreadCount,
          lastFetchedAt: Date.now(),
          loading: false,
        });

        if (!opts?.silentToast && hadFetched && unreadCount > prevUnread) {
          const delta = unreadCount - prevUnread;
          toast.info(
            delta === 1
              ? "1 new support message"
              : `${delta} new support messages`,
            {
              description: "A workshop replied in Help & Support.",
              action: {
                label: "Open",
                onClick: () => {
                  window.location.assign("/support-tickets");
                },
              },
            }
          );
        }
      } catch {
        set({ loading: false });
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  },

  markSeen: () => {
    const { items } = get();
    const next = new Set(get().seenKeys);
    for (const item of items) {
      if (needsAttention(item)) next.add(activityKey(item));
    }
    persistSeenKeys(next);
    set({ seenKeys: next, unreadCount: 0 });
  },

  markTicketSeen: (ticket) => {
    if (!needsAttention(ticket)) return;
    const next = new Set(get().seenKeys);
    next.add(activityKey(ticket));
    persistSeenKeys(next);
    set({
      seenKeys: next,
      unreadCount: unreadFrom(get().items, next),
    });
  },

  startPolling: (intervalMs = 30_000) => {
    const seenKeys = loadSeenKeys();
    set({ seenKeys });
    void get().refresh({ silentToast: true });
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void get().refresh();
    }, intervalMs);

    const onVisible = () => {
      if (document.visibilityState === "visible") void get().refresh({ silentToast: true });
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      document.removeEventListener("visibilitychange", onVisible);
    };
  },
}));
