import { apiClient } from "@/lib/api-client";
import type {
  OrgListItem,
  OrgDetail,
  PatchSubscriptionInput,
} from "@/types";

export interface ListOrganizationsResponse {
  organizations: OrgListItem[];
}

export async function listOrganizations(params?: {
  subscriptionStatus?: "ACTIVE" | "PAST_DUE" | "EXPIRED" | "CANCELLED" | "TRIAL";
}): Promise<OrgListItem[]> {
  const q = new URLSearchParams();
  if (params?.subscriptionStatus) q.set("subscriptionStatus", params.subscriptionStatus);
  const qs = q.toString() ? `?${q}` : "";
  const res = await apiClient.get<ListOrganizationsResponse>(`/api/platform/organizations${qs}`);
  return res.organizations ?? [];
}

export async function getOrganization(orgId: string): Promise<OrgDetail> {
  return apiClient.get<OrgDetail>(`/api/platform/organizations/${orgId}`);
}

export async function patchOrganizationSubscription(
  orgId: string,
  input: PatchSubscriptionInput
): Promise<OrgDetail> {
  return apiClient.patch<OrgDetail>(
    `/api/platform/organizations/${orgId}/subscription`,
    input
  );
}

export async function verifyPayment(
  orgId: string,
  input: {
    paymentId: string;
    outcome: "PAID" | "FAILED";
    txnReference?: string | null;
    amount?: number | null;
    notes?: string | null;
  }
): Promise<unknown> {
  return apiClient.post(
    `/api/platform/organizations/${orgId}/subscription/verify-payment`,
    input
  );
}

export async function markPaid(
  orgId: string,
  input: {
    txnReference?: string | null;
    amount?: number | null;
    termMonths?: 12 | 24 | 36 | 60;
    notes?: string | null;
  }
): Promise<unknown> {
  return apiClient.post(
    `/api/platform/organizations/${orgId}/subscription/mark-paid`,
    input
  );
}

export async function convertTrial(
  orgId: string,
  input: {
    termMonths?: 1 | 3 | 12 | 24 | 36 | 60;
    planCode?: string;
    markPaid?: boolean;
    notes?: string | null;
  } = {}
): Promise<unknown> {
  return apiClient.post(
    `/api/platform/organizations/${orgId}/subscription/convert-trial`,
    input
  );
}

export async function impersonateOrganization(
  orgId: string
): Promise<{ accessToken?: string; loginUrl?: string; user?: unknown }> {
  return apiClient.post(`/api/platform/organizations/${encodeURIComponent(orgId)}/impersonate`);
}

export async function patchOrganizationProfile(
  orgId: string,
  input: { billingEmail?: string | null }
): Promise<unknown> {
  return apiClient.patch(`/api/platform/organizations/${encodeURIComponent(orgId)}`, input);
}

export type ProvisionNotifyResult = {
  email?: boolean;
  sms?: boolean;
  whatsapp?: boolean;
  errors?: Partial<Record<"email" | "sms" | "whatsapp", string>>;
};

export async function provisionOrganization(input: {
  businessName: string;
  ownerName: string;
  email: string;
  phone: string;
  password: string;
  branchName?: string;
  planCode?: string;
  referralCode?: string | null;
  trialDays?: number;
}): Promise<{ notified?: ProvisionNotifyResult; organizationId?: string }> {
  return apiClient.post(`/api/platform/organizations/provision`, input);
}

export type PaymentLinkSendVia = "email" | "sms" | "whatsapp";

export type PaymentLinkDiscountType = "NONE" | "FLAT" | "PERCENTAGE" | "CODE";

export interface CreatePaymentLinkInput {
  planCode: string;
  termMonths: 1 | 3 | 12 | 24 | 36 | 60;
  extraBranches?: number;
  extraUsers?: number;
  /** Referral / coupon code when discountType is CODE. */
  referralCode?: string | null;
  /** NONE | FLAT (₹) | PERCENTAGE (%) | CODE (referral/coupon). */
  discountType?: PaymentLinkDiscountType;
  /** Flat ₹ amount or percentage value depending on discountType. */
  discountValue?: number | null;
  notes?: string | null;
  sendVia?: PaymentLinkSendVia[];
  customerEmail?: string | null;
  customerPhone?: string | null;
  /** If set, gateway link uses this amount instead of server quote. */
  amountOverride?: number | null;
}

export interface CreatePaymentLinkResult {
  paymentId?: string;
  billId?: string | null;
  paymentLinkUrl: string;
  amount: number;
  currency: string;
  expiresAt?: string | null;
  gateway?: string | null;
  sentVia?: PaymentLinkSendVia[];
}

/** Direct-sales: create gateway payment link and optionally email/SMS the owner. */
export async function createOrganizationPaymentLink(
  orgId: string,
  input: CreatePaymentLinkInput
): Promise<CreatePaymentLinkResult> {
  return apiClient.post(
    `/api/platform/organizations/${encodeURIComponent(orgId)}/subscription/payment-link`,
    input
  );
}

export async function resendOrganizationPaymentLink(
  orgId: string,
  paymentId: string,
  medium: PaymentLinkSendVia
): Promise<{ ok?: boolean; paymentLinkUrl?: string }> {
  return apiClient.post(
    `/api/platform/organizations/${encodeURIComponent(orgId)}/subscription/payment-link/${encodeURIComponent(paymentId)}/resend`,
    { medium }
  );
}

export async function deleteOrganization(
  orgId: string
): Promise<{ deleted: boolean; organizationId: string; name: string }> {
  return apiClient.delete(`/api/platform/organizations/${encodeURIComponent(orgId)}`);
}

