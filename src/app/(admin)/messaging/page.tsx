"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Mail, MessageSquare, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Topbar } from "@/components/layout/topbar";
import { ErrorBanner } from "@/components/shared/error-banner";
import { RefreshingBar } from "@/components/shared/loading";
import { FilterBar, FilterSelect } from "@/components/shared/filter-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getPlatformMessaging,
  sendPlatformMessagingTest,
  type PlatformMessagingChannel,
  type PlatformMessagingStatus,
} from "@/api/platform";

export default function MessagingPage() {
  const [status, setStatus] = useState<PlatformMessagingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [channel, setChannel] = useState<PlatformMessagingChannel>("sms");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  async function load(silent = false) {
    if (!silent) setLoading(true); else setRefreshing(true);
    setError(null);
    try {
      setStatus(await getPlatformMessaging());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load messaging status");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);

  const cards = status
    ? [
        {
          name: "SMS (Twilio)",
          enabled: status.smsEnabled,
          detail: status.twilioFromSet ? "From number configured" : "From number missing",
          icon: Smartphone,
          tone: { bg: "#EFF8F6", color: "#50B0A0" },
          channel: "sms" as const,
        },
        {
          name: "WhatsApp (Twilio)",
          enabled: status.whatsappEnabled,
          detail: status.twilioWhatsappFromSet ? "WhatsApp from configured" : "WhatsApp from missing",
          icon: MessageSquare,
          tone: { bg: "#faf5ff", color: "#7c3aed" },
          channel: "whatsapp" as const,
        },
        {
          name: "Email (Resend)",
          enabled: status.emailEnabled,
          detail: status.mailFromSet ? "MAIL_FROM configured" : "MAIL_FROM missing",
          icon: Mail,
          tone: { bg: "#f0fdf4", color: "#16a34a" },
          channel: "email" as const,
        },
      ]
    : [];

  const channelEnabled = useMemo(() => {
    if (!status) return false;
    if (channel === "sms") return status.smsEnabled;
    if (channel === "whatsapp") return status.whatsappEnabled;
    return status.emailEnabled;
  }, [status, channel]);

  async function handleSend() {
    const recipient = to.trim();
    if (!recipient) {
      toast.error(channel === "email" ? "Enter a recipient email." : "Enter a recipient phone.");
      return;
    }
    if (!channelEnabled) {
      toast.error("This channel is not configured on the API server.");
      return;
    }
    setSending(true);
    try {
      await sendPlatformMessagingTest({
        channel,
        to: recipient,
        subject: channel === "email" ? subject.trim() || undefined : undefined,
        body: body.trim() || undefined,
      });
      toast.success(
        channel === "email"
          ? `Email submitted to ${recipient}.`
          : channel === "whatsapp"
            ? `WhatsApp message sent to ${recipient}`
            : `SMS message submitted to ${recipient}.`
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <RefreshingBar show={refreshing} />
      <Topbar title="Messaging" description="Provider status and send a test message" />
      <FilterBar onRefresh={() => load(true)} refreshing={refreshing || loading} />
      <div style={{ flex: 1, overflowY: "auto", padding: "clamp(10px, 2vw, 16px) clamp(12px, 3vw, 24px)", background: "var(--page-bg)", display: "flex", flexDirection: "column", gap: 16 }}>
        {error && <ErrorBanner message={error} onRetry={load} />}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {(loading ? [1, 2, 3] : cards).map((item, i) => {
            if (loading || typeof item === "number") {
              return <div key={i} style={{ height: 120, borderRadius: 14, background: "var(--card)", border: "1px solid var(--border)" }} />;
            }
            const Icon = item.icon;
            const selected = channel === item.channel;
            return (
              <button
                key={item.name}
                type="button"
                onClick={() => setChannel(item.channel)}
                style={{
                  background: "var(--card)",
                  border: selected ? "1px solid #50B0A0" : "1px solid var(--border)",
                  borderRadius: 14,
                  padding: "16px 18px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                  textAlign: "left",
                  cursor: "pointer",
                  outline: selected ? "2px solid rgba(80,176,160,0.25)" : "none",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: item.tone.bg, color: item.tone.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon style={{ width: 18, height: 18 }} />
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{item.name}</div>
                  </div>
                  <Badge variant={item.enabled ? "success" : "muted"}>{item.enabled ? "Enabled" : "Disabled"}</Badge>
                </div>
                <div style={{ marginTop: 12, fontSize: 13, color: "var(--muted-foreground)" }}>{item.detail}</div>
              </button>
            );
          })}
        </div>

        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 18, maxWidth: 640 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Send test message</div>
          <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginBottom: 16, lineHeight: 1.5 }}>
            Smoke-test the selected provider. Leave body empty to use the default test text.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 6 }}>
                Channel
              </label>
              <FilterSelect
                value={channel}
                onChange={(v) => setChannel(v as PlatformMessagingChannel)}
                options={[
                  { value: "sms", label: "SMS" },
                  { value: "whatsapp", label: "WhatsApp" },
                  { value: "email", label: "Email" },
                ]}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 6 }}>
                {channel === "email" ? "To email" : "To phone"}
              </label>
              <Input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder={channel === "email" ? "you@example.com" : "+919876543210"}
                disabled={sending}
              />
            </div>

            {channel === "email" && (
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 6 }}>
                  Subject (optional)
                </label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="My Detail OS — platform test email"
                  disabled={sending}
                />
              </div>
            )}

            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 6 }}>
                {channel === "email" ? "HTML body (optional)" : "Message (optional)"}
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={sending}
                rows={channel === "email" ? 5 : 3}
                placeholder={
                  channel === "email"
                    ? "<p>Optional custom HTML…</p>"
                    : "Optional custom message…"
                }
                style={{
                  width: "100%",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  padding: "8px 12px",
                  fontSize: 13,
                  color: "var(--foreground)",
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Button onClick={handleSend} disabled={sending || loading || !channelEnabled}>
                {sending ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : "Send test"}
              </Button>
              {!channelEnabled && !loading && (
                <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                  Configure this provider in backend env vars first.
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Notes</div>
          <div style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
            Status cards show capability flags only (no secrets). Use Send test to verify Twilio/Resend from this admin session. Workshop customer messaging still runs from each org’s own flows.
          </div>
        </div>
      </div>
    </div>
  );
}
