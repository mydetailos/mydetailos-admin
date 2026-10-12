"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  CreditCard,
  FileText,
  Users,
  UserCog,
  Building2,
  MapPin,
  ClipboardList,
  Plus,
  Download,
  FileDown,
  LogIn,
  Link2,
  Copy,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { Topbar } from "@/components/layout/topbar";
import { ErrorBanner } from "@/components/shared/error-banner";
import { RefreshingBar } from "@/components/shared/loading";
import { FilterSelect } from "@/components/shared/filter-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  SubscriptionStatusBadge,
  PaymentStatusBadge,
  PlanBadge,
  GraceStatusBadge,
} from "@/components/shared/status-badges";
import {
  getOrganization,
  patchOrganizationSubscription,
  verifyPayment,
  markPaid,
  convertTrial,
  impersonateOrganization,
  patchOrganizationProfile,
  createOrganizationPaymentLink,
  resendOrganizationPaymentLink,
  deleteOrganization,
  type CreatePaymentLinkResult,
  type PaymentLinkSendVia,
  type PaymentLinkDiscountType,
} from "@/api/organizations";
import {
  getPlatformPlans,
  listPlatformUsers,
  listPlatformBranches,
  createPlatformBranch,
  listPlatformAudit,
  suspendOrg,
  restoreOrg,
  type PlatformUserRow,
  type PlatformBranchRow,
  type PlatformAuditRow,
  type PlatformPlansPricing,
} from "@/api/platform";
import { downloadTaxInvoicePdf } from "@/lib/tax-invoice-pdf";
import { prorateCredit, estimatePlanAmount, estimateCheckoutQuote } from "@/lib/platform-analytics";
import { loadGrowthConfig, saveGrowthConfig } from "@/lib/growth-store";
import { ApiError } from "@/lib/api-client";
import { OrganizationActivityPanel } from "@/components/shared/organization-activity-panel";
import { PlatformAuditList } from "@/components/shared/platform-audit-list";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  daysRemainingLabel,
  termLabel,
  needsManualPaymentReview,
} from "@/lib/utils";
import { usePendingPaymentsStore } from "@/store/pending-payments-store";
import {
  downloadOrganizationDataZip,
  downloadOrganizationSummaryPdf,
} from "@/lib/download-org-data";
import type {
  OrgDetail,
  PlanCode,
  SubscriptionPaymentRow,
  SubscriptionBillRow,
} from "@/types";

// ─── Design constants ─────────────────────────────────────────────────────────

const CARD_STYLE: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 2px 6px rgba(0,0,0,0.04)",
  overflow: "hidden",
};

/**
 * Billable / login seats shown under Users.
 * SUPER_ADMIN always counts as a user. Mechanics stay under Staff.
 */
const WORKSHOP_USER_ROLES = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "BRANCH_MANAGER",
  "MANAGER",
  "SUPERVISOR",
  "RECEPTIONIST",
]);

const ROLE_DISPLAY: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  BRANCH_MANAGER: "Branch Manager",
  MANAGER: "Manager",
  SUPERVISOR: "Supervisor",
  RECEPTIONIST: "Receptionist",
  MECHANIC: "Mechanic",
  PLATFORM_OWNER: "Platform Owner",
};

function roleDisplayLabel(role: string): string {
  return ROLE_DISPLAY[role] ?? role.replace(/_/g, " ");
}

// ─── Card building blocks ─────────────────────────────────────────────────────

function OrgCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ ...CARD_STYLE, ...style }}>{children}</div>;
}

function OrgCardHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div style={{ padding: "16px 16px 0", paddingInline: "clamp(16px, 3vw, 24px)", paddingTop: "clamp(16px, 2.5vw, 20px)" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ flex: "1 1 160px", minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--foreground)", letterSpacing: "-0.1px" }}>
            {title}
          </h3>
          {subtitle && (
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--muted-foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {subtitle}
            </p>
          )}
        </div>
        {right && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "flex-start",
              gap: 6,
              flex: "1 1 200px",
              minWidth: 0,
              maxWidth: "100%",
            }}
          >
            {right}
          </div>
        )}
      </div>
    </div>
  );
}

function OrgCardBody({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ padding: "16px 24px 24px", ...style }}>{children}</div>;
}

// ─── Field components ─────────────────────────────────────────────────────────

function InfoField({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--foreground)", lineHeight: 1.4 }}>
        {children ?? "—"}
      </div>
    </div>
  );
}

function UsageField({ label, used, limit }: { label: string; used: number; limit: number | null | undefined }) {
  const isOver = limit != null && used > limit;
  const pct = limit != null && limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 7 }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: isOver ? "#d97706" : "var(--foreground)" }}>
          {used} / {limit ?? "∞"}
        </span>
        {isOver && <AlertTriangle style={{ width: 13, height: 13, color: "#f59e0b", flexShrink: 0 }} />}
      </div>
      {limit != null && (
        <div style={{ height: 3, borderRadius: 2, background: "var(--secondary)", overflow: "hidden" }}>
          <div style={{ height: "100%", borderRadius: 2, width: `${pct}%`, background: isOver ? "#f59e0b" : "#50B0A0", transition: "width 0.3s ease" }} />
        </div>
      )}
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

// ─── Table helpers ────────────────────────────────────────────────────────────

function InlineTable({ heads, children }: { heads: { label: string; align?: "left" | "right" }[]; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead style={{ background: "var(--secondary)", borderBottom: "1px solid var(--border)" }}>
            <tr>
              {heads.map((h, i) => (
                <th key={i} style={{ padding: "9px 12px", textAlign: h.align ?? "left", fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

function InlineRow({ children, idx }: { children: React.ReactNode; idx: number }) {
  return (
    <tr
      style={{ borderTop: idx === 0 ? "none" : "1px solid #f1f5f9" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(248,250,252,0.9)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "")}
    >
      {children}
    </tr>
  );
}

function InlineTd({ children, align = "left", muted, bold }: { children?: React.ReactNode; align?: "left" | "right"; muted?: boolean; bold?: boolean }) {
  return (
    <td style={{ padding: "10px 12px", textAlign: align, color: muted ? "var(--muted-foreground)" : "var(--foreground)", fontWeight: bold ? 600 : undefined, fontSize: muted ? 12 : 13 }}>
      {children ?? "—"}
    </td>
  );
}

// ─── Skeleton + Empty ─────────────────────────────────────────────────────────

function Skel({ h, w = "100%" }: { h: number | string; w?: string }) {
  return <div style={{ height: h, width: w, background: "var(--secondary)", borderRadius: 6 }} />;
}

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "24px 0" }}>
      <Icon style={{ width: 28, height: 28, color: "#cbd5e1" }} />
      <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>{message}</span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [patching, setPatching] = useState(false);
  const [patchStatus, setPatchStatus] = useState<string>("");
  const [patchPlan, setPatchPlan] = useState<PlanCode>("STARTER");
  const [planOptions, setPlanOptions] = useState<{ value: string; label: string }[]>([
    { value: "STARTER", label: "STARTER" },
    { value: "GROWTH", label: "GROWTH" },
    { value: "BUSINESS", label: "BUSINESS" },
    { value: "ENTERPRISE", label: "ENTERPRISE" },
    { value: "CUSTOM", label: "CUSTOM" },
  ]);
  const [patchNotes, setPatchNotes] = useState("");
  const [patchMaxBranches, setPatchMaxBranches] = useState("");
  const [patchMaxUsers, setPatchMaxUsers] = useState("");
  const [patchTermMonths, setPatchTermMonths] = useState("12");
  const [patchExpiresAt, setPatchExpiresAt] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [impersonating, setImpersonating] = useState(false);
  const [pricing, setPricing] = useState<PlatformPlansPricing | null>(null);

  const [orgUsers, setOrgUsers] = useState<PlatformUserRow[]>([]);
  const [orgBranches, setOrgBranches] = useState<PlatformBranchRow[]>([]);
  const [orgLogs, setOrgLogs] = useState<PlatformAuditRow[]>([]);
  const [orgDirectoryLoading, setOrgDirectoryLoading] = useState(false);
  const [peopleTab, setPeopleTab] = useState<"staff" | "users">("staff");

  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [markPaidAmount, setMarkPaidAmount] = useState("");
  const [markPaidTxn, setMarkPaidTxn] = useState("");
  const [markPaidNotes, setMarkPaidNotes] = useState("");
  const [markPaidLoading, setMarkPaidLoading] = useState(false);

  const [payLinkOpen, setPayLinkOpen] = useState(false);
  const [payLinkLoading, setPayLinkLoading] = useState(false);
  const [payLinkPlan, setPayLinkPlan] = useState<PlanCode>("STARTER");
  const [payLinkTerm, setPayLinkTerm] = useState<"1" | "3" | "12" | "24" | "36" | "60">("12");
  const [payLinkExtraBranches, setPayLinkExtraBranches] = useState("0");
  const [payLinkExtraUsers, setPayLinkExtraUsers] = useState("0");
  const [payLinkDiscountType, setPayLinkDiscountType] = useState<PaymentLinkDiscountType>("NONE");
  const [payLinkDiscountValue, setPayLinkDiscountValue] = useState("");
  const [payLinkReferral, setPayLinkReferral] = useState("");
  const [payLinkNotes, setPayLinkNotes] = useState("");
  const [payLinkEmail, setPayLinkEmail] = useState("");
  const [payLinkPhone, setPayLinkPhone] = useState("");
  const [payLinkSendEmail, setPayLinkSendEmail] = useState(true);
  const [payLinkSendSms, setPayLinkSendSms] = useState(true);
  const [payLinkSendWhatsapp, setPayLinkSendWhatsapp] = useState(true);
  const [payLinkResult, setPayLinkResult] = useState<CreatePaymentLinkResult | null>(null);
  const [payLinkResending, setPayLinkResending] = useState<PaymentLinkSendVia | null>(null);
  const [verifyingPaymentId, setVerifyingPaymentId] = useState<string | null>(null);
  const refreshPendingBadge = usePendingPaymentsStore((s) => s.refresh);
  const [convertTrialOpen, setConvertTrialOpen] = useState(false);
  const [convertTrialLoading, setConvertTrialLoading] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("Admin suspension");
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");

  const [addBranchOpen, setAddBranchOpen] = useState(false);
  const [addBranchLoading, setAddBranchLoading] = useState(false);
  const [branchForm, setBranchForm] = useState({
    name: "",
    code: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    phone: "",
    email: "",
    managerName: "",
    managerPhone: "",
    isActive: true,
  });

  function resetBranchForm() {
    setBranchForm({
      name: "",
      code: "",
      address: "",
      city: "",
      state: "",
      pincode: "",
      phone: "",
      email: "",
      managerName: "",
      managerPhone: "",
      isActive: true,
    });
  }

  async function load(silent = false) {
    if (!silent) setLoading(true); else setRefreshing(true);
    setError(null);
    try {
      const data = await getOrganization(id);
      setOrg({
        ...data,
        payments: data.payments ?? [],
        bills: data.bills ?? [],
      });
      setPatchStatus(data.subscription.status);
      setPatchPlan(data.subscription.planCode);
      setPatchMaxBranches(data.subscription.maxBranchesOverride != null ? String(data.subscription.maxBranchesOverride) : "");
      setPatchMaxUsers(data.subscription.maxUsersOverride != null ? String(data.subscription.maxUsersOverride) : "");
      setPatchTermMonths(String(data.subscription.termMonths || 12));
      setPatchExpiresAt(data.subscription.expiresAt ? data.subscription.expiresAt.slice(0, 10) : "");
      const storedEmail = loadGrowthConfig().billingEmails[data.organization.id];
      setBillingEmail(storedEmail ?? "");
      setOrgDirectoryLoading(true);
      try {
        const [usersRes, branchesRes, auditRes] = await Promise.all([
          listPlatformUsers({ orgId: id, limit: 100 }),
          listPlatformBranches({ orgId: id, limit: 100 }),
          listPlatformAudit({ orgId: id, limit: 100 }),
        ]);
        setOrgUsers(usersRes.users);
        setOrgBranches(branchesRes.branches);
        setOrgLogs(auditRes.logs);
      } catch {
        setOrgUsers([]);
        setOrgBranches([]);
        setOrgLogs([]);
      } finally {
        setOrgDirectoryLoading(false);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load organization");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDownloadZip() {
    if (!org || exportingZip) return;
    setExportingZip(true);
    try {
      const result = await downloadOrganizationDataZip(org, {
        users: orgUsers,
        branches: orgBranches,
        audit: orgLogs,
      });
      toast.success(`Downloaded ${result.filename}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to download organization data");
    } finally {
      setExportingZip(false);
    }
  }

  function handleDownloadPdf() {
    if (!org) return;
    try {
      downloadOrganizationSummaryPdf(org);
      toast.success("Downloaded organization summary PDF.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to download PDF");
    }
  }

  useEffect(() => {
    getPlatformPlans()
      .then((res) => {
        const opts = res.plans.map((p) => ({
          value: p.planCode,
          label: `${p.planCode} — ${p.planName}`,
        }));
        if (opts.length) setPlanOptions(opts);
        setPricing(res.pricing);
      })
      .catch(() => { /* keep defaults */ });
  }, []);

  async function handlePatchSubscription() {
    if (!org) return;
    setPatching(true);
    try {
      await patchOrganizationSubscription(org.organization.id, {
        status: patchStatus as OrgDetail["subscription"]["status"],
        planCode: patchPlan,
        notes: patchNotes || undefined,
        maxBranchesOverride: patchMaxBranches.trim() === "" ? null : Number(patchMaxBranches),
        maxUsersOverride: patchMaxUsers.trim() === "" ? null : Number(patchMaxUsers),
        termMonths: Number(patchTermMonths) || undefined,
        expiresAt: patchExpiresAt ? new Date(patchExpiresAt).toISOString() : undefined,
      });
      await load(true);
      const cfg = loadGrowthConfig();
      if (billingEmail.trim()) cfg.billingEmails[org.organization.id] = billingEmail.trim();
      else delete cfg.billingEmails[org.organization.id];
      saveGrowthConfig(cfg);
      try {
        await patchOrganizationProfile(org.organization.id, { billingEmail: billingEmail.trim() || null });
      } catch {
        /* billing email stored locally if API is not available yet */
      }
      toast.success("Subscription updated successfully.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setPatching(false);
    }
  }

  async function handleMarkPaid() {
    if (!org) return;
    setMarkPaidLoading(true);
    try {
      await markPaid(org.organization.id, {
        amount: markPaidAmount ? Number(markPaidAmount) : undefined,
        txnReference: markPaidTxn || null,
        notes: markPaidNotes || null,
      });
      toast.success("Subscription marked as paid and activated.");
      setMarkPaidOpen(false);
      setMarkPaidAmount(""); setMarkPaidTxn(""); setMarkPaidNotes("");
      await load(true);
      void refreshPendingBadge({ silentToast: true });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to mark as paid.");
    } finally {
      setMarkPaidLoading(false);
    }
  }

  function openPayLink() {
    if (!org) return;
    setPayLinkPlan(org.subscription.planCode || "STARTER");
    const term = String(org.subscription.termMonths || 12);
    setPayLinkTerm(
      (["1", "3", "12", "24", "36", "60"].includes(term) ? term : "12") as typeof payLinkTerm
    );
    setPayLinkExtraBranches("0");
    setPayLinkExtraUsers("0");
    setPayLinkDiscountType(org.organization.referralCode ? "CODE" : "NONE");
    setPayLinkDiscountValue("");
    setPayLinkReferral(org.organization.referralCode ?? "");
    setPayLinkNotes("");
    setPayLinkEmail(billingEmail || org.organization.ownerEmail || "");
    setPayLinkPhone(org.organization.ownerPhone || "");
    setPayLinkSendEmail(true);
    setPayLinkSendSms(!!org.organization.ownerPhone);
    setPayLinkSendWhatsapp(!!org.organization.ownerPhone);
    setPayLinkResult(null);
    setPayLinkOpen(true);
  }

  async function handleCreatePayLink() {
    if (!org) return;
    const sendVia: PaymentLinkSendVia[] = [];
    if (payLinkSendEmail) sendVia.push("email");
    if (payLinkSendSms) sendVia.push("sms");
    if (payLinkSendWhatsapp) sendVia.push("whatsapp");
    if (sendVia.length === 0) {
      toast.error("Select at least one channel: Email, SMS, or WhatsApp.");
      return;
    }
    if (sendVia.includes("email") && !payLinkEmail.trim()) {
      toast.error("Enter an email to send the payment link.");
      return;
    }
    if ((sendVia.includes("sms") || sendVia.includes("whatsapp")) && !payLinkPhone.trim()) {
      toast.error("Enter a phone number to send via SMS / WhatsApp.");
      return;
    }
    if (payLinkDiscountType === "CODE" && !payLinkReferral.trim()) {
      toast.error("Enter a referral or coupon code.");
      return;
    }
    if (
      (payLinkDiscountType === "FLAT" || payLinkDiscountType === "PERCENTAGE") &&
      !(Number(payLinkDiscountValue) > 0)
    ) {
      toast.error(
        payLinkDiscountType === "FLAT"
          ? "Enter a flat discount amount in ₹."
          : "Enter a discount percentage."
      );
      return;
    }
    setPayLinkLoading(true);
    try {
      const termMonths = Number(payLinkTerm) as 1 | 3 | 12 | 24 | 36 | 60;
      const res = await createOrganizationPaymentLink(org.organization.id, {
        planCode: payLinkPlan,
        termMonths,
        extraBranches: Number(payLinkExtraBranches) || 0,
        extraUsers: Number(payLinkExtraUsers) || 0,
        discountType: payLinkDiscountType,
        discountValue:
          payLinkDiscountType === "FLAT" || payLinkDiscountType === "PERCENTAGE"
            ? Number(payLinkDiscountValue) || 0
            : null,
        referralCode:
          payLinkDiscountType === "CODE" ? payLinkReferral.trim() || null : null,
        notes: payLinkNotes.trim() || null,
        sendVia,
        customerEmail: payLinkEmail.trim() || null,
        customerPhone: payLinkPhone.trim() || null,
      });
      setPayLinkResult(res);
      toast.success("Payment link created.");
      await load(true);
      void refreshPendingBadge({ silentToast: true });
    } catch (e: unknown) {
      toast.error(
        e instanceof Error
          ? e.message
          : "Failed to create payment link. Confirm the backend endpoint is live."
      );
    } finally {
      setPayLinkLoading(false);
    }
  }

  async function handleCopyPayLink() {
    if (!payLinkResult?.paymentLinkUrl) return;
    try {
      await navigator.clipboard.writeText(payLinkResult.paymentLinkUrl);
      toast.success("Payment link copied.");
    } catch {
      toast.error("Could not copy link.");
    }
  }

  async function handleResendPayLink(medium: PaymentLinkSendVia) {
    if (!org || !payLinkResult?.paymentId) {
      toast.error("Payment id missing — copy the link and send it manually.");
      return;
    }
    setPayLinkResending(medium);
    try {
      const res = await resendOrganizationPaymentLink(
        org.organization.id,
        payLinkResult.paymentId,
        medium
      );
      if (res.paymentLinkUrl) {
        setPayLinkResult((prev) => (prev ? { ...prev, paymentLinkUrl: res.paymentLinkUrl! } : prev));
      }
      toast.success(
        medium === "email"
          ? "Link resent by email."
          : medium === "whatsapp"
            ? "Link resent on WhatsApp."
            : "Link resent by SMS."
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Resend failed.");
    } finally {
      setPayLinkResending(null);
    }
  }


  async function handleConvertTrial() {
    if (!org) return;
    setConvertTrialLoading(true);
    try {
      await convertTrial(org.organization.id, {
        markPaid: true,
        termMonths: 12,
        notes: "Converted from trial via Admin Portal",
      });
      toast.success("Trial converted to ACTIVE subscription.");
      setConvertTrialOpen(false);
      await load(true);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to convert trial.");
    } finally {
      setConvertTrialLoading(false);
    }
  }

  const WORKSHOP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://app.mydetailos.com").replace(/\/$/, "");

  async function handleImpersonate() {
    if (!org) return;
    setImpersonating(true);
    try {
      const res = await impersonateOrganization(org.organization.id);
      const url =
        res.loginUrl ||
        (res.accessToken ? `${WORKSHOP_URL}/login?impersonate=${encodeURIComponent(res.accessToken)}` : null);
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
        toast.success("Opened customer session.");
      } else {
        toast.success("Impersonation token issued. Open the workshop app.");
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Impersonation is not enabled on the API yet.");
    } finally {
      setImpersonating(false);
    }
  }

  async function handleVerifyPayment(payment: SubscriptionPaymentRow, outcome: "PAID" | "FAILED") {
    if (!org || verifyingPaymentId) return;
    setVerifyingPaymentId(payment.id);
    try {
      await verifyPayment(org.organization.id, { paymentId: payment.id, outcome, txnReference: payment.txnReference });
      toast.success(
        outcome === "PAID"
          ? "Payment accepted. Workshop access restored."
          : "Payment marked as Failed."
      );
      await load(true);
      void refreshPendingBadge({ silentToast: true });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Verification failed.");
    } finally {
      setVerifyingPaymentId(null);
    }
  }

  async function handleSuspend() {
    if (!org) return;
    const reason = suspendReason.trim();
    if (!reason) {
      toast.error("Suspension reason is required.");
      return;
    }
    setLifecycleLoading(true);
    try {
      await suspendOrg(org.organization.id, reason);
      toast.success("Organization suspended.");
      setSuspendOpen(false);
      setSuspendReason("Admin suspension");
      await load(true);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to suspend.");
    } finally {
      setLifecycleLoading(false);
    }
  }

  async function handleRestore() {
    if (!org) return;
    setLifecycleLoading(true);
    try {
      await restoreOrg(org.organization.id, "Admin restore");
      toast.success("Organization restored.");
      setRestoreOpen(false);
      await load(true);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to restore.");
    } finally {
      setLifecycleLoading(false);
    }
  }

  async function handleDeleteOrganization() {
    if (!org) return;
    setDeleteLoading(true);
    try {
      await deleteOrganization(org.organization.id);
      toast.success(`Organization "${org.organization.name}" permanently deleted.`);
      setDeleteOpen(false);
      router.push("/organizations");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to delete organization.");
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleAddBranch() {
    if (!org) return;
    const name = branchForm.name.trim();
    const address = branchForm.address.trim();
    const phone = branchForm.phone.replace(/\D/g, "").slice(0, 10);
    const managerPhone = branchForm.managerPhone.replace(/\D/g, "").slice(0, 10);
    if (!name || !address) {
      toast.error("Name and address are required.");
      return;
    }
    if (phone.length !== 10) {
      toast.error("Enter a valid 10-digit phone number.");
      return;
    }
    if (managerPhone && managerPhone.length !== 10) {
      toast.error("Manager phone must be a 10-digit number.");
      return;
    }
    setAddBranchLoading(true);
    try {
      const result = await createPlatformBranch(org.organization.id, {
        name,
        address,
        phone,
        code: branchForm.code.trim() || null,
        city: branchForm.city.trim() || null,
        state: branchForm.state.trim() || null,
        pincode: branchForm.pincode.trim() || null,
        email: branchForm.email.trim() || null,
        managerName: branchForm.managerName.trim() || null,
        managerPhone: managerPhone || null,
        isActive: branchForm.isActive,
        raiseLimitIfNeeded: true,
      });
      if (result.limitRaisedTo != null) {
        toast.success(`Branch created. Branch limit raised to ${result.limitRaisedTo}.`);
      } else {
        toast.success("Branch created.");
      }
      setAddBranchOpen(false);
      resetBranchForm();
      await load(true);
    } catch (e: unknown) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Failed to create branch.";
      toast.error(msg);
    } finally {
      setAddBranchLoading(false);
    }
  }

  const staffDirectory = useMemo(
    () => orgUsers.filter((u) => !WORKSHOP_USER_ROLES.has(u.role)),
    [orgUsers]
  );
  const usersDirectory = useMemo(
    () => orgUsers.filter((u) => WORKSHOP_USER_ROLES.has(u.role)),
    [orgUsers]
  );
  const peopleRows = peopleTab === "staff" ? staffDirectory : usersDirectory;

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Topbar />
      <div style={{ flex: 1, overflowY: "auto", background: "var(--page-bg)", padding: "clamp(12px, 3vw, 24px)" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
          <OrgCard>
            <OrgCardBody>
              <Skel h={14} w="160px" />
              <div style={{ height: 16 }} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "20px 24px" }}>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i}><Skel h={10} w="50px" /><div style={{ height: 6 }} /><Skel h={14} /></div>
                ))}
              </div>
            </OrgCardBody>
          </OrgCard>
          <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 20 }}>
            {[0, 1].map((i) => (
              <OrgCard key={i}>
                <OrgCardBody>
                  <Skel h={14} w="140px" />
                  <div style={{ height: 16 }} />
                  {[0, 1, 2].map((j) => (
                    <div key={j} style={{ marginBottom: 14 }}><Skel h={10} w="60px" /><div style={{ height: 6 }} /><Skel h={36} /></div>
                  ))}
                </OrgCardBody>
              </OrgCard>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 20 }}>
            {[0, 1].map((i) => (
              <OrgCard key={i}>
                <OrgCardBody>
                  <Skel h={14} w="100px" />
                  <div style={{ height: 24 }} />
                  <div style={{ display: "flex", justifyContent: "center" }}><Skel h={56} w="50%" /></div>
                </OrgCardBody>
              </OrgCard>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  if (error || !org) return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Topbar />
      <div style={{ padding: "clamp(12px, 3vw, 24px)" }}>
        <ErrorBanner message={error ?? "Organization not found."} onRetry={() => load()} />
      </div>
    </div>
  );

  const sub = org.subscription;
  const payments = org.payments ?? [];
  const bills = org.bills ?? [];
  const branchLimit = sub.effectiveMaxBranches ?? null;
  const staffLimit = sub.limits.maxStaff ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <RefreshingBar show={refreshing} />

      <Topbar
        title={org.organization.name}
        description={
          org.organization.slug
            ? `/${org.organization.slug} · ${org.organization.id}`
            : `ID: ${org.organization.id}`
        }
        actions={
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Button variant="outline" size="sm" onClick={() => router.back()} style={{ minWidth: 80 }}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing} style={{ minWidth: 90 }}>
              <RefreshCw className={`h-4 w-4${refreshing ? " animate-spin" : ""}`} />
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadPdf} style={{ minWidth: 90 }}>
              <FileText className="h-4 w-4" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadZip} disabled={exportingZip} style={{ minWidth: 110 }}>
              {exportingZip ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {exportingZip ? "Preparing…" : "Download ZIP"}
            </Button>
          </div>
        }
      />

      <div style={{ flex: 1, overflowY: "auto", background: "var(--page-bg)", padding: "clamp(12px, 3vw, 24px)" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Mobile-only back/refresh row */}
          <div className="flex sm:hidden gap-2">
            <Button variant="outline" size="sm" onClick={() => router.back()} style={{ minWidth: 88, paddingLeft: 14, paddingRight: 14 }}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing} style={{ minWidth: 100, paddingLeft: 14, paddingRight: 14 }}>
              <RefreshCw className={`h-4 w-4${refreshing ? " animate-spin" : ""}`} />
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
          </div>

          {/* Row 0 – Organization profile (signup / provision details) */}
          <OrgCard>
            <OrgCardHeader
              title="Organization profile"
              subtitle="Details captured at signup / provisioning"
              right={
                <Badge variant={org.organization.isActive === false ? "muted" : "success"}>
                  {org.organization.isActive === false ? "Inactive" : "Active"}
                </Badge>
              }
            />
            <OrgCardBody>
              <dl className="grid grid-cols-2 sm:grid-cols-4" style={{ gap: "20px 32px" }}>
                <InfoField label="Business name">{org.organization.name}</InfoField>
                <InfoField label="Slug">
                  {org.organization.slug ? (
                    <span style={{ fontFamily: "monospace" }}>/{org.organization.slug}</span>
                  ) : (
                    "—"
                  )}
                </InfoField>
                <InfoField label="Organization ID">
                  <span style={{ fontFamily: "monospace", fontSize: 12 }}>{org.organization.id}</span>
                </InfoField>
                <InfoField label="Primary branch">
                  {org.organization.primaryBranchName ?? "—"}
                </InfoField>
                <InfoField label="Owner name">{org.organization.ownerName ?? "—"}</InfoField>
                <InfoField label="Owner email">
                  {org.organization.ownerEmail ? (
                    <a href={`mailto:${org.organization.ownerEmail}`} style={{ color: "#50B0A0", textDecoration: "none" }}>
                      {org.organization.ownerEmail}
                    </a>
                  ) : (
                    "—"
                  )}
                </InfoField>
                <InfoField label="Owner phone">
                  {org.organization.ownerPhone ? (
                    <a href={`tel:${org.organization.ownerPhone}`} style={{ color: "#50B0A0", textDecoration: "none" }}>
                      {org.organization.ownerPhone}
                    </a>
                  ) : (
                    "—"
                  )}
                </InfoField>
                <InfoField label="Signup source">{org.organization.signupSource ?? "—"}</InfoField>
                <InfoField label="Referral code">{org.organization.referralCode ?? "—"}</InfoField>
                <InfoField label="Created">{formatDateTime(org.organization.createdAt)}</InfoField>
                <InfoField label="Activated">{formatDateTime(org.organization.activatedAt)}</InfoField>
                <InfoField label="Account status">
                  {org.organization.isActive === false ? "Suspended / inactive" : "Active"}
                </InfoField>
              </dl>
            </OrgCardBody>
          </OrgCard>

          {/* Row 1 – Subscription overview */}
          <OrgCard>
            <OrgCardHeader
              title="Subscription"
              subtitle="Current subscription details"
              right={
                <>
                  <PlanBadge planCode={sub.planCode} />
                  <SubscriptionStatusBadge status={sub.status} />
                  <PaymentStatusBadge status={sub.paymentStatus} />
                  <GraceStatusBadge status={sub.graceOrLock} />
                  {sub.exportLocked && <Badge variant="destructive">Export Locked</Badge>}
                </>
              }
            />
            <OrgCardBody>
              <dl className="grid grid-cols-2 sm:grid-cols-4" style={{ gap: "20px 32px" }}>
                <InfoField label="Plan">{sub.planName}</InfoField>
                <InfoField label="Term">{termLabel(sub.termMonths)}</InfoField>
                <InfoField label="Start Date">{formatDate(sub.startsAt)}</InfoField>
                <InfoField label="Expiry Date">{formatDate(sub.expiresAt)}</InfoField>
                <InfoField label="Days Remaining">{daysRemainingLabel(sub.daysRemaining)}</InfoField>
                <UsageField label="Branches" used={org.usage.branchesUsed} limit={branchLimit} />
                <UsageField label="Users" used={org.usage.usersUsed} limit={staffLimit} />
                <InfoField label="Payment Status"><PaymentStatusBadge status={sub.paymentStatus} /></InfoField>
              </dl>
            </OrgCardBody>
          </OrgCard>

          {/* Row 2 – Management */}
          <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 20 }}>
            {/* Manage Subscription */}
            <OrgCard>
              <OrgCardHeader title="Manage Subscription" subtitle="Update the organization's subscription." />
              <OrgCardBody style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <FormField label="Plan">
                  <FilterSelect
                    value={patchPlan}
                    onChange={(v) => setPatchPlan(v as PlanCode)}
                    disabled={patching}
                    fullWidth
                    options={
                      planOptions.some((o) => o.value === patchPlan)
                        ? planOptions
                        : [{ value: patchPlan, label: patchPlan }, ...planOptions]
                    }
                  />
                </FormField>
                <FormField label="Status">
                  <FilterSelect
                    value={patchStatus}
                    onChange={setPatchStatus}
                    disabled={patching}
                    fullWidth
                    options={["TRIAL","ACTIVE","PAST_DUE","EXPIRED","CANCELLED"].map((s) => ({ value: s, label: s }))}
                  />
                </FormField>
                <FormField label="Term (months)">
                  <FilterSelect
                    value={patchTermMonths}
                    onChange={setPatchTermMonths}
                    disabled={patching}
                    fullWidth
                    options={["1","3","12","24","36","60"].map((s) => ({ value: s, label: s }))}
                  />
                </FormField>
                <FormField label="Expiry date">
                  <Input type="date" value={patchExpiresAt} onChange={(e) => setPatchExpiresAt(e.target.value)} disabled={patching} />
                </FormField>
                <FormField label="Custom max branches">
                  <Input placeholder="Leave blank for plan default" value={patchMaxBranches} onChange={(e) => setPatchMaxBranches(e.target.value)} disabled={patching} />
                </FormField>
                <FormField label="Custom max users">
                  <Input placeholder="Leave blank for plan default" value={patchMaxUsers} onChange={(e) => setPatchMaxUsers(e.target.value)} disabled={patching} />
                </FormField>
                <FormField label="Dedicated billing email">
                  <Input type="email" placeholder="accounts@client.com" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} disabled={patching} />
                </FormField>
                <FormField label="Notes (optional)">
                  <Input placeholder="Internal note…" value={patchNotes} onChange={(e) => setPatchNotes(e.target.value)} disabled={patching} />
                </FormField>
                <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
                  <Button onClick={handlePatchSubscription} disabled={patching} className="min-w-30">
                    {patching ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : "Save Changes"}
                  </Button>
                </div>
                {(() => {
                  const oldAmt = estimatePlanAmount(sub.planCode, sub.termMonths || 12, pricing);
                  const credit = prorateCredit({ oldAmount: oldAmt, oldTermMonths: sub.termMonths || 12, daysRemaining: sub.daysRemaining });
                  return (
                    <p style={{ margin: 0, fontSize: 12, color: "var(--muted-foreground)" }}>
                      Mid-cycle upgrade credit (unused term): {formatCurrency(credit, pricing?.currency)} — apply when changing plan.
                    </p>
                  );
                })()}
              </OrgCardBody>
            </OrgCard>

            {/* Quick Actions */}
            <OrgCard>
              <OrgCardHeader title="Quick Actions" subtitle="Perform administrative actions on this organization." />
              <OrgCardBody>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <button
                    type="button"
                    onClick={handleDownloadZip}
                    disabled={exportingZip || lifecycleLoading}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "rgba(80,176,160,0.12)", border: "1px solid var(--border)", borderRadius: 10, cursor: exportingZip ? "not-allowed" : "pointer", opacity: exportingZip ? 0.7 : 1, textAlign: "left" }}
                  >
                    <span style={{ flexShrink: 0, width: 34, height: 34, background: "rgba(80,176,160,0.2)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <FileDown style={{ width: 16, height: 16, color: "#50B0A0" }} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
                        {exportingZip ? "Preparing download…" : "Download All Data (ZIP)"}
                      </span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>
                        Org, subscription, payments, bills, users, branches, audit & activity CSVs
                      </span>
                    </span>
                    {exportingZip && <Loader2 className="animate-spin" style={{ width: 14, height: 14, color: "var(--muted-foreground)", flexShrink: 0 }} />}
                  </button>

                  <button
                    type="button"
                    onClick={handleImpersonate}
                    disabled={impersonating || lifecycleLoading}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "rgba(59,130,246,0.1)", border: "1px solid var(--border)", borderRadius: 10, cursor: impersonating ? "not-allowed" : "pointer", textAlign: "left", opacity: impersonating ? 0.7 : 1 }}
                  >
                    <span style={{ flexShrink: 0, width: 34, height: 34, background: "rgba(59,130,246,0.18)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <LogIn style={{ width: 16, height: 16, color: "#2563eb" }} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{impersonating ? "Opening…" : "Login as Customer"}</span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>Support impersonation (requires backend)</span>
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadPdf}
                    disabled={lifecycleLoading}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "rgba(99,120,150,0.1)", border: "1px solid var(--border)", borderRadius: 10, cursor: "pointer", textAlign: "left" }}
                  >
                    <span style={{ flexShrink: 0, width: 34, height: 34, background: "rgba(99,120,150,0.18)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <FileText style={{ width: 16, height: 16, color: "#475569" }} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
                        Download Summary PDF
                      </span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>
                        One-page organization & subscription overview
                      </span>
                    </span>
                  </button>

                  {org.subscription.status === "TRIAL" && (
                  <button
                    type="button"
                    onClick={() => setConvertTrialOpen(true)}
                    disabled={convertTrialLoading || lifecycleLoading}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "rgba(16,185,129,0.12)", border: "1px solid var(--border)", borderRadius: 10, cursor: convertTrialLoading ? "not-allowed" : "pointer", opacity: convertTrialLoading ? 0.7 : 1, textAlign: "left", transition: "background 0.12s" }}
                  >
                    <span style={{ flexShrink: 0, width: 34, height: 34, background: "rgba(16,185,129,0.2)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <CheckCircle2 style={{ width: 16, height: 16, color: "#059669" }} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
                        {convertTrialLoading ? "Converting…" : "Convert Trial"}
                      </span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>
                        Move TRIAL → ACTIVE (manual; no payment gateway)
                      </span>
                    </span>
                    {convertTrialLoading && <Loader2 className="animate-spin" style={{ width: 14, height: 14, color: "var(--muted-foreground)", flexShrink: 0 }} />}
                  </button>
                  )}

                  <button
                    type="button"
                    onClick={openPayLink}
                    disabled={payLinkLoading || lifecycleLoading}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "rgba(80,176,160,0.14)", border: "1px solid #B8E0D8", borderRadius: 10, cursor: payLinkLoading ? "not-allowed" : "pointer", opacity: payLinkLoading ? 0.7 : 1, textAlign: "left" }}
                  >
                    <span style={{ flexShrink: 0, width: 34, height: 34, background: "rgba(80,176,160,0.22)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Link2 style={{ width: 16, height: 16, color: "#3D8F82" }} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
                        Send payment link
                      </span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>
                        Owner pays online for a chosen plan (email / SMS / WhatsApp)
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMarkPaidOpen(true)}
                    disabled={markPaidLoading || lifecycleLoading}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "rgba(99,120,150,0.12)", border: "1px solid var(--border)", borderRadius: 10, cursor: markPaidLoading ? "not-allowed" : "pointer", opacity: markPaidLoading ? 0.7 : 1, textAlign: "left", transition: "background 0.12s" }}
                    onMouseEnter={(e) => { if (!markPaidLoading) e.currentTarget.style.background = "rgba(99,120,150,0.22)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(99,120,150,0.12)"; }}
                  >
                    <span style={{ flexShrink: 0, width: 34, height: 34, background: "rgba(59,130,246,0.15)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <CreditCard style={{ width: 16, height: 16, color: "#50B0A0" }} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
                        {markPaidLoading ? "Processing…" : "Mark as Paid"}
                      </span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>
                        Activate subscription and record payment
                      </span>
                    </span>
                    {markPaidLoading && <Loader2 className="animate-spin" style={{ width: 14, height: 14, color: "var(--muted-foreground)", flexShrink: 0 }} />}
                  </button>

                  {org.subscription.status === "CANCELLED" ? (
                    <button
                      type="button"
                      onClick={() => setRestoreOpen(true)}
                      disabled={lifecycleLoading}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, cursor: lifecycleLoading ? "not-allowed" : "pointer", opacity: lifecycleLoading ? 0.7 : 1, textAlign: "left" }}
                    >
                      <span style={{ flexShrink: 0, width: 34, height: 34, background: "#dcfce7", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <CheckCircle2 style={{ width: 16, height: 16, color: "#16a34a" }} />
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>Restore Organization</span>
                        <span style={{ display: "block", fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>Set subscription status back to ACTIVE</span>
                      </span>
                      {lifecycleLoading && <Loader2 className="animate-spin" style={{ width: 14, height: 14, color: "var(--muted-foreground)", flexShrink: 0 }} />}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setSuspendReason("Admin suspension"); setSuspendOpen(true); }}
                      disabled={lifecycleLoading}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, cursor: lifecycleLoading ? "not-allowed" : "pointer", opacity: lifecycleLoading ? 0.7 : 1, textAlign: "left" }}
                    >
                      <span style={{ flexShrink: 0, width: 34, height: 34, background: "#fee2e2", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <AlertTriangle style={{ width: 16, height: 16, color: "#dc2626" }} />
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>Suspend Organization</span>
                        <span style={{ display: "block", fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>Cancel subscription and restrict access</span>
                      </span>
                      {lifecycleLoading && <Loader2 className="animate-spin" style={{ width: 14, height: 14, color: "var(--muted-foreground)", flexShrink: 0 }} />}
                    </button>
                  )}
                </div>
              </OrgCardBody>
            </OrgCard>
          </div>

          {/* Row 3 – Payments + Bills */}
          <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 20 }}>
            {/* Payments */}
            <OrgCard>
              <OrgCardHeader title="Payments" subtitle={`${payments.length} record${payments.length !== 1 ? "s" : ""}`} />
              <OrgCardBody>
                {payments.length === 0 ? (
                  <EmptyState icon={CreditCard} message="No payments recorded yet." />
                ) : (
                  <InlineTable heads={[{ label: "Amount" }, { label: "Method" }, { label: "Status" }, { label: "Date" }, { label: "" }]}>
                    {payments.map((p: SubscriptionPaymentRow, idx: number) => (
                      <InlineRow key={p.id} idx={idx}>
                        <InlineTd bold>{p.amount != null ? formatCurrency(p.amount, p.currency) : "—"}</InlineTd>
                        <InlineTd muted>{p.method ?? "—"}</InlineTd>
                        <InlineTd><PaymentStatusBadge status={p.status} /></InlineTd>
                        <InlineTd muted>{formatDateTime(p.createdAt)}</InlineTd>
                        <InlineTd>
                          {needsManualPaymentReview(p) && (
                            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!!verifyingPaymentId}
                                onClick={() => handleVerifyPayment(p, "PAID")}
                                className="shrink-0 whitespace-nowrap text-emerald-600 border-emerald-200 hover:bg-emerald-50 h-8 min-w-[72px] px-3 text-xs gap-1.5"
                              >
                                {verifyingPaymentId === p.id ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                                Paid
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!!verifyingPaymentId}
                                onClick={() => handleVerifyPayment(p, "FAILED")}
                                className="shrink-0 whitespace-nowrap text-red-600 border-red-200 hover:bg-red-50 h-8 min-w-[72px] px-3 text-xs gap-1.5"
                              >
                                {verifyingPaymentId === p.id ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <XCircle className="h-3.5 w-3.5 shrink-0" />}
                                Failed
                              </Button>
                            </div>
                          )}
                        </InlineTd>
                      </InlineRow>
                    ))}
                  </InlineTable>
                )}
              </OrgCardBody>
            </OrgCard>

            {/* Bills */}
            <OrgCard>
              <OrgCardHeader title="Bills" subtitle={`${bills.length} record${bills.length !== 1 ? "s" : ""}`} />
              <OrgCardBody>
                {bills.length === 0 ? (
                  <EmptyState icon={FileText} message="No bills generated yet." />
                ) : (
                  <InlineTable heads={[{ label: "Bill #" }, { label: "Plan" }, { label: "Term" }, { label: "Base", align: "right" }, { label: "GST", align: "right" }, { label: "Total", align: "right" }, { label: "Payment" }, { label: "Tax PDF" }]}>
                    {bills.map((b: SubscriptionBillRow, idx: number) => (
                      <InlineRow key={b.id} idx={idx}>
                        <InlineTd bold>{b.billNumber}</InlineTd>
                        <InlineTd muted>{b.planName}</InlineTd>
                        <InlineTd muted>{b.termLabel}</InlineTd>
                        <InlineTd align="right">{formatCurrency(b.baseAmount, b.currency)}</InlineTd>
                        <InlineTd align="right" muted>{formatCurrency(b.gstAmount, b.currency)}</InlineTd>
                        <InlineTd align="right" bold>{formatCurrency(b.totalAmount, b.currency)}</InlineTd>
                        <InlineTd><PaymentStatusBadge status={b.paymentStatus} /></InlineTd>
                        <InlineTd>
                          <button type="button" onClick={() => downloadTaxInvoicePdf(b, org.organization.name)} style={{ fontSize: 12, color: "#50B0A0", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>PDF</button>
                        </InlineTd>
                      </InlineRow>
                    ))}
                  </InlineTable>
                )}
              </OrgCardBody>
            </OrgCard>
          </div>

          {/* Row 4 – Staff / Users (matches workshop directory split) */}
          <OrgCard>
            <OrgCardHeader
              title="Users & Staff"
              subtitle={
                orgDirectoryLoading
                  ? "Loading…"
                  : `${staffDirectory.length} staff · ${usersDirectory.length} user${usersDirectory.length !== 1 ? "s" : ""}`
              }
            />
            <OrgCardBody>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                {(
                  [
                    { id: "staff" as const, label: "Staff", count: staffDirectory.length, icon: UserCog },
                    { id: "users" as const, label: "Users", count: usersDirectory.length, icon: Users },
                  ] as const
                ).map((tab) => {
                  const active = peopleTab === tab.id;
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setPeopleTab(tab.id)}
                      style={{
                        height: 34,
                        padding: "0 14px",
                        borderRadius: 8,
                        border: active ? "1px solid #50B0A0" : "1px solid var(--border)",
                        background: active ? "#EFF8F6" : "var(--card)",
                        color: active ? "#2F7D70" : "var(--foreground)",
                        fontSize: 13,
                        fontWeight: active ? 600 : 500,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <Icon style={{ width: 14, height: 14 }} />
                      {tab.label}
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "1px 7px",
                          borderRadius: 999,
                          background: active ? "#D5EFEA" : "var(--secondary)",
                          color: active ? "#2F7D70" : "var(--muted-foreground)",
                        }}
                      >
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {orgDirectoryLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[0, 1, 2].map((i) => <Skel key={i} h={40} />)}
                </div>
              ) : peopleRows.length === 0 ? (
                <EmptyState
                  icon={peopleTab === "staff" ? UserCog : Users}
                  message={
                    peopleTab === "staff"
                      ? "No staff in this organization (mechanics and other non-seat roles)."
                      : "No users in this organization (Super Admin, admins, managers, receptionists)."
                  }
                />
              ) : (
                <InlineTable heads={[{ label: "Name" }, { label: "Contact" }, { label: "Branch" }, { label: "Role" }, { label: "Status" }, { label: "Last login" }]}>
                  {peopleRows.map((u, idx) => (
                    <InlineRow key={u.id} idx={idx}>
                      <InlineTd>
                        <div style={{ fontWeight: 600 }}>{u.name}</div>
                        <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>{u.email}</div>
                      </InlineTd>
                      <InlineTd muted>{u.phone ?? "—"}</InlineTd>
                      <InlineTd muted>{u.branchName ?? "—"}</InlineTd>
                      <InlineTd>
                        <Badge variant={peopleTab === "users" ? "info" : u.role === "SUPER_ADMIN" ? "default" : "success"}>
                          {roleDisplayLabel(u.role)}
                        </Badge>
                      </InlineTd>
                      <InlineTd>
                        <Badge variant={u.isActive ? "success" : "muted"}>{u.isActive ? "Active" : "Inactive"}</Badge>
                      </InlineTd>
                      <InlineTd muted>{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "—"}</InlineTd>
                    </InlineRow>
                  ))}
                </InlineTable>
              )}
            </OrgCardBody>
          </OrgCard>

          {/* Row 5 – Branches (org-scoped) */}
          <OrgCard>
            <OrgCardHeader
              title="Branches"
              subtitle={orgDirectoryLoading ? "Loading…" : `${orgBranches.length} branch${orgBranches.length !== 1 ? "es" : ""} in this organization`}
              right={
                <Button
                  size="sm"
                  onClick={() => {
                    resetBranchForm();
                    setAddBranchOpen(true);
                  }}
                  className="shrink-0 whitespace-nowrap"
                  style={{ paddingLeft: 14, paddingRight: 14, gap: 6 }}
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  Add branch
                </Button>
              }
            />
            <OrgCardBody>
              {orgDirectoryLoading ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
                  {[0, 1].map((i) => <Skel key={i} h={110} />)}
                </div>
              ) : orgBranches.length === 0 ? (
                <EmptyState icon={Building2} message="No branches yet. Click Add branch to create one." />
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
                  {orgBranches.map((b) => {
                    const location = [b.city, b.state].filter(Boolean).join(", ") || b.address || "—";
                    return (
                      <div
                        key={b.id}
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          padding: "14px 16px",
                          background: "rgba(248,250,252,0.6)",
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>{b.name}</div>
                            {b.code && (
                              <div style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "monospace", marginTop: 2 }}>{b.code}</div>
                            )}
                          </div>
                          <Badge variant={b.isActive ? "success" : "muted"}>{b.isActive ? "Active" : "Inactive"}</Badge>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted-foreground)" }}>
                          <MapPin style={{ width: 13, height: 13, flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{location}</span>
                        </div>
                        {b.phone && (
                          <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Phone: {b.phone}</div>
                        )}
                        {(b.managerName || b.managerPhone) && (
                          <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                            Manager: {[b.managerName, b.managerPhone].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </OrgCardBody>
          </OrgCard>

          {/* Row 6 – Organization Activity (Workshop activityLogs) */}
          <OrgCard>
            <OrgCardHeader
              title="Organization Activity"
              subtitle="Workshop operational events for this organization only"
            />
            <OrgCardBody>
              <OrganizationActivityPanel
                organizationId={org.organization.id}
                organizationName={org.organization.name}
                embedded
                pageSize={20}
              />
            </OrgCardBody>
          </OrgCard>

          {/* Row 7 – Platform audit (org-scoped SaaS events) */}
          <OrgCard>
            <OrgCardHeader
              title="Platform Audit"
              subtitle={
                orgDirectoryLoading
                  ? "Loading…"
                  : `${orgLogs.length} platform event${orgLogs.length !== 1 ? "s" : ""} for this organization`
              }
            />
            <OrgCardBody>
              {orgDirectoryLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[0, 1, 2].map((i) => <Skel key={i} h={36} />)}
                </div>
              ) : orgLogs.length === 0 ? (
                <EmptyState icon={ClipboardList} message="No platform audit events for this organization." />
              ) : (
                <PlatformAuditList rows={orgLogs} />
              )}
            </OrgCardBody>
          </OrgCard>

          {/* Row 8 – Danger Zone */}
          <div
            style={{
              background: "var(--card)",
              border: "1px solid #fecaca",
              borderRadius: 14,
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid #fee2e2",
                background: "#fef2f2",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#991b1b" }}>
                  Danger Zone
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: 13, color: "#b91c1c" }}>
                  Irreversible actions for this organization
                </p>
              </div>
            </div>
            <div
              style={{
                padding: "20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <div>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--foreground)" }}>
                  Delete this organization
                </p>
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 13,
                    color: "var(--muted-foreground)",
                    maxWidth: 640,
                    lineHeight: 1.5,
                  }}
                >
                  Permanently delete <strong style={{ color: "var(--foreground)" }}>{org.organization.name}</strong>{" "}
                  (<code style={{ fontSize: 12 }}>{org.organization.id}</code>) and all associated data including branches,
                  users, job cards, invoices, vehicles, customers, and subscription records directly from the database.
                  This action is permanent and cannot be undone.
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={() => {
                  setDeleteConfirmInput("");
                  setDeleteOpen(true);
                }}
                style={{
                  background: "#dc2626",
                  color: "#ffffff",
                  minWidth: 160,
                }}
              >
                Delete organization
              </Button>
            </div>
          </div>

        </div>
      </div>

      {/* Send Payment Link Modal */}
      {payLinkOpen && org && (() => {
        const quote = estimateCheckoutQuote(
          payLinkPlan,
          Number(payLinkTerm),
          pricing,
          {
            extraBranches: Number(payLinkExtraBranches) || 0,
            extraUsers: Number(payLinkExtraUsers) || 0,
            discountType: payLinkDiscountType,
            discountValue: Number(payLinkDiscountValue) || 0,
            isFirstSubscription: org.subscription.status === "TRIAL" || !bills.length,
          }
        );
        const softLabel: React.CSSProperties = {
          fontSize: 13,
          fontWeight: 500,
          color: "var(--foreground)",
          marginBottom: 6,
        };
        const sectionTitle: React.CSSProperties = {
          fontSize: 12,
          fontWeight: 600,
          color: "var(--muted-foreground)",
          margin: "0 0 10px",
          letterSpacing: "0.02em",
        };
        return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
          <div style={{ background: "var(--card)", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.18)", width: "100%", maxWidth: 780, overflow: "hidden", border: "1px solid var(--border)" }}>
            <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "var(--foreground)" }}>Send payment link</h2>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted-foreground)" }}>
                  For <strong style={{ color: "var(--foreground)", fontWeight: 600 }}>{org.organization.name}</strong> — they pay online; plan activates after payment.
                </p>
              </div>
              {!payLinkResult && (
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>Amount due</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#3D8F82" }}>{formatCurrency(quote.finalAmount, quote.currency)}</div>
                </div>
              )}
            </div>

            {!payLinkResult ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-[1.35fr_0.9fr]" style={{ gap: 0 }}>
                  <div className="md:border-r md:border-[var(--border)]" style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
                    <div>
                      <p style={sectionTitle}>1. Plan</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 12 }}>
                        <div>
                          <div style={softLabel}>Plan</div>
                          <FilterSelect
                            value={payLinkPlan}
                            onChange={(v) => setPayLinkPlan(v as PlanCode)}
                            disabled={payLinkLoading}
                            fullWidth
                            options={
                              planOptions.some((o) => o.value === payLinkPlan)
                                ? planOptions
                                : [{ value: payLinkPlan, label: payLinkPlan }, ...planOptions]
                            }
                          />
                        </div>
                        <div>
                          <div style={softLabel}>Billing term</div>
                          <FilterSelect
                            value={payLinkTerm}
                            onChange={(v) => setPayLinkTerm(v as typeof payLinkTerm)}
                            disabled={payLinkLoading}
                            fullWidth
                            options={[
                              { value: "1", label: "Monthly" },
                              { value: "3", label: "Quarterly" },
                              { value: "12", label: "1 Year" },
                              { value: "24", label: "2 Years" },
                              { value: "36", label: "3 Years" },
                              { value: "60", label: "5 Years" },
                            ]}
                          />
                        </div>
                        <div>
                          <div style={softLabel}>Extra branches</div>
                          <Input type="number" min={0} value={payLinkExtraBranches} onChange={(e) => setPayLinkExtraBranches(e.target.value)} disabled={payLinkLoading} />
                        </div>
                        <div>
                          <div style={softLabel}>Extra users</div>
                          <Input type="number" min={0} value={payLinkExtraUsers} onChange={(e) => setPayLinkExtraUsers(e.target.value)} disabled={payLinkLoading} />
                        </div>
                      </div>
                    </div>

                    <div>
                      <p style={sectionTitle}>2. Discount</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 12 }}>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <div style={softLabel}>Discount type</div>
                          <FilterSelect
                            value={payLinkDiscountType}
                            onChange={(v) => setPayLinkDiscountType(v as PaymentLinkDiscountType)}
                            disabled={payLinkLoading}
                            fullWidth
                            options={[
                              { value: "NONE", label: "No discount" },
                              { value: "FLAT", label: "Flat amount (₹)" },
                              { value: "PERCENTAGE", label: "Percentage (%)" },
                              { value: "CODE", label: "Referral / coupon code" },
                            ]}
                          />
                        </div>
                        {(payLinkDiscountType === "FLAT" || payLinkDiscountType === "PERCENTAGE") && (
                          <div>
                            <div style={softLabel}>
                              {payLinkDiscountType === "FLAT" ? "Discount amount (₹)" : "Discount percent (%)"}
                            </div>
                            <Input
                              type="number"
                              min={0}
                              max={payLinkDiscountType === "PERCENTAGE" ? 100 : undefined}
                              placeholder={payLinkDiscountType === "FLAT" ? "e.g. 1000" : "e.g. 10"}
                              value={payLinkDiscountValue}
                              onChange={(e) => setPayLinkDiscountValue(e.target.value)}
                              disabled={payLinkLoading}
                            />
                          </div>
                        )}
                        {payLinkDiscountType === "CODE" && (
                          <div style={{ gridColumn: "1 / -1" }}>
                            <div style={softLabel}>Referral or coupon code</div>
                            <Input
                              placeholder="e.g. REFA89F2"
                              value={payLinkReferral}
                              onChange={(e) => setPayLinkReferral(e.target.value.toUpperCase())}
                              disabled={payLinkLoading}
                            />
                            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted-foreground)" }}>
                              Uses the code’s configured discount from Referrals.
                            </p>
                          </div>
                        )}
                        <div style={{ gridColumn: "1 / -1" }}>
                          <div style={softLabel}>Internal note <span style={{ fontWeight: 400, color: "var(--muted-foreground)" }}>(optional)</span></div>
                          <Input placeholder="e.g. Inbound call — Growth annual with 10% off" value={payLinkNotes} onChange={(e) => setPayLinkNotes(e.target.value)} disabled={payLinkLoading} />
                        </div>
                      </div>
                    </div>

                    <div>
                      <p style={sectionTitle}>3. Send to owner</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 12 }}>
                        <div>
                          <div style={softLabel}>Email</div>
                          <Input type="email" value={payLinkEmail} onChange={(e) => setPayLinkEmail(e.target.value)} disabled={payLinkLoading} />
                        </div>
                        <div>
                          <div style={softLabel}>Phone</div>
                          <Input value={payLinkPhone} onChange={(e) => setPayLinkPhone(e.target.value)} disabled={payLinkLoading} />
                        </div>
                        <div style={{ gridColumn: "1 / -1", display: "flex", flexWrap: "wrap", gap: 8 }}>
                          {(
                            [
                              { key: "email" as const, label: "Email", checked: payLinkSendEmail, set: setPayLinkSendEmail },
                              { key: "sms" as const, label: "SMS", checked: payLinkSendSms, set: setPayLinkSendSms },
                              { key: "whatsapp" as const, label: "WhatsApp", checked: payLinkSendWhatsapp, set: setPayLinkSendWhatsapp },
                            ]
                          ).map((ch) => (
                            <label
                              key={ch.key}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 8,
                                height: 34,
                                padding: "0 12px",
                                borderRadius: 8,
                                border: `1px solid ${ch.checked ? "#A8D9D0" : "var(--border)"}`,
                                background: ch.checked ? "#EFF8F6" : "transparent",
                                fontSize: 13,
                                fontWeight: 500,
                                cursor: "pointer",
                                color: "var(--foreground)",
                              }}
                            >
                              <input type="checkbox" checked={ch.checked} onChange={(e) => ch.set(e.target.checked)} disabled={payLinkLoading} />
                              {ch.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ padding: "18px 22px", background: "var(--secondary)" }}>
                    <p style={sectionTitle}>Price summary</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                      {[
                        ["Plan", formatCurrency(quote.baseAmount, quote.currency)],
                        ...(quote.extraBranchCost + quote.extraUserCost > 0
                          ? [["Extras", formatCurrency(quote.extraBranchCost + quote.extraUserCost, quote.currency)] as const]
                          : []),
                        ...(quote.onboardingFee > 0
                          ? [["Onboarding", formatCurrency(quote.onboardingFee, quote.currency)] as const]
                          : []),
                        [quote.discountLabel, quote.referralDiscount > 0 ? `−${formatCurrency(quote.referralDiscount, quote.currency)}` : "—"],
                        [`GST (${quote.gstPercent}%)`, formatCurrency(quote.gstAmount, quote.currency)],
                      ].map(([label, value]) => (
                        <div key={String(label)} style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "var(--muted-foreground)" }}>
                          <span>{label}</span>
                          <span style={{ color: "var(--foreground)", fontWeight: 500 }}>{value}</span>
                        </div>
                      ))}
                      <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span style={{ fontWeight: 600, color: "var(--foreground)" }}>Total</span>
                        <span style={{ fontSize: 18, fontWeight: 700, color: "#3D8F82" }}>{formatCurrency(quote.finalAmount, quote.currency)}</span>
                      </div>
                    </div>
                    <p style={{ margin: "14px 0 0", fontSize: 11, color: "var(--muted-foreground)", lineHeight: 1.45 }}>
                      Gateway confirms the final charged amount. After payment, the subscription updates automatically.
                    </p>
                  </div>
                </div>
                <div style={{ padding: "14px 22px", display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--border)" }}>
                  <Button variant="outline" onClick={() => setPayLinkOpen(false)} disabled={payLinkLoading} style={{ minWidth: 100 }}>Cancel</Button>
                  <Button onClick={handleCreatePayLink} disabled={payLinkLoading} className="min-w-40">
                    {payLinkLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</> : "Generate & send"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div style={{ padding: "14px 20px", display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginBottom: 8 }}>
                      Amount <strong style={{ color: "var(--foreground)" }}>{formatCurrency(payLinkResult.amount, payLinkResult.currency)}</strong>
                      {payLinkResult.gateway ? ` · ${payLinkResult.gateway}` : ""}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <Input readOnly value={payLinkResult.paymentLinkUrl} style={{ fontSize: 12 }} />
                      <Button type="button" variant="outline" size="sm" onClick={handleCopyPayLink} aria-label="Copy link">
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => window.open(payLinkResult.paymentLinkUrl, "_blank", "noopener,noreferrer")} aria-label="Open link">
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <Button type="button" variant="outline" size="sm" disabled={!!payLinkResending || !payLinkResult.paymentId} onClick={() => handleResendPayLink("email")}>
                      {payLinkResending === "email" ? "Sending…" : "Resend email"}
                    </Button>
                    <Button type="button" variant="outline" size="sm" disabled={!!payLinkResending || !payLinkResult.paymentId} onClick={() => handleResendPayLink("sms")}>
                      {payLinkResending === "sms" ? "Sending…" : "Resend SMS"}
                    </Button>
                    <Button type="button" variant="outline" size="sm" disabled={!!payLinkResending || !payLinkResult.paymentId} onClick={() => handleResendPayLink("whatsapp")}>
                      {payLinkResending === "whatsapp" ? "Sending…" : "Resend WhatsApp"}
                    </Button>
                  </div>
                </div>
                <div style={{ padding: "12px 20px 16px", display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--border)" }}>
                  <Button variant="outline" onClick={() => { setPayLinkResult(null); }}>Create another</Button>
                  <Button onClick={() => setPayLinkOpen(false)}>Done</Button>
                </div>
              </>
            )}
          </div>
        </div>
        );
      })()}

      {/* Mark Paid Modal */}
      {markPaidOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "12px" }}>
          <div style={{ background: "var(--card)", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.18)", width: "100%", maxWidth: 440, overflow: "hidden" }}>
            <div style={{ padding: "24px 24px 0" }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--foreground)" }}>Mark Subscription Paid</h2>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                This will immediately activate the subscription for{" "}
                <strong style={{ color: "var(--foreground)" }}>{org.organization.name}</strong>.
                A renewal record and bill will be generated.
              </p>
            </div>
            <div style={{ padding: "clamp(12px, 2.5vw, 20px) clamp(12px, 3vw, 24px)", display: "flex", flexDirection: "column", gap: 14 }}>
              <FormField label="Amount Received (optional)">
                <Input type="number" placeholder=" e.g. 9999" value={markPaidAmount} onChange={(e) => setMarkPaidAmount(e.target.value)} disabled={markPaidLoading} />
              </FormField>
              <FormField label="Transaction Reference">
                <Input placeholder=" e.g. UTR123456789" value={markPaidTxn} onChange={(e) => setMarkPaidTxn(e.target.value)} disabled={markPaidLoading} />
              </FormField>
              <FormField label="Admin Notes">
                <Input placeholder=" e.g. Cash payment received" value={markPaidNotes} onChange={(e) => setMarkPaidNotes(e.target.value)} disabled={markPaidLoading} />
              </FormField>
            </div>
            <div style={{ padding: "12px 24px 20px", display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--border)" }}>
              <Button variant="outline" onClick={() => setMarkPaidOpen(false)} disabled={markPaidLoading} style={{ minWidth: 100 }}>Cancel</Button>
              <Button onClick={handleMarkPaid} disabled={markPaidLoading} className="min-w-35">
                {markPaidLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Confirming…</> : "Confirm Mark Paid"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Convert Trial Modal */}
      {convertTrialOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "12px" }}>
          <div style={{ background: "var(--card)", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.18)", width: "100%", maxWidth: 440, overflow: "hidden" }}>
            <div style={{ padding: "24px 24px 0" }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--foreground)" }}>Convert Trial</h2>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                Convert the trial for{" "}
                <strong style={{ color: "var(--foreground)" }}>{org.organization.name}</strong>{" "}
                to an ACTIVE subscription. This does not charge a payment gateway — it activates with markPaid=true (manual conversion).
              </p>
            </div>
            <div style={{ padding: "12px 24px 20px", display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--border)", marginTop: 20 }}>
              <Button variant="outline" onClick={() => setConvertTrialOpen(false)} disabled={convertTrialLoading} style={{ minWidth: 100 }}>Cancel</Button>
              <Button onClick={handleConvertTrial} disabled={convertTrialLoading} className="min-w-35">
                {convertTrialLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Converting…</> : "Convert to Active"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Suspend Modal */}
      {suspendOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "12px" }}>
          <div style={{ background: "var(--card)", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.18)", width: "100%", maxWidth: 440, overflow: "hidden" }}>
            <div style={{ padding: "24px 24px 0" }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--foreground)" }}>Suspend Organization</h2>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                This will cancel the subscription and restrict access for{" "}
                <strong style={{ color: "var(--foreground)" }}>{org.organization.name}</strong>.
                A reason is required.
              </p>
            </div>
            <div style={{ padding: "clamp(12px, 2.5vw, 20px) clamp(12px, 3vw, 24px)", display: "flex", flexDirection: "column", gap: 14 }}>
              <FormField label="Suspension reason">
                <Input
                  placeholder="e.g. Non-payment / policy violation"
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  disabled={lifecycleLoading}
                  autoFocus
                />
              </FormField>
            </div>
            <div style={{ padding: "12px 24px 20px", display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--border)" }}>
              <Button
                variant="outline"
                onClick={() => { setSuspendOpen(false); setSuspendReason("Admin suspension"); }}
                disabled={lifecycleLoading}
                style={{ minWidth: 100 }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleSuspend}
                disabled={lifecycleLoading || !suspendReason.trim()}
                className="min-w-35"
              >
                {lifecycleLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Suspending…</> : "Suspend"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Modal */}
      {restoreOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "12px" }}>
          <div style={{ background: "var(--card)", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.18)", width: "100%", maxWidth: 440, overflow: "hidden" }}>
            <div style={{ padding: "24px 24px 0" }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--foreground)" }}>Restore Organization</h2>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                Restore{" "}
                <strong style={{ color: "var(--foreground)" }}>{org.organization.name}</strong>{" "}
                and set the subscription status back to ACTIVE.
              </p>
            </div>
            <div style={{ padding: "12px 24px 20px", display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--border)", marginTop: 20 }}>
              <Button variant="outline" onClick={() => setRestoreOpen(false)} disabled={lifecycleLoading} style={{ minWidth: 100 }}>Cancel</Button>
              <Button onClick={handleRestore} disabled={lifecycleLoading} className="min-w-35">
                {lifecycleLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Restoring…</> : "Restore"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add Branch Modal */}
      {addBranchOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "12px" }}>
          <div style={{ background: "var(--card)", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.18)", width: "100%", maxWidth: 520, maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ padding: "24px 24px 0" }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--foreground)" }}>Add branch</h2>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                Create a workshop location for{" "}
                <strong style={{ color: "var(--foreground)" }}>{org.organization.name}</strong>.
                {branchLimit != null && org.usage.branchesUsed >= branchLimit && (
                  <> If the plan is at its branch cap ({org.usage.branchesUsed}/{branchLimit}), the limit will be raised automatically.</>
                )}
              </p>
            </div>
            <div style={{ padding: "clamp(12px, 2.5vw, 20px) clamp(12px, 3vw, 24px)", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 12 }}>
                <FormField label="Branch name *">
                  <Input
                    placeholder="e.g. Kahalgaon"
                    value={branchForm.name}
                    onChange={(e) => setBranchForm((f) => ({ ...f, name: e.target.value }))}
                    disabled={addBranchLoading}
                    autoFocus
                  />
                </FormField>
                <FormField label="Code">
                  <Input
                    placeholder="e.g. KHL"
                    value={branchForm.code}
                    onChange={(e) => setBranchForm((f) => ({ ...f, code: e.target.value }))}
                    disabled={addBranchLoading}
                  />
                </FormField>
              </div>
              <FormField label="Address *">
                <Input
                  placeholder="Street / area"
                  value={branchForm.address}
                  onChange={(e) => setBranchForm((f) => ({ ...f, address: e.target.value }))}
                  disabled={addBranchLoading}
                />
              </FormField>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px", gap: 12 }}>
                <FormField label="City">
                  <Input
                    value={branchForm.city}
                    onChange={(e) => setBranchForm((f) => ({ ...f, city: e.target.value }))}
                    disabled={addBranchLoading}
                  />
                </FormField>
                <FormField label="State">
                  <Input
                    value={branchForm.state}
                    onChange={(e) => setBranchForm((f) => ({ ...f, state: e.target.value }))}
                    disabled={addBranchLoading}
                  />
                </FormField>
                <FormField label="PIN">
                  <Input
                    value={branchForm.pincode}
                    onChange={(e) => setBranchForm((f) => ({ ...f, pincode: e.target.value }))}
                    disabled={addBranchLoading}
                  />
                </FormField>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <FormField label="Phone *">
                  <Input
                    inputMode="numeric"
                    placeholder="10-digit mobile"
                    value={branchForm.phone}
                    onChange={(e) =>
                      setBranchForm((f) => ({
                        ...f,
                        phone: e.target.value.replace(/\D/g, "").slice(0, 10),
                      }))
                    }
                    disabled={addBranchLoading}
                  />
                </FormField>
                <FormField label="Email">
                  <Input
                    type="email"
                    value={branchForm.email}
                    onChange={(e) => setBranchForm((f) => ({ ...f, email: e.target.value }))}
                    disabled={addBranchLoading}
                  />
                </FormField>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <FormField label="Manager name">
                  <Input
                    value={branchForm.managerName}
                    onChange={(e) => setBranchForm((f) => ({ ...f, managerName: e.target.value }))}
                    disabled={addBranchLoading}
                  />
                </FormField>
                <FormField label="Manager phone">
                  <Input
                    inputMode="numeric"
                    placeholder="10-digit"
                    value={branchForm.managerPhone}
                    onChange={(e) =>
                      setBranchForm((f) => ({
                        ...f,
                        managerPhone: e.target.value.replace(/\D/g, "").slice(0, 10),
                      }))
                    }
                    disabled={addBranchLoading}
                  />
                </FormField>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--foreground)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={branchForm.isActive}
                  onChange={(e) => setBranchForm((f) => ({ ...f, isActive: e.target.checked }))}
                  disabled={addBranchLoading}
                />
                Site is active / accepting work
              </label>
            </div>
            <div style={{ padding: "12px 24px 20px", display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--border)" }}>
              <Button
                variant="outline"
                onClick={() => {
                  setAddBranchOpen(false);
                  resetBranchForm();
                }}
                disabled={addBranchLoading}
                style={{ minWidth: 100 }}
              >
                Cancel
              </Button>
              <Button onClick={() => void handleAddBranch()} disabled={addBranchLoading} className="min-w-35">
                {addBranchLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Creating…
                  </>
                ) : (
                  "Create branch"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Organization Confirmation Modal */}
      {deleteOpen && org && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
            padding: 16,
          }}
        >
          <div
            style={{
              background: "var(--card)",
              borderRadius: 16,
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
              width: "100%",
              maxWidth: 520,
              overflow: "hidden",
              border: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                padding: "20px 24px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: "#fee2e2",
                  color: "#dc2626",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "#b91c1c" }}>
                  Delete organization permanently?
                </h2>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted-foreground)" }}>
                  This will completely remove all database records
                </p>
              </div>
            </div>

            <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  padding: "12px 14px",
                  fontSize: 13,
                  color: "#991b1b",
                  lineHeight: 1.5,
                }}
              >
                <strong>Warning:</strong> All branches, staff users, customers, vehicles, appointments, invoices, inspections, and billing records for <strong>{org.organization.name}</strong> will be permanently wiped from the database.
              </div>

              <div style={{ fontSize: 13, color: "var(--foreground)" }}>
                To confirm, type <strong style={{ userSelect: "all" }}>{org.organization.name}</strong> below:
              </div>

              <Input
                placeholder={`Type "${org.organization.name}" to confirm`}
                value={deleteConfirmInput}
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
                disabled={deleteLoading}
                autoFocus
              />
            </div>

            <div
              style={{
                padding: "14px 24px 18px",
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                borderTop: "1px solid var(--border)",
                background: "var(--secondary)",
              }}
            >
              <Button
                variant="outline"
                onClick={() => {
                  setDeleteOpen(false);
                  setDeleteConfirmInput("");
                }}
                disabled={deleteLoading}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={
                  deleteLoading ||
                  deleteConfirmInput.trim().toLowerCase() !==
                    org.organization.name.trim().toLowerCase()
                }
                onClick={handleDeleteOrganization}
                style={{
                  background:
                    deleteConfirmInput.trim().toLowerCase() ===
                    org.organization.name.trim().toLowerCase()
                      ? "#dc2626"
                      : undefined,
                  minWidth: 150,
                }}
              >
                {deleteLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" /> Deleting…
                  </>
                ) : (
                  "Delete permanently"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
