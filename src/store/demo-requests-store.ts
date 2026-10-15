"use client";

import { create } from "zustand";
import { toast } from "sonner";
import {
  listPlatformDemoRequests,
  type PlatformDemoRequest,
} from "@/api/platform";

const SEEN_KEY = "admin_demo_request_seen_ids";

function loadSeenIds(): Set<string> {
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

function persistSeenIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

interface DemoRequestsNotifyState {
  scheduledCount: number;
  unreadCount: number;
  items: PlatformDemoRequest[];
  seenIds: Set<string>;
  loading: boolean;
  lastFetchedAt: number;
  refresh: (opts?: { silentToast?: boolean }) => Promise<void>;
  markSeen: () => void;
  startPolling: (intervalMs?: number) => () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<void> | null = null;

export const useDemoRequestsStore = create<DemoRequestsNotifyState>((set, get) => ({
  scheduledCount: 0,
  unreadCount: 0,
  items: [],
  seenIds: new Set(),
  loading: false,
  lastFetchedAt: 0,

  refresh: async (opts) => {
    if (inflight) return inflight;
    inflight = (async () => {
      set({ loading: true });
      try {
        const prevUnread = get().unreadCount;
        const hadFetched = get().lastFetchedAt > 0;
        const seenIds =
          get().seenIds.size > 0 || get().lastFetchedAt > 0
            ? get().seenIds
            : loadSeenIds();

        const res = await listPlatformDemoRequests({
          limit: 50,
          status: "SCHEDULED",
        });
        const items = (res?.demos ?? [])
          .slice()
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
          .slice(0, 10);

        const activeIds = new Set(items.map((i) => i.id));
        const prunedSeen = new Set([...seenIds].filter((id) => activeIds.has(id)));
        if (prunedSeen.size !== seenIds.size) persistSeenIds(prunedSeen);

        const unreadCount = items.filter((i) => !prunedSeen.has(i.id)).length;

        set({
          scheduledCount: res.scheduledCount,
          items,
          seenIds: prunedSeen,
          unreadCount,
          lastFetchedAt: Date.now(),
          loading: false,
        });

        if (!opts?.silentToast && hadFetched && unreadCount > prevUnread) {
          const delta = unreadCount - prevUnread;
          toast.info(
            delta === 1 ? "1 new demo request" : `${delta} new demo requests`,
            {
              description: "A workshop booked a live product demo.",
              action: {
                label: "Open",
                onClick: () => {
                  window.location.assign("/demo-requests");
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
    const next = new Set(get().seenIds);
    for (const item of get().items) next.add(item.id);
    persistSeenIds(next);
    set({ seenIds: next, unreadCount: 0 });
  },

  startPolling: (intervalMs = 45_000) => {
    const seenIds = loadSeenIds();
    set({ seenIds });
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
