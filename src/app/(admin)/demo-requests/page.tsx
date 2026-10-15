"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { ErrorBanner } from "@/components/shared/error-banner";
import { RefreshingBar } from "@/components/shared/loading";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar, FilterSelect } from "@/components/shared/filter-bar";
import {
  AdminTable,
  THead,
  Th,
  TBody,
  Tr,
  Td,
  TableFooter,
  AdminTableSkeleton,
} from "@/components/shared/admin-table";
import { Badge } from "@/components/ui/badge";
import {
  listPlatformDemoRequests,
  patchPlatformDemoRequest,
  type PlatformDemoRequest,
  type PlatformDemoRequestStatus,
} from "@/api/platform";
import { useDemoRequestsStore } from "@/store/demo-requests-store";
import { formatDate, formatDateTime } from "@/lib/utils";

const STATUS_OPTIONS = [
  { value: "ALL", label: "All statuses" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

const STATUS_BADGE: Record<
  PlatformDemoRequestStatus,
  { label: string; variant: "warning" | "success" | "muted" | "info" }
> = {
  SCHEDULED: { label: "Scheduled", variant: "warning" },
  COMPLETED: { label: "Completed", variant: "success" },
  CANCELLED: { label: "Cancelled", variant: "muted" },
};

function StatusBadge({ status }: { status: PlatformDemoRequestStatus }) {
  const cfg = STATUS_BADGE[status] ?? { label: status, variant: "muted" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

export default function DemoRequestsPage() {
  const refreshNotify = useDemoRequestsStore((s) => s.refresh);
  const markSeen = useDemoRequestsStore((s) => s.markSeen);

  const [demos, setDemos] = useState<PlatformDemoRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [scheduledCount, setScheduledCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [selected, setSelected] = useState<PlatformDemoRequest | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [notes, setNotes] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const selectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedIdRef.current = selected?.id ?? null;
  }, [selected?.id]);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const res = await listPlatformDemoRequests({
          limit: 200,
          search: search.trim() || undefined,
          status: status === "ALL" ? undefined : status,
        });
        setDemos(res?.demos ?? []);
        setTotal(res?.total ?? 0);
        setScheduledCount(res?.scheduledCount ?? 0);
        void refreshNotify({ silentToast: true });

        // Keep detail panel in sync without putting `selected` in deps (that caused a reload loop).
        const selectedId = selectedIdRef.current;
        if (selectedId) {
          const next = res.demos.find((d) => d.id === selectedId) ?? null;
          setSelected(next);
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load demo requests");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [search, status, refreshNotify]
  );

  useEffect(() => {
    markSeen();
  }, [markSeen]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function handleStatusChange(next: PlatformDemoRequestStatus) {
    if (!selected || selected.status === next) return;
    setStatusSaving(true);
    setError(null);
    try {
      const res = await patchPlatformDemoRequest(selected.id, { status: next });
      setSelected(res.demo);
      setNotes(res.demo.notes ?? "");
      await load(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleSaveNotes() {
    if (!selected) return;
    setNotesSaving(true);
    setError(null);
    try {
      const res = await patchPlatformDemoRequest(selected.id, {
        notes: notes.trim(),
      });
      setSelected(res.demo);
      await load(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save notes");
    } finally {
      setNotesSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <RefreshingBar show={refreshing} />
      <Topbar
        title="Demo Requests"
        description={`Live product demos from workshops · ${scheduledCount} scheduled`}
      />

      <FilterBar
        searchValue={search}
        searchPlaceholder="Search name, workshop, city, mobile…"
        onSearch={setSearch}
        onRefresh={() => void load(true)}
        refreshing={loading || refreshing}
      >
        <FilterSelect
          value={status}
          onChange={setStatus}
          options={STATUS_OPTIONS}
          aria-label="Filter by status"
          minWidth={150}
        />
      </FilterBar>

      {error && <ErrorBanner message={error} onRetry={() => load()} />}

      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
          {loading ? (
            <AdminTableSkeleton rows={8} cols={6} />
          ) : demos.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No demo requests yet"
              description="When a workshop books a live product demo from Request a Demo, it will show up here."
            />
          ) : (
            <AdminTable>
              <THead>
                <Tr>
                  <Th>Slot</Th>
                  <Th>Workshop</Th>
                  <Th>Contact</Th>
                  <Th>City</Th>
                  <Th>Status</Th>
                  <Th>Requested</Th>
                </Tr>
              </THead>
              <TBody>
                {demos.map((row) => (
                  <Tr
                    key={row.id}
                    onClick={() => {
                      setSelected(row);
                      setNotes(row.notes ?? "");
                    }}
                  >
                    <Td>
                      <div style={{ fontWeight: 600 }}>{formatDate(row.slotDate)}</div>
                      <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                        {row.slotLabel}
                      </div>
                    </Td>
                    <Td>
                      <div style={{ fontWeight: 600 }}>
                        {row.workshopName || row.organizationName || "—"}
                      </div>
                      {row.organizationName && row.organizationName !== row.workshopName ? (
                        <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                          {row.organizationName}
                        </div>
                      ) : null}
                    </Td>
                    <Td>
                      <div>{row.fullName || "—"}</div>
                      <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                        {row.mobile || "—"}
                      </div>
                    </Td>
                    <Td>{row.city || "—"}</Td>
                    <Td>
                      <StatusBadge status={row.status} />
                    </Td>
                    <Td>{formatDateTime(row.createdAt)}</Td>
                  </Tr>
                ))}
              </TBody>
            </AdminTable>
          )}
          {!loading && demos.length > 0 && (
            <TableFooter showing={demos.length} total={total} label="demos" />
          )}
        </div>

        {selected && (
          <aside
            style={{
              width: 380,
              maxWidth: "46vw",
              borderLeft: "1px solid var(--border)",
              background: "var(--card)",
              overflow: "auto",
              padding: 20,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--muted-foreground)",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  Demo detail
                </div>
                <h2 style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700 }}>
                  {selected.workshopName || "Workshop demo"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                style={{
                  height: 30,
                  padding: "0 10px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Close
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
              <StatusBadge status={selected.status} />
              <FilterSelect
                value={selected.status}
                onChange={(v) => void handleStatusChange(v as PlatformDemoRequestStatus)}
                options={STATUS_OPTIONS.filter((o) => o.value !== "ALL")}
                aria-label="Update demo status"
                minWidth={140}
                disabled={statusSaving}
              />
            </div>

            <dl style={{ display: "grid", gap: 12, margin: 0 }}>
              <Detail label="Slot" value={`${formatDate(selected.slotDate)} · ${selected.slotLabel}`} />
              <Detail label="Contact" value={selected.fullName || "—"} />
              <Detail label="Mobile" value={selected.mobile || "—"} />
              <Detail label="City" value={selected.city || "—"} />
              <Detail label="Organization" value={selected.organizationName || "—"} />
              <Detail label="Requested" value={formatDateTime(selected.createdAt)} />
              <div>
                <dt
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--muted-foreground)",
                    marginBottom: 6,
                  }}
                >
                  What they want to see
                </dt>
                <dd
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    fontSize: 13,
                    lineHeight: 1.55,
                    color: "var(--foreground)",
                    background: "var(--page-bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: 12,
                    minHeight: 48,
                  }}
                >
                  {selected.interests?.trim() || "—"}
                </dd>
              </div>
              <div>
                <dt
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--muted-foreground)",
                    marginBottom: 6,
                  }}
                >
                  Internal notes
                </dt>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Add notes for the sales team…"
                  style={{
                    width: "100%",
                    resize: "vertical",
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "var(--page-bg)",
                    color: "var(--foreground)",
                    fontSize: 13,
                    fontFamily: "inherit",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                <button
                  type="button"
                  disabled={notesSaving || notes.trim() === (selected.notes ?? "").trim()}
                  onClick={() => void handleSaveNotes()}
                  style={{
                    marginTop: 8,
                    height: 32,
                    padding: "0 12px",
                    borderRadius: 8,
                    border: "none",
                    background:
                      notesSaving || notes.trim() === (selected.notes ?? "").trim()
                        ? "#94a3b8"
                        : "#50B0A0",
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor:
                      notesSaving || notes.trim() === (selected.notes ?? "").trim()
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  {notesSaving ? "Saving…" : "Save notes"}
                </button>
              </div>
            </dl>
          </aside>
        )}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 4 }}>
        {label}
      </dt>
      <dd style={{ margin: 0, fontSize: 13, color: "var(--foreground)" }}>{value}</dd>
    </div>
  );
}
