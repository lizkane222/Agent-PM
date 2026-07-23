import { useCallback, useEffect, useRef, useState } from "react";
import { agentSkillsApi, skillsApi, commentsApi } from "../lib/api";
import CodeIcon from "../assets/icons/Code.svg?react";
import MessagingLogo from "../assets/Product Logos/logo-messagingx-red.svg?react";
import VoiceLogo from "../assets/Product Logos/logo-programmable-voice-red.svg?react";
import TaskRouterLogo from "../assets/Product Logos/logo-taskrouter-red.svg?react";
import NotifyLogo from "../assets/Product Logos/logo-notify-red.svg?react";
import SyncLogo from "../assets/Product Logos/logo-sync-red.svg?react";
import TrustHubLogo from "../assets/Product Logos/logo-trust-hub-red.svg?react";
import UnderstandLogo from "../assets/Product Logos/logo-understand-red.svg?react";
import VirtualAgentLogo from "../assets/Product Logos/virtual-agent-logo-red.svg?react";
import type { SkillFile } from "../lib/api";
import { useLogGlow } from "../lib/useLogGlow";
import type { AgentSkill, AgentSkillStatus, ClaudeSkill, ClaudeSkillStatus } from "../types";
import { ROLE_OPTIONS } from "../types";
import { useCommentContext, useRightClickComment } from "../components/comments/CommentContext";
import { useCurrentUser } from "../context/CurrentUserContext";

// ── Static Twilio plugin skill registry ───────────────────────────────────────

type TwilioSkillGroup = "Twilio" | "SendGrid";

interface TwilioSkill {
  slug: string;
  name: string;
  description: string;
  group: TwilioSkillGroup;
}

const TWILIO_SKILLS: TwilioSkill[] = [
  // Twilio
  { group: "Twilio", slug: "twilio-account-setup", name: "Account Setup", description: "Create and configure a Twilio account from scratch. Covers free trial signup, credentials, phone numbers, and enabling products." },
  { group: "Twilio", slug: "twilio-ai-agent-architect", name: "AI Agent Architect", description: "Planning skill for AI-powered conversational agents. Recommends the right Twilio Conversations architecture for your use case." },
  { group: "Twilio", slug: "twilio-agent-augmentation-architect", name: "Agent Augmentation Architect", description: "Planning skill for augmenting human agents with real-time AI intelligence across coaching, compliance, QA, and routing." },
  { group: "Twilio", slug: "twilio-agent-connect", name: "Agent Connect", description: "Connect third-party AI agents (OpenAI, Bedrock, LangChain) to Twilio voice and messaging channels." },
  { group: "Twilio", slug: "twilio-call-recordings", name: "Call Recordings", description: "Record Twilio voice calls correctly. Covers storage, playback, compliance, and deletion." },
  { group: "Twilio", slug: "twilio-cli-reference", name: "CLI Reference", description: "Twilio CLI reference for managing Twilio resources from the terminal." },
  { group: "Twilio", slug: "twilio-compliance-onboarding", name: "Compliance Onboarding", description: "Registrations required BEFORE Twilio traffic works. Covers messaging registration, A2P 10DLC, toll-free verification." },
  { group: "Twilio", slug: "twilio-compliance-traffic", name: "Compliance Traffic Rules", description: "Rules you must follow for Twilio messaging and voice traffic. Covers TCPA, opt-outs, and carrier requirements." },
  { group: "Twilio", slug: "twilio-conference-calls", name: "Conference Calls", description: "Build multi-party calls using Twilio Conference. Covers warm transfer, recording, and moderator controls." },
  { group: "Twilio", slug: "twilio-content-template-builder", name: "Content Template Builder", description: "Create, manage, and send message templates using Twilio's Content API." },
  { group: "Twilio", slug: "twilio-conversation-intelligence", name: "Conversation Intelligence", description: "Analyze calls and messages with Twilio Conversation Intelligence. Covers transcription, sentiment, and operator scoring." },
  { group: "Twilio", slug: "twilio-conversation-orchestrator", name: "Conversation Orchestrator", description: "Configure automatic conversation capture and routing with Twilio Conversation Orchestrator." },
  { group: "Twilio", slug: "twilio-conversations-classic-api", name: "Conversations Classic API", description: "Build multi-channel messaging experiences using the Twilio Conversations (classic) API." },
  { group: "Twilio", slug: "twilio-customer-memory", name: "Customer Memory", description: "Store and retrieve customer context using Twilio Conversation Memory." },
  { group: "Twilio", slug: "twilio-customer-support-architect", name: "Customer Support Architect", description: "Planning skill for building customer service and support systems on Twilio." },
  { group: "Twilio", slug: "twilio-debugging-observability", name: "Debugging & Observability", description: "Debug Twilio integrations and set up production observability. Covers logs, alerts, and error codes." },
  { group: "Twilio", slug: "twilio-email-deliverability-advisor", name: "Email Deliverability Advisor", description: "Deliverability advisor for the Twilio Email API. Diagnoses inbox placement and reputation issues." },
  { group: "Twilio", slug: "twilio-email-send", name: "Email Send (Twilio)", description: "Send email via the Twilio Email API using Twilio credentials." },
  { group: "Twilio", slug: "twilio-enterprise-knowledge", name: "Enterprise Knowledge", description: "Add knowledge retrieval to AI agents using Twilio's Enterprise Knowledge API." },
  { group: "Twilio", slug: "twilio-iam-auth-setup", name: "IAM & Auth Setup", description: "Set up and manage Twilio authentication credentials: Auth Tokens, API keys, and org-level IAM." },
  { group: "Twilio", slug: "twilio-identity-verification-advisor", name: "Identity Verification Advisor", description: "Planning skill for identity verification and fraud prevention with Twilio Verify and Lookup." },
  { group: "Twilio", slug: "twilio-lookup-phone-intelligence", name: "Lookup Phone Intelligence", description: "Look up phone number intelligence via Twilio Lookup v2 API. Covers number validation, carrier, and risk scoring." },
  { group: "Twilio", slug: "twilio-marketing-promotions-advisor", name: "Marketing & Promotions Advisor", description: "Planning skill for marketing and promotional messaging campaigns on Twilio." },
  { group: "Twilio", slug: "twilio-messaging-channel-advisor", name: "Messaging Channel Advisor", description: "Planning skill to pick the right Twilio messaging channel (SMS, WhatsApp, RCS, email)." },
  { group: "Twilio", slug: "twilio-messaging-overview", name: "Messaging Overview", description: "Twilio Messaging channel overview and onboarding guide across SMS, WhatsApp, RCS, and email." },
  { group: "Twilio", slug: "twilio-messaging-services", name: "Messaging Services", description: "Create and configure Twilio Messaging Services for production messaging with alpha sender and sticky sender." },
  { group: "Twilio", slug: "twilio-messaging-webhooks", name: "Messaging Webhooks", description: "Receive inbound messages and track outbound delivery status via Twilio webhooks." },
  { group: "Twilio", slug: "twilio-notifications-alerts-advisor", name: "Notifications & Alerts Advisor", description: "Planning skill for transactional notifications and alerts via Twilio." },
  { group: "Twilio", slug: "twilio-numbers-senders", name: "Numbers & Senders", description: "Choose the right Twilio number type and sender before building. Covers long codes, short codes, toll-free, and alpha senders." },
  { group: "Twilio", slug: "twilio-organizations-setup", name: "Organizations Setup", description: "Set up and manage Twilio Organizations for centralized account and user management." },
  { group: "Twilio", slug: "twilio-rcs-messaging", name: "RCS Messaging", description: "Send RCS Business Messages via Twilio. Covers compliance onboarding, templates, and rich media." },
  { group: "Twilio", slug: "twilio-regulatory-compliance-bundles", name: "Regulatory Compliance Bundles", description: "Manage regulatory compliance bundles for international phone numbers." },
  { group: "Twilio", slug: "twilio-reliability-patterns", name: "Reliability Patterns", description: "Handle rate limits, retries, and failures when building on Twilio at scale." },
  { group: "Twilio", slug: "twilio-security-api-auth", name: "Security: API Auth", description: "Choose the right Twilio authentication method and implement it correctly." },
  { group: "Twilio", slug: "twilio-security-compliance-hipaa", name: "Security: HIPAA Compliance", description: "Configure Twilio accounts for HIPAA compliance. Covers BAA requirements and data handling." },
  { group: "Twilio", slug: "twilio-security-hardening", name: "Security Hardening", description: "Secure Twilio applications against common attacks. Covers credential hygiene, webhook validation, and rate limiting." },
  { group: "Twilio", slug: "twilio-send-message", name: "Send Message", description: "Send messages via Twilio's Programmable Messaging API across all supported channels." },
  { group: "Twilio", slug: "twilio-sms-isv-setup", name: "SMS ISV Setup", description: "Best practices for ISVs building SMS features on top of Twilio." },
  { group: "Twilio", slug: "twilio-sms-send-message", name: "SMS Send Message", description: "SMS and MMS deep-dive reference. Covers SMS-specific error codes, encoding, and carrier filtering." },
  { group: "Twilio", slug: "twilio-taskrouter-routing", name: "TaskRouter Routing", description: "Route tasks to agents using Twilio TaskRouter. Covers Workers, Task Queues, and Workflows." },
  { group: "Twilio", slug: "twilio-verify-send-otp", name: "Verify: Send OTP", description: "Send and verify one-time passcodes via Twilio Verify over SMS, RCS, WhatsApp, and voice." },
  { group: "Twilio", slug: "twilio-voice-conversation-relay", name: "Voice: Conversation Relay", description: "Build AI-powered voice agents using Twilio ConversationRelay with real-time ASR, TTS, and WebSocket streaming." },
  { group: "Twilio", slug: "twilio-voice-outbound-calls", name: "Voice: Outbound Calls", description: "Make outbound phone calls via Twilio's Programmable Voice REST API." },
  { group: "Twilio", slug: "twilio-voice-twiml", name: "Voice: TwiML", description: "Build voice call logic using TwiML (Twilio Markup Language). Covers all TwiML verbs and nouns." },
  { group: "Twilio", slug: "twilio-webhook-architecture", name: "Webhook Architecture", description: "Design, secure, and operate Twilio webhook endpoints. Covers inbound event handling and validation." },
  { group: "Twilio", slug: "twilio-whatsapp-manage-senders", name: "WhatsApp: Manage Senders", description: "Create, configure, and manage WhatsApp Business senders via Twilio." },
  { group: "Twilio", slug: "twilio-whatsapp-send-message", name: "WhatsApp: Send Message", description: "WhatsApp messaging deep-dive reference. Covers the 24-hour service window, templates, and media." },
  // SendGrid
  { group: "SendGrid", slug: "twilio-sendgrid-account-setup", name: "Account Setup", description: "Set up a SendGrid account for email delivery. Covers API key creation, sender authentication, and domain verification." },
  { group: "SendGrid", slug: "twilio-sendgrid-deliverability-advisor", name: "Deliverability Advisor", description: "Diagnostic and advisory skill for email deliverability problems. Covers reputation, SPF, DKIM, and DMARC." },
  { group: "SendGrid", slug: "twilio-sendgrid-email-send", name: "Email Send", description: "Send transactional and bulk email via the SendGrid v3 Mail Send API." },
  { group: "SendGrid", slug: "twilio-sendgrid-email-settings", name: "Email Settings", description: "Configure SendGrid dynamic templates, tracking settings, and unsubscribe groups." },
  { group: "SendGrid", slug: "twilio-sendgrid-engagement-quality", name: "Engagement Quality", description: "Monitor email program health with SendGrid Engagement Quality (SEQ) scores." },
  { group: "SendGrid", slug: "twilio-sendgrid-inbound-parse", name: "Inbound Parse", description: "Receive inbound email via SendGrid Inbound Parse webhook. Covers MX record setup and payload handling." },
  { group: "SendGrid", slug: "twilio-sendgrid-suppressions", name: "Suppressions", description: "Manage SendGrid email suppressions: bounces, blocks, spam reports, and unsubscribes." },
  { group: "SendGrid", slug: "twilio-sendgrid-webhooks", name: "Webhooks", description: "Track email delivery and engagement via SendGrid Event Webhooks." },
];

const STATUS_STYLES: Record<ClaudeSkillStatus, { bg: string; color: string; label: string; strip: string }> = {
  pending_review: { bg: "rgba(234,179,8,0.15)",  color: "#ca8a04", label: "Pending Review", strip: "PENDING" },
  reviewing:      { bg: "rgba(59,130,246,0.15)", color: "#3b82f6", label: "Reviewing…",     strip: "REVIEW"  },
  approved:       { bg: "rgba(34,197,94,0.15)",  color: "#16a34a", label: "Approved",        strip: "APPROVED"},
  rejected:       { bg: "rgba(239,68,68,0.15)",  color: "#dc2626", label: "Rejected",        strip: "REJECTED"},
  disabled:       { bg: "rgba(107,114,128,0.15)",color: "#6b7280", label: "Disabled",        strip: "DISABLED"},
};

function StatusBadge({ status, fontSize = "22px" }: { status: ClaudeSkillStatus; fontSize?: string }) {
  const s = STATUS_STYLES[status];
  const small = parseInt(fontSize) <= 14;
  return (
    <span style={{
      padding: small ? "2px 6px" : "4px 16px",
      borderRadius: small ? "4px" : "8px",
      fontSize,
      fontWeight: 600,
      letterSpacing: "0.03em",
      background: s.bg,
      color: s.color,
      whiteSpace: "nowrap",
    }}>{s.label}</span>
  );
}

function CodeEditor({
  value, onChange, placeholder, readOnly = false,
}: {
  value: string; onChange?: (v: string) => void; placeholder?: string; readOnly?: boolean;
}) {
  return (
    <textarea
      readOnly={readOnly}
      value={value}
      onChange={e => onChange?.(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      rows={14}
      style={{
        width: "100%",
        boxSizing: "border-box",
        fontFamily: "var(--font-mono, 'Courier New', monospace)",
        fontSize: "0.8125rem",
        lineHeight: 1.6,
        padding: "14px 16px",
        borderRadius: "8px",
        border: "1px solid var(--border, rgba(0,0,0,0.12))",
        background: readOnly ? "rgba(0,0,0,0.03)" : "var(--surface, #fff)",
        color: "var(--text-primary, #111)",
        resize: "vertical",
        outline: "none",
        transition: "border-color 0.15s",
      }}
    />
  );
}

function SkillDetail({
  skill, onClose, onUpdated,
}: {
  skill: ClaudeSkill;
  onClose: () => void;
  onUpdated: (s: ClaudeSkill) => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState(false);
  const [editedCode, setEditedCode] = useState(skill.code);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [versions, setVersions] = useState<string[]>([skill.code]);
  const [activeVersionIdx, setActiveVersionIdx] = useState(0);
  const [editingCommand, setEditingCommand] = useState(false);
  const [editedCommand, setEditedCommand] = useState(skill.command ?? "");
  const [savingCommand, setSavingCommand] = useState(false);
  const [editingRoles, setEditingRoles] = useState(false);
  const [editedRoles, setEditedRoles] = useState<string[]>(skill.roles ?? []);
  const [savingRoles, setSavingRoles] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const { openComments } = useCommentContext();

  const isCurrentVersion = activeVersionIdx === versions.length - 1;

  // Load comment count for this skill
  useEffect(() => {
    commentsApi.list("claude_skill", skill.id).then(({ data }) => {
      // data.results contains top-level comments; count those + all replies
      const total = data.results.reduce(
        (sum, c) => sum + 1 + (c.replies?.length ?? 0), 0
      );
      setCommentCount(total);
    }).catch(() => {});
  }, [skill.id]);

  const handleOpenComments = useCallback((e: React.MouseEvent) => {
    openComments({
      resourceType: "claude_skill",
      resourceId: skill.id,
      resourceLabel: skill.name,
      x: e.clientX,
      y: e.clientY,
    });
  }, [openComments, skill.id, skill.name]);

  function handleCopyFeedback() {
    const text = [
      skill.review_feedback,
      skill.review_suggestions ? `\nSUGGESTIONS\n${skill.review_suggestions}` : "",
    ].filter(Boolean).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleReview() {
    setReviewing(true);
    setActionError(null);
    try {
      const { data } = await skillsApi.review(skill.id);
      onUpdated(data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? "Review failed — check server logs.";
      setActionError(msg);
    } finally {
      setReviewing(false);
    }
  }

  async function handleFixAndReview() {
    setFixing(true);
    setActionError(null);
    try {
      const { data } = await skillsApi.fixAndReview(skill.id);
      onUpdated(data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? "Fix failed — check server logs.";
      setActionError(msg);
    } finally {
      setFixing(false);
    }
  }

  async function handleToggle() {
    setToggling(true);
    try {
      const { data } = skill.status === "approved"
        ? await skillsApi.disable(skill.id)
        : await skillsApi.enable(skill.id);
      onUpdated(data);
    } finally { setToggling(false); }
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try { await skillsApi.delete(skill.id); onClose(); }
    finally { setDeleting(false); }
  }

  async function handleSaveCode() {
    setSaving(true);
    setActionError(null);
    try {
      const { data } = await skillsApi.update(skill.id, { code: editedCode });
      onUpdated(data);
      setVersions(prev => {
        const next = [...prev, editedCode];
        setActiveVersionIdx(next.length - 1);
        return next;
      });
      setEditingCode(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? "Save failed — check server logs.";
      setActionError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveCommand() {
    setSavingCommand(true);
    setActionError(null);
    try {
      const raw = editedCommand.trim();
      const normalized = raw && !raw.startsWith("/") ? `/${raw}` : raw;
      const { data } = await skillsApi.update(skill.id, { command: normalized });
      onUpdated(data);
      setEditedCommand(data.command ?? "");
      setEditingCommand(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? "Save failed.";
      setActionError(msg);
    } finally {
      setSavingCommand(false);
    }
  }

  async function handleSaveRoles() {
    setSavingRoles(true);
    setActionError(null);
    try {
      const { data } = await skillsApi.update(skill.id, { roles: editedRoles });
      onUpdated(data);
      setEditingRoles(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? "Save failed.";
      setActionError(msg);
    } finally {
      setSavingRoles(false);
    }
  }

  const canReview = skill.status === "pending_review" || skill.status === "rejected";
  const canToggle = skill.status === "approved" || skill.status === "disabled";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "24px 28px", overflowY: "auto", gap: "20px" }}>
      {/* Back button */}
      <button type="button" onClick={onClose} style={{
        display: "inline-flex", alignItems: "center", gap: "8px",
        alignSelf: "flex-start", background: "transparent", border: "none",
        cursor: "pointer", padding: "0", fontSize: "0.875rem",
        color: "var(--text-secondary, #888)", fontFamily: "var(--font-base)",
      }}
        onMouseEnter={e => (e.currentTarget.style.color = "var(--text-primary, #111)")}
        onMouseLeave={e => (e.currentTarget.style.color = "var(--text-secondary, #888)")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Back
      </button>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, fontFamily: "var(--font-base)" }}>
              {skill.name}
            </h2>
            <StatusBadge status={skill.status} />
          </div>
          <p style={{ margin: "6px 0 0", fontSize: "0.875rem", color: "var(--text-secondary, #666)" }}>
            {skill.description}
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        {[
          { label: "Invocations", value: skill.invocation_count.toLocaleString() },
          { label: "Submitted by", value: skill.submitted_by_username ?? "—" },
          { label: "Created", value: new Date(skill.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) },
        ].map(({ label, value }) => (
          <div key={label} style={{ padding: "8px 14px", borderRadius: "8px", background: "var(--surface-alt, rgba(0,0,0,0.04))" }}>
            <div style={{ fontSize: "0.6875rem", color: "var(--text-secondary, #888)", letterSpacing: "0.04em", marginBottom: "2px" }}>{label}</div>
            <div style={{ fontSize: "0.875rem", fontWeight: 600, fontFamily: "var(--font-base)" }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Slash command */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary, #666)", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
          SLASH COMMAND
        </div>
        {editingCommand ? (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: "200px" }}>
            <input
              value={editedCommand}
              onChange={e => setEditedCommand(e.target.value)}
              placeholder="/command_name"
              style={{
                flex: 1, padding: "5px 10px", borderRadius: "6px", fontSize: "0.8125rem",
                border: "1px solid var(--border, rgba(0,0,0,0.15))", background: "var(--surface, #fff)",
                fontFamily: "var(--font-mono, monospace)", outline: "none",
              }}
            />
            <button onClick={handleSaveCommand} disabled={savingCommand} style={{
              padding: "5px 12px", borderRadius: "6px", fontSize: "0.8125rem", fontWeight: 600,
              background: "var(--twilio-red, #e22)", color: "#fff", border: "none",
              cursor: savingCommand ? "not-allowed" : "pointer", opacity: savingCommand ? 0.7 : 1,
              fontFamily: "var(--font-base)",
            }}>
              {savingCommand ? "Saving…" : "Save"}
            </button>
            <button onClick={() => { setEditingCommand(false); setEditedCommand(skill.command ?? ""); }} disabled={savingCommand} style={{
              padding: "5px 12px", borderRadius: "6px", fontSize: "0.8125rem", fontWeight: 600,
              background: "transparent", border: "1px solid rgba(0,0,0,0.15)",
              color: "var(--text-secondary, #666)", cursor: "pointer", fontFamily: "var(--font-base)",
            }}>
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {skill.command ? (
              <code style={{
                padding: "3px 8px", borderRadius: "5px", fontSize: "0.8125rem",
                background: "rgba(0,0,0,0.05)", fontFamily: "var(--font-mono, monospace)",
                color: "var(--twilio-red, #e22)", fontWeight: 600,
              }}>
                {skill.command}
              </code>
            ) : (
              <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #aaa)", fontStyle: "italic" }}>
                No command set
              </span>
            )}
            <button onClick={() => { setEditedCommand(skill.command ?? ""); setEditingCommand(true); }} style={{
              display: "inline-flex", alignItems: "center", gap: "4px",
              padding: "4px 10px", borderRadius: "5px", fontSize: "0.75rem", fontWeight: 600,
              background: "transparent", border: "1px solid rgba(0,0,0,0.15)",
              color: "var(--text-secondary, #666)", cursor: "pointer", fontFamily: "var(--font-base)",
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              {skill.command ? "Edit" : "Set command"}
            </button>
          </div>
        )}
        <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", lineHeight: 1.5, width: "100%" }}>
          Type this command in the Agent chat or the quick-input bar anywhere in the app to invoke this skill.
        </p>
      </div>

      {/* Roles */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary, #666)", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
            ROLE PAGES
          </div>
          {!editingRoles ? (
            <>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {(skill.roles ?? []).length > 0 ? (skill.roles ?? []).map(r => (
                  <span key={r} style={{
                    padding: "3px 10px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 600,
                    background: "rgba(124,58,237,0.1)", color: "#7c3aed",
                    border: "1px solid rgba(124,58,237,0.25)",
                  }}>{r}</span>
                )) : (
                  <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #aaa)", fontStyle: "italic" }}>
                    No roles assigned
                  </span>
                )}
              </div>
              <button onClick={() => { setEditedRoles(skill.roles ?? []); setEditingRoles(true); }} style={{
                display: "inline-flex", alignItems: "center", gap: "4px",
                padding: "4px 10px", borderRadius: "5px", fontSize: "0.75rem", fontWeight: 600,
                background: "transparent", border: "1px solid rgba(0,0,0,0.15)",
                color: "var(--text-secondary, #666)", cursor: "pointer", fontFamily: "var(--font-base)",
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                Edit roles
              </button>
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", flex: 1 }}>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {ROLE_OPTIONS.map(role => {
                  const active = editedRoles.includes(role);
                  return (
                    <button
                      key={role}
                      onClick={() => setEditedRoles(prev =>
                        active ? prev.filter(r => r !== role) : [...prev, role]
                      )}
                      style={{
                        padding: "5px 12px", borderRadius: "20px", fontSize: "0.8125rem", fontWeight: 600,
                        border: active ? "1.5px solid #7c3aed" : "1.5px solid rgba(0,0,0,0.15)",
                        background: active ? "rgba(124,58,237,0.1)" : "transparent",
                        color: active ? "#7c3aed" : "var(--text-secondary, #888)",
                        cursor: "pointer", fontFamily: "var(--font-base)", transition: "all 0.12s",
                      }}
                    >
                      {active && "✓ "}{role}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={handleSaveRoles} disabled={savingRoles} style={{
                  padding: "5px 14px", borderRadius: "6px", fontSize: "0.8125rem", fontWeight: 600,
                  background: "var(--twilio-red, #e22)", color: "#fff", border: "none",
                  cursor: savingRoles ? "not-allowed" : "pointer", opacity: savingRoles ? 0.7 : 1,
                  fontFamily: "var(--font-base)",
                }}>
                  {savingRoles ? "Saving…" : "Save"}
                </button>
                <button onClick={() => { setEditingRoles(false); setEditedRoles(skill.roles ?? []); }} disabled={savingRoles} style={{
                  padding: "5px 12px", borderRadius: "6px", fontSize: "0.8125rem", fontWeight: 600,
                  background: "transparent", border: "1px solid rgba(0,0,0,0.15)",
                  color: "var(--text-secondary, #666)", cursor: "pointer", fontFamily: "var(--font-base)",
                }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", lineHeight: 1.5 }}>
          This skill will appear as a quick-launch button on the selected role pages under Team.
        </p>
      </div>

      {/* Code */}
      <div>
        {/* Header row: label + version pills + edit/save/cancel */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px", gap: "10px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary, #666)", letterSpacing: "0.04em" }}>
              TOOL CODE
            </div>
            {versions.length > 1 && (
              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                {versions.map((_, i) => {
                  const isActive = i === activeVersionIdx;
                  const isLatest = i === versions.length - 1;
                  return (
                    <button
                      key={i}
                      onClick={() => { setActiveVersionIdx(i); setEditingCode(false); }}
                      style={{
                        padding: "2px 10px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 600,
                        border: isActive ? "1.5px solid var(--twilio-red, #e22)" : "1.5px solid rgba(0,0,0,0.12)",
                        background: isActive ? "rgba(226,35,26,0.07)" : "transparent",
                        color: isActive ? "var(--twilio-red, #e22)" : "var(--text-secondary, #888)",
                        cursor: "pointer", fontFamily: "var(--font-base)", transition: "all 0.12s",
                      }}
                    >
                      v{i + 1}{isLatest ? " (latest)" : ""}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {!editingCode ? (
            <button onClick={() => { setEditedCode(versions[activeVersionIdx]); setEditingCode(true); setActionError(null); }} style={{
              display: "inline-flex", alignItems: "center", gap: "5px",
              padding: "4px 12px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 600,
              background: "transparent", border: "1px solid rgba(0,0,0,0.15)",
              color: "var(--text-secondary, #666)", cursor: "pointer", fontFamily: "var(--font-base)",
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              {isCurrentVersion ? "Edit" : "Edit this version"}
            </button>
          ) : (
            <div style={{ display: "flex", gap: "6px" }}>
              <button onClick={handleSaveCode} disabled={saving} style={{
                padding: "4px 12px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 600,
                background: "var(--twilio-red, #e22)", color: "#fff", border: "none",
                cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1,
                fontFamily: "var(--font-base)",
              }}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button onClick={() => { setEditingCode(false); setActionError(null); }} disabled={saving} style={{
                padding: "4px 12px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 600,
                background: "transparent", border: "1px solid rgba(0,0,0,0.15)",
                color: "var(--text-secondary, #666)", cursor: "pointer", fontFamily: "var(--font-base)",
              }}>
                Cancel
              </button>
            </div>
          )}
        </div>
        <CodeEditor
          value={editingCode ? editedCode : versions[activeVersionIdx]}
          onChange={setEditedCode}
          readOnly={!editingCode}
        />
        {editingCode && (
          <p style={{ margin: "8px 0 0", fontSize: "0.875rem", color: "var(--text-secondary, #888)", lineHeight: 1.5 }}>
            {isCurrentVersion
              ? "Save to update the code, then re-review to get a new verdict."
              : "Editing a previous version — saving will create a new version from this base."}
          </p>
        )}
        {!editingCode && !isCurrentVersion && (
          <p style={{ margin: "8px 0 0", fontSize: "0.8125rem", color: "var(--text-secondary, #aaa)", lineHeight: 1.5 }}>
            Viewing v{activeVersionIdx + 1} — this is not the current saved code.
          </p>
        )}
      </div>

      {/* Input schema */}
      {skill.input_schema && Object.keys(skill.input_schema).length > 0 && (
        <div>
          <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary, #666)", marginBottom: "8px", letterSpacing: "0.04em" }}>
            INPUT SCHEMA
          </div>
          <CodeEditor value={JSON.stringify(skill.input_schema, null, 2)} readOnly />
        </div>
      )}

      {/* Review feedback */}
      {skill.review_feedback && (
        <div style={{
          padding: "14px 18px", borderRadius: "10px",
          border: `1px solid ${STATUS_STYLES[skill.status]?.color ?? "#ccc"}33`,
          background: STATUS_STYLES[skill.status]?.bg,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
            <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: STATUS_STYLES[skill.status]?.color, letterSpacing: "0.04em" }}>
              REVIEW FEEDBACK
            </div>
            <button onClick={handleCopyFeedback} style={{
              display: "inline-flex", alignItems: "center", gap: "5px",
              padding: "4px 10px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 600,
              background: "transparent", border: "1px solid rgba(0,0,0,0.15)",
              color: copied ? "#16a34a" : "var(--text-secondary, #666)",
              cursor: "pointer", fontFamily: "var(--font-base)", transition: "color 0.15s",
            }}>
              {copied ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p style={{ margin: 0, fontSize: "0.875rem", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{skill.review_feedback}</p>
          {skill.review_suggestions && (
            <>
              <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary, #666)", marginTop: "16px", marginBottom: "8px", letterSpacing: "0.04em" }}>
                SUGGESTIONS
              </div>
              <p style={{ margin: 0, fontSize: "0.875rem", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{skill.review_suggestions}</p>
            </>
          )}
          {skill.status === "rejected" && (
            <div style={{ marginTop: "14px" }}>
              <button onClick={handleFixAndReview} disabled={fixing} style={{
                padding: "7px 16px", borderRadius: "7px", fontSize: "0.875rem", fontWeight: 600,
                background: "rgba(239,68,68,0.1)", color: "#dc2626",
                border: "1px solid rgba(239,68,68,0.3)",
                cursor: fixing ? "not-allowed" : "pointer", opacity: fixing ? 0.7 : 1,
                fontFamily: "var(--font-base)",
              }}>
                {fixing ? "Fixing & reviewing…" : "Fix & Re-review"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <div style={{
          padding: "12px 16px", borderRadius: "8px", fontSize: "0.875rem",
          background: "rgba(239,68,68,0.08)", color: "#dc2626",
          border: "1px solid rgba(239,68,68,0.2)", lineHeight: 1.5,
        }}>
          {actionError}
        </div>
      )}

      {/* Inline runner */}
      <SkillRunner skill={skill} />

      {/* Actions */}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", paddingTop: "4px" }}>
        {canReview && (
          <button onClick={handleReview} disabled={reviewing} style={{
            padding: "7px 16px", borderRadius: "7px", fontSize: "0.875rem", fontWeight: 600,
            background: "var(--twilio-red, #e22)", color: "#fff", border: "none",
            cursor: reviewing ? "not-allowed" : "pointer", opacity: reviewing ? 0.7 : 1,
            fontFamily: "var(--font-base)",
          }}>
            {reviewing ? "Reviewing…" : (skill.status === "rejected" ? "Re-review" : "Review with Claude")}
          </button>
        )}
        {canToggle && (
          <button onClick={handleToggle} disabled={toggling} style={{
            padding: "7px 16px", borderRadius: "7px", fontSize: "0.875rem", fontWeight: 600,
            background: skill.status === "approved" ? "rgba(107,114,128,0.12)" : "rgba(34,197,94,0.12)",
            color: skill.status === "approved" ? "#6b7280" : "#16a34a",
            border: `1px solid ${skill.status === "approved" ? "rgba(107,114,128,0.25)" : "rgba(34,197,94,0.25)"}`,
            cursor: toggling ? "not-allowed" : "pointer", opacity: toggling ? 0.7 : 1,
            fontFamily: "var(--font-base)",
          }}>
            {toggling ? "…" : (skill.status === "approved" ? "Disable" : "Enable")}
          </button>
        )}
        <button onClick={handleOpenComments} style={{
          display: "inline-flex", alignItems: "center", gap: "6px",
          padding: "7px 16px", borderRadius: "7px", fontSize: "0.875rem", fontWeight: 600,
          background: "transparent", color: "var(--text-secondary, #888)",
          border: "1px solid rgba(0,0,0,0.1)", cursor: "pointer", fontFamily: "var(--font-base)",
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          Comments{commentCount > 0 ? ` (${commentCount})` : ""}
        </button>
        <button onClick={handleDelete} disabled={deleting} style={{
          padding: "7px 16px", borderRadius: "7px", fontSize: "0.875rem", fontWeight: 600,
          background: confirmDelete ? "rgba(239,68,68,0.12)" : "transparent",
          color: confirmDelete ? "#dc2626" : "var(--text-secondary, #888)",
          border: `1px solid ${confirmDelete ? "rgba(239,68,68,0.3)" : "rgba(0,0,0,0.1)"}`,
          cursor: deleting ? "not-allowed" : "pointer", fontFamily: "var(--font-base)",
        }}>
          {deleting ? "Deleting…" : confirmDelete ? "Confirm delete" : "Delete"}
        </button>
        {confirmDelete && (
          <button onClick={() => setConfirmDelete(false)} style={{
            padding: "7px 16px", borderRadius: "7px", fontSize: "0.875rem", fontWeight: 600,
            background: "transparent", color: "var(--text-secondary, #888)",
            border: "1px solid rgba(0,0,0,0.1)", cursor: "pointer", fontFamily: "var(--font-base)",
          }}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ── Inline skill runner ───────────────────────────────────────────────────────

function SkillRunner({ skill }: { skill: ClaudeSkill }) {
  const rawProps = (skill.input_schema?.properties ?? {}) as Record<string, { type?: string; description?: string; title?: string }>;
  const propKeys = Object.keys(rawProps);

  const [args, setArgs] = useState<Record<string, string>>(() =>
    Object.fromEntries(propKeys.map(k => [k, ""]))
  );
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [hasRun, setHasRun] = useState(false);

  async function handleRun() {
    setRunning(true);
    setResult(null);
    setRunError(null);
    setDurationMs(null);
    setHasRun(false);
    try {
      const coerced: Record<string, unknown> = {};
      for (const key of propKeys) {
        const val = args[key];
        const t = rawProps[key]?.type;
        if (t === "number" || t === "integer") coerced[key] = Number(val);
        else if (t === "boolean") coerced[key] = val === "true" || val === "1";
        else coerced[key] = val;
      }
      const { data } = await skillsApi.invoke(skill.id, coerced);
      setResult(data.result);
      setDurationMs(data.duration_ms);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Invocation failed.";
      setRunError(msg);
    } finally {
      setRunning(false);
      setHasRun(true);
    }
  }

  function handleUseInChat() {
    const text = skill.command || `Run skill: ${skill.name}`;
    window.dispatchEvent(new CustomEvent("chat-inject", { detail: { text } }));
  }

  const fieldStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: "6px",
    fontSize: "0.8125rem", border: "1px solid var(--border, rgba(0,0,0,0.15))",
    background: "var(--surface, #fff)", color: "var(--text-primary, #111)",
    fontFamily: "var(--font-mono, monospace)", outline: "none",
  };

  const resultText = result === null
    ? null
    : typeof result === "string"
      ? result
      : JSON.stringify(result, null, 2);

  return (
    <div style={{
      borderRadius: "10px", border: "1px solid var(--border, rgba(0,0,0,0.1))",
      background: "var(--surface-alt, rgba(0,0,0,0.02))", padding: "16px 18px",
    }}>
      <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary, #666)", letterSpacing: "0.04em", marginBottom: "12px" }}>
        TEST SKILL
      </div>

      {propKeys.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
          {propKeys.map(key => (
            <div key={key}>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary, #888)", marginBottom: "4px", letterSpacing: "0.03em" }}>
                {rawProps[key]?.title ?? key}
                {rawProps[key]?.description && (
                  <span style={{ fontWeight: 400, marginLeft: "6px", color: "var(--text-secondary, #aaa)" }}>
                    — {rawProps[key].description}
                  </span>
                )}
              </label>
              <input
                value={args[key] ?? ""}
                onChange={e => setArgs(prev => ({ ...prev, [key]: e.target.value }))}
                placeholder={rawProps[key]?.type ?? "string"}
                style={fieldStyle}
              />
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button
          onClick={handleRun}
          disabled={running || skill.status !== "approved"}
          title={skill.status !== "approved" ? "Skill must be approved before running" : undefined}
          style={{
            display: "inline-flex", alignItems: "center", gap: "6px",
            padding: "6px 16px", borderRadius: "6px", fontSize: "0.875rem", fontWeight: 600,
            background: skill.status === "approved" ? "var(--twilio-red, #e22)" : "rgba(0,0,0,0.08)",
            color: skill.status === "approved" ? "#fff" : "var(--text-secondary, #aaa)",
            border: "none", cursor: running || skill.status !== "approved" ? "not-allowed" : "pointer",
            opacity: running ? 0.7 : 1, fontFamily: "var(--font-base)", transition: "opacity 0.12s",
          }}
        >
          {running ? (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              Running…
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Run
            </>
          )}
        </button>
        <button
          onClick={handleUseInChat}
          style={{
            padding: "6px 14px", borderRadius: "6px", fontSize: "0.875rem", fontWeight: 600,
            background: "transparent", border: "1px solid rgba(0,0,0,0.15)",
            color: "var(--text-secondary, #666)", cursor: "pointer", fontFamily: "var(--font-base)",
          }}
        >
          Use in Chat
        </button>
      </div>

      {hasRun && !runError && resultText !== null && (
        <div style={{ marginTop: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary, #888)", letterSpacing: "0.04em" }}>RESULT</span>
            {durationMs !== null && (
              <span style={{ fontSize: "0.6875rem", color: "var(--text-secondary, #aaa)" }}>{durationMs}ms</span>
            )}
          </div>
          <pre style={{
            margin: 0, padding: "12px 14px", borderRadius: "8px",
            background: "rgba(0,0,0,0.04)", border: "1px solid var(--border, rgba(0,0,0,0.08))",
            fontSize: "0.8125rem", fontFamily: "var(--font-mono, monospace)",
            whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text-primary, #111)",
            maxHeight: "240px", overflowY: "auto",
          }}>
            {resultText}
          </pre>
        </div>
      )}

      {runError && (
        <div style={{
          marginTop: "10px", padding: "10px 12px", borderRadius: "7px", fontSize: "0.875rem",
          background: "rgba(239,68,68,0.08)", color: "#dc2626",
          border: "1px solid rgba(239,68,68,0.2)", lineHeight: 1.5,
        }}>
          {runError}
        </div>
      )}
    </div>
  );
}

// ── Twilio skill components ───────────────────────────────────────────────────

type LogoComponent = React.FC<React.SVGProps<SVGSVGElement>>;

const SLUG_LOGO_MAP: { test: (slug: string) => boolean; Logo: LogoComponent }[] = [
  { test: s => s.includes("messaging") || s.includes("sms") || s.includes("whatsapp") || s.includes("rcs") || s.includes("content-template") || s.includes("send-message") || s.includes("numbers-senders") || s.includes("conversations-classic") || s.includes("notifications"), Logo: MessagingLogo },
  { test: s => s.includes("voice") || s.includes("conference") || s.includes("call-recording") || s.includes("conversation-relay") || s.includes("twiml"), Logo: VoiceLogo },
  { test: s => s.includes("taskrouter"), Logo: TaskRouterLogo },
  { test: s => s.includes("notify"), Logo: NotifyLogo },
  { test: s => s.includes("sync"), Logo: SyncLogo },
  { test: s => s.includes("trust-hub") || s.includes("compliance") || s.includes("regulatory"), Logo: TrustHubLogo },
  { test: s => s.includes("understand") || s.includes("conversation-intelligence"), Logo: UnderstandLogo },
  { test: s => s.includes("virtual-agent") || s.includes("ai-agent") || s.includes("agent-augmentation") || s.includes("agent-connect") || s.includes("customer-support") || s.includes("customer-memory") || s.includes("conversation-orchestrator"), Logo: VirtualAgentLogo },
];

function getSkillLogo(slug: string): LogoComponent | null {
  return SLUG_LOGO_MAP.find(entry => entry.test(slug))?.Logo ?? null;
}

function TwilioSkillRow({ skill, selected, onSelect }: {
  skill: TwilioSkill; selected: boolean; onSelect: () => void;
}) {
  const Logo = getSkillLogo(skill.slug);
  return (
    <button onClick={onSelect} style={{
      display: "flex", alignItems: "flex-start", gap: "10px",
      width: "100%", textAlign: "left",
      padding: "10px 16px",
      background: selected ? "rgba(226,35,26,0.06)" : "transparent",
      borderTop: "none", borderRight: "none", borderBottom: "none",
      borderLeft: selected ? "3px solid var(--twilio-red, #e22)" : "3px solid transparent",
      cursor: "pointer", transition: "background 0.12s",
    }}>
      {Logo && (
        <div style={{ width: 20, height: 20, flexShrink: 0, marginTop: 1, color: "var(--twilio-red, #e22)", opacity: selected ? 1 : 0.65 }}>
          <Logo width={20} height={20} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "0.9375rem", fontWeight: 600, fontFamily: "var(--font-base)", color: "var(--text-primary, #111)" }}>
          {skill.name}
        </div>
        <p style={{
          margin: "2px 0 0", fontSize: "0.8125rem",
          color: "var(--text-secondary, #888)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          fontFamily: "var(--font-base)",
        }}>
          {skill.description}
        </p>
      </div>
    </button>
  );
}

function TwilioSkillDetail({ skill, onClose }: { skill: TwilioSkill; onClose: () => void }) {

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "24px 28px", overflowY: "auto", gap: "20px" }}>
      <button type="button" onClick={onClose} style={{
        display: "inline-flex", alignItems: "center", gap: "8px",
        alignSelf: "flex-start", background: "transparent", border: "none",
        cursor: "pointer", padding: "0", fontSize: "0.875rem",
        color: "var(--text-secondary, #888)", fontFamily: "var(--font-base)",
      }}
        onMouseEnter={e => (e.currentTarget.style.color = "var(--text-primary, #111)")}
        onMouseLeave={e => (e.currentTarget.style.color = "var(--text-secondary, #888)")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Back
      </button>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
        <div style={{
          width: "44px", height: "44px", borderRadius: "10px", flexShrink: 0,
          background: "rgba(226,35,26,0.08)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--twilio-red, #e22)",
        }}>
          {(() => { const Logo = getSkillLogo(skill.slug); return Logo ? <Logo width={26} height={26} /> : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--twilio-red, #e22)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
            </svg>
          ); })()}
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, fontFamily: "var(--font-base)" }}>{skill.name}</h2>
            <span style={{
              padding: "2px 8px", borderRadius: "4px", fontSize: "0.6875rem", fontWeight: 700,
              background: "rgba(226,35,26,0.08)", color: "var(--twilio-red, #e22)",
              letterSpacing: "0.05em", textTransform: "uppercase",
            }}>{skill.group}</span>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: "0.875rem", color: "var(--text-secondary, #666)", lineHeight: 1.5 }}>
            {skill.description}
          </p>
        </div>
      </div>

      {/* Slash command */}
      <div style={{ padding: "12px 16px", borderRadius: "8px", background: "rgba(0,0,0,0.03)", border: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
        <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-secondary, #888)", letterSpacing: "0.05em", marginBottom: "6px" }}>INVOKE IN CLAUDE</div>
        <code style={{
          display: "block", padding: "6px 10px", borderRadius: "5px", fontSize: "0.8125rem",
          background: "rgba(0,0,0,0.05)", fontFamily: "var(--font-mono, monospace)",
          color: "var(--twilio-red, #e22)", fontWeight: 600,
        }}>/{skill.slug}</code>
        <p style={{ margin: "8px 0 0", fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", lineHeight: 1.5 }}>
          Type this in the Agent chat to invoke this Twilio skill.
        </p>
      </div>

      {/* Use skill button */}
      <div>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("chat-inject", { detail: { text: `/${skill.slug}` } }))}
          style={{
            padding: "8px 20px", borderRadius: "7px", fontSize: "0.875rem", fontWeight: 600,
            background: "var(--twilio-red, #e22)", color: "#fff", border: "none",
            cursor: "pointer", fontFamily: "var(--font-base)",
          }}
        >
          Use in Chat
        </button>
        <p style={{ margin: "8px 0 0", fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", lineHeight: 1.5 }}>
          Sends <code>/{skill.slug}</code> to the chat bar below. This skill is provided by the{" "}
          <strong>twilio-developer-kit@twilio</strong> plugin and available in every Claude conversation.
        </p>
      </div>
    </div>
  );
}

const STARTER_CODE = `async def my_skill(**kwargs):
    """One-line description shown to Claude as the tool description."""
    # Implement your tool logic here.
    # Return a plain value — dict, list, or string.
    return {"result": "hello from my_skill"}
`;

function NewSkillForm({ onCreated, onBack, prefill }: {
  onCreated: (s: ClaudeSkill) => void;
  onBack: () => void;
  prefill?: { name: string; code: string; description: string };
}) {
  const [name, setName] = useState(prefill?.name ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [code, setCode] = useState(prefill?.code ?? STARTER_CODE);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleGenerate() {
    if (!description.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const effectiveName = name.trim() || description.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 40);
      const { data } = await skillsApi.generateCode(effectiveName, description.trim());
      setCode(data.code);
      if (!name.trim()) setName(effectiveName);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Generation failed — check server logs.";
      setError(msg);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !description.trim() || !code.trim()) return;
    setSaving(true); setError(null);
    try {
      const { data } = await skillsApi.create({ name: name.trim(), description: description.trim(), code: code.trim() });
      onCreated(data);
      setName(""); setDescription(""); setCode(STARTER_CODE);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to create skill.";
      setError(msg);
    } finally { setSaving(false); }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCode(text);
      if (!name) setName(file.name.replace(/\.py$/, "").replace(/[_-]/g, " "));
    };
    reader.readAsText(file);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    padding: "8px 12px", borderRadius: "7px", fontSize: "0.875rem",
    border: "1px solid var(--border, rgba(0,0,0,0.12))",
    background: "var(--surface, #fff)", outline: "none",
    fontFamily: "var(--font-base)",
  };

  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: "0.8125rem", fontWeight: 600,
    color: "var(--text-secondary, #666)", marginBottom: "6px", letterSpacing: "0.04em",
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px", padding: "24px 28px" }}>
      {/* Back button */}
      <button type="button" onClick={onBack} style={{
        display: "inline-flex", alignItems: "center", gap: "8px",
        alignSelf: "flex-start", background: "transparent", border: "none",
        cursor: "pointer", padding: "0", fontSize: "0.875rem",
        color: "var(--text-secondary, #888)", fontFamily: "var(--font-base)",
      }}
        onMouseEnter={e => (e.currentTarget.style.color = "var(--text-primary, #111)")}
        onMouseLeave={e => (e.currentTarget.style.color = "var(--text-secondary, #888)")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Back
      </button>

      <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700, fontFamily: "var(--font-base)" }}>
        Add New Skill
      </h3>

      <div>
        <label style={labelStyle}>SKILL NAME</label>
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. fetch_account_health" required style={inputStyle} />
      </div>

      <div>
        <label style={labelStyle}>
          DESCRIPTION <span style={{ fontWeight: 400, opacity: 0.7 }}>(shown to Claude)</span>
        </label>
        <textarea value={description} onChange={e => setDescription(e.target.value)}
          placeholder="What does this skill do? Claude uses this to decide when to invoke it."
          required rows={3}
          style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} />
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px", gap: "8px" }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>PYTHON CODE</label>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || !description.trim()}
              title={!description.trim() ? "Enter a description first" : "Generate code from description"}
              style={{
                display: "inline-flex", alignItems: "center", gap: "6px",
                padding: "8px 16px", borderRadius: "8px", fontSize: "0.875rem", fontWeight: 600,
                background: description.trim() ? "rgba(226,35,26,0.08)" : "transparent",
                border: `1px solid ${description.trim() ? "rgba(226,35,26,0.3)" : "rgba(0,0,0,0.1)"}`,
                color: description.trim() ? "var(--twilio-red, #e22)" : "var(--text-secondary, #bbb)",
                cursor: (generating || !description.trim()) ? "not-allowed" : "pointer",
                opacity: generating ? 0.7 : 1,
                fontFamily: "var(--font-base)", transition: "all 0.15s",
              }}>
              {generating ? (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                  Generating…
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                  </svg>
                  Generate with Claude
                </>
              )}
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} style={{
              padding: "8px 16px", borderRadius: "8px", fontSize: "0.875rem", fontWeight: 500,
              background: "transparent", border: "1px solid rgba(0,0,0,0.15)",
              color: "var(--text-secondary, #666)", cursor: "pointer", fontFamily: "var(--font-base)",
            }}>
              Upload .py
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".py" onChange={handleFileUpload} style={{ display: "none" }} />
        </div>
        <CodeEditor value={code} onChange={setCode} placeholder={STARTER_CODE} />
        <p style={{ margin: "10px 0 0", fontSize: "0.875rem", color: "var(--text-secondary, #888)", lineHeight: 1.5 }}>
          Must be an <code>async def</code> function. Avoid importing <code>os</code>, <code>subprocess</code>, <code>socket</code>, or other system-level modules — Claude will reject them during review.
        </p>
      </div>

      {error && (
        <p style={{ margin: 0, padding: "10px 14px", borderRadius: "7px", fontSize: "0.8125rem", background: "rgba(239,68,68,0.08)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.2)" }}>
          {error}
        </p>
      )}

      <button type="submit" disabled={saving || !name.trim() || !description.trim() || !code.trim()} style={{
        padding: "8px 20px", borderRadius: "7px", fontSize: "0.875rem", fontWeight: 600,
        background: "var(--twilio-red, #e22)", color: "#fff", border: "none",
        cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1,
        alignSelf: "flex-start", fontFamily: "var(--font-base)",
      }}>
        {saving ? "Saving…" : "Save Skill"}
      </button>
    </form>
  );
}

function SkillRow({ skill, selected, onSelect }: {
  skill: ClaudeSkill; selected: boolean; onSelect: () => void;
}) {
  const s = STATUS_STYLES[skill.status];
  const [hovered, setHovered] = useState(false);
  const { onContextMenu } = useRightClickComment("claude_skill", skill.id, skill.name);
  const bg = selected
    ? "rgba(59,130,246,0.08)"
    : hovered ? "rgba(0,0,0,0.04)" : "transparent";
  return (
    <button
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "stretch",
        width: "100%", textAlign: "left",
        height: "56px", boxSizing: "border-box",
        padding: "0",
        background: bg,
        border: "none",
        borderTop: "1px solid rgba(0,0,0,0.07)",
        borderBottom: "1px solid rgba(0,0,0,0.07)",
        borderRadius: "0",
        outline: "none",
        marginBottom: "-1px",
        cursor: "pointer",
        transition: "background 0.1s",
      }}
    >
      <div style={{ flex: 1, minWidth: 0, padding: "0 8px 0 16px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <span style={{
          fontSize: "0.8125rem", fontWeight: 600, fontFamily: "var(--font-base)",
          color: "var(--text-primary, #111)", display: "block",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {skill.name}
        </span>
        {skill.command ? (
          <span style={{
            marginTop: "2px", fontSize: "0.6875rem",
            color: "var(--twilio-red, #e22)", fontWeight: 600,
            fontFamily: "var(--font-mono, monospace)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block",
          }}>
            {skill.command}
          </span>
        ) : (
          <span style={{
            marginTop: "2px", fontSize: "0.75rem",
            color: "var(--text-secondary, #888)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            fontFamily: "var(--font-base)", display: "block",
          }}>
            {skill.description}
          </span>
        )}
      </div>
      {/* Rotated status strip on the right — width must exceed the text length after rotation */}
      <div style={{
        width: "18px", flexShrink: 0,
        background: s.bg,
        position: "relative",
        overflow: "hidden",
      }}>
        <span style={{
          position: "absolute",
          top: "50%", left: "50%",
          transform: "translate(-50%, -50%) rotate(90deg)",
          fontSize: "0.5rem", fontWeight: 700, letterSpacing: "0.07em",
          color: s.color, whiteSpace: "nowrap",
          lineHeight: 1,
        }}>
          {s.strip}
        </span>
      </div>
    </button>
  );
}

type PageTab = "claude-tools" | "twilio" | "agent-skills" | "claude-skills" | "agent-crud";

function AgentPMPanel({ filterTerm, onFilterChange }: { filterTerm: string; onFilterChange: (v: string) => void }) {
  const [skills, setSkills] = useState<ClaudeSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [prefill, setPrefill] = useState<{ name: string; code: string; description: string } | undefined>(undefined);
  const [skillFiles, setSkillFiles] = useState<SkillFile[]>([]);

  useEffect(() => {
    skillsApi.list().then(({ data }) => setSkills(data.results)).finally(() => setLoading(false));
    skillsApi.listFiles().then(({ data }) => setSkillFiles(data)).catch(() => {});
  }, []);

  function handleCreated(skill: ClaudeSkill) {
    setSkills(prev => [skill, ...prev]);
    setSelectedId(skill.id);
    setShowNewForm(false);
    setPrefill(undefined);
    setSkillFiles(prev => prev.filter(f => f.name !== skill.name));
  }

  function handleUpdated(skill: ClaudeSkill) {
    setSkills(prev => prev.map(s => s.id === skill.id ? skill : s));
  }

  function openNewSkillForm() {
    setShowNewForm(true);
    setSelectedId(null);
    setPrefill(undefined);
    window.dispatchEvent(new Event("skill-assistant-open"));
  }

  function handleImportFile(file: SkillFile) {
    setPrefill({ name: file.name, code: file.code, description: file.first_line_description });
    setShowNewForm(true);
    setSelectedId(null);
  }

  const selected = skills.find(s => s.id === selectedId) ?? null;
  const termLower = filterTerm.toLowerCase();
  const visibleSkills = termLower
    ? skills.filter(s =>
        s.name.toLowerCase().includes(termLower) ||
        s.description.toLowerCase().includes(termLower) ||
        (s.command ?? "").toLowerCase().includes(termLower)
      )
    : skills;

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* Left panel */}
      <div style={{
        width: "300px", flexShrink: 0, borderRight: "1px solid var(--border, rgba(0,0,0,0.08))",
        display: "flex", flexDirection: "column", background: "var(--surface, #fff)", overflowY: "auto",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-secondary, #666)", letterSpacing: "0.04em" }}>CLAUDE TOOLS</span>
            <button onClick={openNewSkillForm} style={{
              padding: "4px 10px", borderRadius: "5px", fontSize: "0.8125rem", fontWeight: 600,
              background: "var(--twilio-red, #e22)", color: "#fff", border: "none", cursor: "pointer",
            }}>
              + New
            </button>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: "0.8125rem", color: "var(--text-secondary, #888)", lineHeight: 1.4 }}>
            Custom Python tools registered into this app.
          </p>
          <SkillSearchInput value={filterTerm} onChange={onFilterChange} />
          {filterTerm && (
            <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--text-secondary, #aaa)" }}>
              {visibleSkills.length} result{visibleSkills.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>

        {/* Stats */}
        <div style={{ display: "flex", padding: "8px 16px", gap: "16px", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))", background: "var(--surface-alt, rgba(0,0,0,0.02))" }}>
          {(["approved", "pending_review", "rejected"] as ClaudeSkillStatus[]).map(s => (
            <div key={s} style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1rem", fontWeight: 700, color: STATUS_STYLES[s].color }}>
                {skills.filter(sk => sk.status === s).length}
              </div>
              <div style={{ fontSize: "0.6875rem", color: "var(--text-secondary, #aaa)", letterSpacing: "0.03em" }}>
                {STATUS_STYLES[s].label}
              </div>
            </div>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div style={{ padding: "24px 16px", fontSize: "0.875rem", color: "var(--text-secondary, #888)" }}>Loading…</div>
        ) : skills.length === 0 ? (
          <div style={{ padding: "24px 16px", fontSize: "0.875rem", color: "var(--text-secondary, #888)" }}>
            No skills yet. Click <strong>+ New</strong> to add one.
          </div>
        ) : visibleSkills.length === 0 ? (
          <div style={{ padding: "24px 16px", fontSize: "0.875rem", color: "var(--text-secondary, #888)" }}>
            No skills match "{filterTerm}".
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto" }}>
            {visibleSkills.map(skill => (
              <SkillRow key={skill.id} skill={skill}
                selected={skill.id === selectedId}
                onSelect={() => { setSelectedId(skill.id); setShowNewForm(false); setPrefill(undefined); }}
              />
            ))}
          </div>
        )}

        {skillFiles.length > 0 && (
          <div style={{ borderTop: "1px solid var(--border, rgba(0,0,0,0.08))", paddingTop: "4px" }}>
            <div style={{
              padding: "8px 16px 4px",
              fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.07em",
              color: "var(--text-secondary, #aaa)", textTransform: "uppercase",
            }}>
              From Files
            </div>
            {skillFiles.map(file => (
              <button
                key={file.filename}
                onClick={() => handleImportFile(file)}
                style={{
                  display: "flex", alignItems: "flex-start", gap: "10px",
                  width: "100%", textAlign: "left",
                  padding: "9px 16px",
                  background: "transparent",
                  borderTop: "none", borderRight: "none", borderBottom: "none",
                  borderLeft: "3px solid transparent",
                  cursor: "pointer",
                  transition: "background 0.12s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,0,0,0.03)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary, #aaa)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: "2px", flexShrink: 0 }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-primary, #111)", fontFamily: "var(--font-mono, monospace)" }}>
                    {file.filename}
                  </div>
                  {file.first_line_description && (
                    <div style={{
                      fontSize: "0.75rem", color: "var(--text-secondary, #888)", marginTop: "1px",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {file.first_line_description}
                    </div>
                  )}
                </div>
                <span style={{
                  marginLeft: "auto", flexShrink: 0,
                  fontSize: "0.625rem", fontWeight: 600, padding: "2px 6px",
                  borderRadius: "4px", background: "rgba(59,130,246,0.1)", color: "#3b82f6",
                }}>
                  Import
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto", background: "var(--bg, var(--twilio-gray-10, #f5f5f5))" }}>
        {showNewForm ? (
          <NewSkillForm onCreated={handleCreated} prefill={prefill} onBack={() => { setShowNewForm(false); setPrefill(undefined); }} />
        ) : selected ? (
          <SkillDetail key={selected.id} skill={selected} onClose={() => setSelectedId(null)} onUpdated={handleUpdated} />
        ) : (
          <div style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: "32px", padding: "80px",
          }}>
            <div style={{
              width: "124px", height: "124px", borderRadius: "32px",
              background: "rgba(226,35,26,0.06)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="var(--twilio-red, #e22)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6"/>
                <polyline points="8 6 2 12 8 18"/>
              </svg>
            </div>
            <div style={{ textAlign: "center" }}>
              <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>Build custom tools for Claude</h2>
              <p style={{ margin: "10px 0 0", fontSize: "0.875rem", color: "var(--text-secondary, #888)", maxWidth: "560px", lineHeight: 1.6 }}>
                Submit a Python <code>async def</code> function. Claude will review the code for safety,
                and if approved it's instantly available for all users in every conversation.
              </p>
            </div>
            <button onClick={openNewSkillForm} style={{
              padding: "9px 22px", borderRadius: "8px", fontSize: "0.875rem", fontWeight: 600,
              background: "var(--twilio-red, #e22)", color: "#fff", border: "none", cursor: "pointer",
            }}>
              + Create your first skill
            </button>
            <div style={{
              marginTop: "12px", display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)", gap: "14px", maxWidth: "800px", width: "100%",
            }}>
              {[
                { step: "1", title: "Write or upload", body: "Paste Python code or upload a .py file. Add a name and description." },
                { step: "2", title: "Claude reviews it", body: "An agent checks for safety and quality. Feedback is shown inline." },
                { step: "3", title: "Live for everyone", body: "Approved skills are registered into the MCP server and available instantly." },
              ].map(({ step, title, body }) => (
                <div key={step} style={{
                  padding: "16px", borderRadius: "10px",
                  border: "1px solid var(--border, rgba(0,0,0,0.08))",
                  background: "var(--surface, #fff)",
                }}>
                  <div style={{
                    width: "28px", height: "28px", borderRadius: "50%",
                    background: "var(--twilio-red, #e22)", color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "0.875rem", fontWeight: 700, marginBottom: "10px",
                  }}>{step}</div>
                  <div style={{ fontSize: "0.875rem", fontWeight: 700, marginBottom: "4px" }}>{title}</div>
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #888)", lineHeight: 1.5 }}>{body}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SkillSearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ position: "relative", marginTop: "8px" }}>
      <svg
        width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
        style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", color: "var(--text-secondary, #aaa)", pointerEvents: "none" }}
      >
        <circle cx="6.5" cy="6.5" r="4.5" /><path d="M10.5 10.5L14 14" strokeLinecap="round" />
      </svg>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Filter skills…"
        style={{
          width: "100%", boxSizing: "border-box",
          padding: "5px 26px 5px 28px",
          borderRadius: "6px", fontSize: "0.8125rem",
          border: "1px solid rgba(0,0,0,0.12)",
          background: "rgba(0,0,0,0.03)",
          outline: "none", fontFamily: "var(--font-base)",
          color: "var(--text-primary, #111)",
        }}
      />
      {value && (
        <button
          onClick={() => onChange("")}
          style={{
            position: "absolute", right: "6px", top: "50%", transform: "translateY(-50%)",
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-secondary, #aaa)", fontSize: "0.875rem", lineHeight: 1, padding: "2px",
          }}
          title="Clear filter"
        >×</button>
      )}
    </div>
  );
}

function TwilioPanel({ filterTerm, onFilterChange }: { filterTerm: string; onFilterChange: (v: string) => void }) {
  const twilioSkills = TWILIO_SKILLS.filter(s => s.group === "Twilio");
  const sendgridSkills = TWILIO_SKILLS.filter(s => s.group === "SendGrid");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [filterGroup, setFilterGroup] = useState<TwilioSkillGroup | "All">("All");

  const selected = TWILIO_SKILLS.find(s => s.slug === selectedSlug) ?? null;

  const termLower = filterTerm.toLowerCase();
  const matchesTerm = (s: TwilioSkill) =>
    !termLower ||
    s.name.toLowerCase().includes(termLower) ||
    s.description.toLowerCase().includes(termLower) ||
    s.group.toLowerCase().includes(termLower);

  const visibleTwilio = (filterGroup === "SendGrid" ? [] : twilioSkills).filter(matchesTerm);
  const visibleSendGrid = (filterGroup === "Twilio" ? [] : sendgridSkills).filter(matchesTerm);

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* Left panel */}
      <div style={{
        width: "300px", flexShrink: 0, borderRight: "1px solid var(--border, rgba(0,0,0,0.08))",
        display: "flex", flexDirection: "column", background: "var(--surface, #fff)",
      }}>
        <div style={{ padding: "16px 16px 10px", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
          <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-secondary, #666)", letterSpacing: "0.04em" }}>
            TWILIO DEVELOPER KIT
          </span>
          <p style={{ margin: "4px 0 8px", fontSize: "0.8125rem", color: "var(--text-secondary, #888)", lineHeight: 1.4 }}>
            {TWILIO_SKILLS.length} skills from <code style={{ fontSize: "0.75rem" }}>twilio-developer-kit@twilio</code>
          </p>
          {/* Group filter */}
          <div style={{ display: "flex", gap: "6px" }}>
            {(["All", "Twilio", "SendGrid"] as const).map(g => (
              <button key={g} onClick={() => setFilterGroup(g)} style={{
                padding: "3px 10px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 600,
                border: filterGroup === g ? "1.5px solid var(--twilio-red, #e22)" : "1.5px solid rgba(0,0,0,0.12)",
                background: filterGroup === g ? "rgba(226,35,26,0.07)" : "transparent",
                color: filterGroup === g ? "var(--twilio-red, #e22)" : "var(--text-secondary, #888)",
                cursor: "pointer", fontFamily: "var(--font-base)", transition: "all 0.12s",
              }}>{g}</button>
            ))}
          </div>
          <SkillSearchInput value={filterTerm} onChange={onFilterChange} />
          {filterTerm && (
            <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--text-secondary, #aaa)" }}>
              {visibleTwilio.length + visibleSendGrid.length} result{visibleTwilio.length + visibleSendGrid.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {visibleTwilio.length > 0 && (
            <>
              <div style={{ padding: "8px 16px 4px", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.07em", color: "var(--text-secondary, #aaa)", textTransform: "uppercase" }}>
                Twilio — {visibleTwilio.length}
              </div>
              {visibleTwilio.map(skill => (
                <TwilioSkillRow key={skill.slug} skill={skill}
                  selected={skill.slug === selectedSlug}
                  onSelect={() => setSelectedSlug(skill.slug)}
                />
              ))}
            </>
          )}
          {visibleSendGrid.length > 0 && (
            <>
              <div style={{ padding: "8px 16px 4px", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.07em", color: "var(--text-secondary, #aaa)", textTransform: "uppercase", borderTop: visibleTwilio.length > 0 ? "1px solid var(--border, rgba(0,0,0,0.06))" : undefined, marginTop: visibleTwilio.length > 0 ? "8px" : undefined }}>
                SendGrid — {visibleSendGrid.length}
              </div>
              {visibleSendGrid.map(skill => (
                <TwilioSkillRow key={skill.slug} skill={skill}
                  selected={skill.slug === selectedSlug}
                  onSelect={() => setSelectedSlug(skill.slug)}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto", background: "var(--bg, var(--twilio-gray-10, #f5f5f5))" }}>
        {selected ? (
          <TwilioSkillDetail skill={selected} onClose={() => setSelectedSlug(null)} />
        ) : (
          <div style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: "20px", padding: "60px",
          }}>
            <div style={{
              width: "108px", height: "108px", borderRadius: "28px",
              background: "rgba(226,35,26,0.06)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="var(--twilio-red, #e22)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div style={{ textAlign: "center" }}>
              <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700 }}>Twilio Developer Kit</h2>
              <p style={{ margin: "8px 0 0", fontSize: "0.875rem", color: "var(--text-secondary, #888)", maxWidth: "480px", lineHeight: 1.6 }}>
                {TWILIO_SKILLS.length} skills covering SMS, Voice, WhatsApp, RCS, AI agents, SendGrid, compliance, and more.
                Select a skill from the sidebar to see details and how to invoke it.
              </p>
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <div style={{ padding: "10px 16px", borderRadius: "8px", background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", textAlign: "center" }}>
                <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--twilio-red, #e22)" }}>{twilioSkills.length}</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary, #aaa)" }}>Twilio Skills</div>
              </div>
              <div style={{ padding: "10px 16px", borderRadius: "8px", background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", textAlign: "center" }}>
                <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--twilio-red, #e22)" }}>{sendgridSkills.length}</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary, #aaa)" }}>SendGrid Skills</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Agent Skills reference panel ─────────────────────────────────────────────

interface SkillDef {
  icon: string;
  name: string;
  description: string;
  ops: { op: "Create" | "Read" | "Update" | "Delete"; label: string }[];
  examples: string[];
  deleteNote?: string;
}

const AGENT_SKILL_DEFS: SkillDef[] = [
  {
    icon: "✅",
    name: "Action Items",
    description: "Tasks tracked across accounts and team members, synced bidirectionally with Airtable.",
    ops: [
      { op: "Create", label: "create_action_item" },
      { op: "Read",   label: "get_airtable_records / search_records" },
      { op: "Update", label: "update_action_item" },
      { op: "Delete", label: "delete_action_item" },
    ],
    examples: [
      "Create an action item to prep the Acme deck, due Friday, high priority",
      "Mark the onboarding action item for Acme as Done",
      "What are all open action items for Globex?",
      "Reassign that action item about the API migration to Sarah",
      "Delete the action item about the old Salesforce integration",
    ],
  },
  {
    icon: "📅",
    name: "Meetings",
    description: "Meeting records synced from Airtable — includes topics, notes, and account links.",
    ops: [
      { op: "Read",   label: "get_airtable_records / search_records" },
      { op: "Update", label: "update_meeting" },
      { op: "Delete", label: "delete_meeting" },
    ],
    examples: [
      "Find the meeting where we discussed pricing with Acme",
      "Update the notes for last week's Globex kickoff meeting",
      "What were the expected topics for the Q2 QBR?",
      "Delete the duplicate meeting stub for Initech",
    ],
  },
  {
    icon: "🗓️",
    name: "Calendar Events",
    description: "Scheduled events on the in-app calendar. Can push to Google Calendar for primary-calendar events.",
    ops: [
      { op: "Create", label: "create_calendar_event" },
      { op: "Read",   label: "get_calendar_events / search_records" },
      { op: "Update", label: "update_calendar_event" },
      { op: "Delete", label: "delete_calendar_event" },
    ],
    examples: [
      "Schedule a call with the Acme team next Tuesday at 2pm",
      "What's on my calendar this week?",
      "Move the Globex demo to Thursday at 3pm",
      "Cancel the standup on July 4th",
    ],
  },
  {
    icon: "🏢",
    name: "Accounts",
    description: "Client accounts. The agent can read, update details, and add notes. Accounts cannot be deleted via the agent.",
    ops: [
      { op: "Read",   label: "get_airtable_records / search_records" },
      { op: "Update", label: "update_account" },
      { op: "Create", label: "add_account_note" },
    ],
    deleteNote: "Accounts cannot be deleted via the agent — use the Accounts page.",
    examples: [
      "Show me all active accounts",
      "Update Acme's status to Active and set ARR to $120,000",
      "Add a note to Globex: they mentioned interest in the enterprise plan",
      "What's Initech's current health score?",
      "That meeting where Acme said they wanted 3 more seats — log that as a note",
    ],
  },
];

const OP_COLORS: Record<string, { bg: string; color: string }> = {
  Create: { bg: "rgba(34,197,94,0.12)",   color: "#16a34a" },
  Read:   { bg: "rgba(59,130,246,0.12)",  color: "#2563eb" },
  Update: { bg: "rgba(234,179,8,0.12)",   color: "#ca8a04" },
  Delete: { bg: "rgba(239,68,68,0.12)",   color: "#dc2626" },
};

function AgentSkillsPanel() {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  function injectToChat(text: string) {
    window.dispatchEvent(new CustomEvent("chat-inject", { detail: { text } }));
  }

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>

      {/* Left sidebar — record type list */}
      <div style={{
        width: "240px", flexShrink: 0,
        borderRight: "1px solid var(--border, rgba(0,0,0,0.08))",
        display: "flex", flexDirection: "column",
        background: "var(--surface, #fff)", overflowY: "auto",
      }}>
        <div style={{ padding: "16px 16px 10px", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
          <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-secondary, #666)", letterSpacing: "0.04em" }}>
            RECORD TYPES
          </span>
          <p style={{ margin: "4px 0 0", fontSize: "0.8125rem", color: "var(--text-secondary, #888)", lineHeight: 1.4 }}>
            What the agent can do with each.
          </p>
        </div>
        {AGENT_SKILL_DEFS.map((s, i) => (
          <button
            key={s.name}
            onClick={() => setActiveIdx(i)}
            style={{
              display: "flex", alignItems: "center", gap: "10px",
              width: "100%", textAlign: "left", padding: "12px 16px",
              background: activeIdx === i ? "rgba(226,35,26,0.06)" : "transparent",
              borderTop: "none", borderRight: "none",
              borderBottom: "1px solid rgba(0,0,0,0.05)",
              borderLeft: activeIdx === i ? "3px solid var(--twilio-red, #e22)" : "3px solid transparent",
              cursor: "pointer", transition: "background 0.1s",
            }}
            onMouseEnter={e => { if (activeIdx !== i) e.currentTarget.style.background = "rgba(0,0,0,0.03)"; }}
            onMouseLeave={e => { if (activeIdx !== i) e.currentTarget.style.background = "transparent"; }}
          >
            <span style={{ fontSize: "1.25rem", flexShrink: 0 }}>{s.icon}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-primary, #111)", fontFamily: "var(--font-base)" }}>
                {s.name}
              </div>
              <div style={{ display: "flex", gap: "4px", marginTop: "4px", flexWrap: "wrap" }}>
                {s.ops.map(op => (
                  <span key={op.op} style={{
                    fontSize: "0.5625rem", fontWeight: 700, padding: "1px 5px", borderRadius: "3px",
                    background: OP_COLORS[op.op]?.bg, color: OP_COLORS[op.op]?.color,
                    letterSpacing: "0.04em",
                  }}>{op.op}</span>
                ))}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, overflowY: "auto", background: "var(--bg, #f5f5f5)" }}>
        {activeIdx === null ? (
          /* Overview state */
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: "28px", padding: "60px 40px", textAlign: "center", minHeight: "100%",
          }}>
            <div style={{
              width: "96px", height: "96px", borderRadius: "28px",
              background: "rgba(226,35,26,0.06)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--twilio-red, #e22)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.375rem", fontWeight: 700, fontFamily: "var(--font-base)" }}>
                Agent CRU(D) Capabilities
              </h2>
              <p style={{ margin: "12px 0 0", fontSize: "0.9375rem", color: "var(--text-secondary, #777)", maxWidth: "540px", lineHeight: 1.7 }}>
                The agent can <strong>Create</strong>, <strong>Read</strong>, <strong>Update</strong>, and in most cases <strong>Delete</strong> records across your platform — by text or voice, from any page.
              </p>
            </div>

            {/* CRU(D) summary grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "14px", maxWidth: "680px", width: "100%" }}>
              {[
                { op: "Create", icon: "✨", text: "Action items, calendar events, account notes — say it once, it's logged." },
                { op: "Read",   icon: "🔍", text: "Look up any record by keyword. Reference 'that meeting where…' and the agent finds it." },
                { op: "Update", icon: "✏️",  text: "Change status, priority, notes, dates, assignees — across any record type." },
                { op: "Delete", icon: "🗑️",  text: "Remove action items, meetings, and calendar events. Accounts and users are protected." },
              ].map(({ op, icon, text }) => (
                <div key={op} style={{
                  padding: "16px 18px", borderRadius: "12px",
                  background: "var(--surface, #fff)",
                  border: "1px solid var(--border, rgba(0,0,0,0.08))",
                  textAlign: "left",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                    <span style={{ fontSize: "1.25rem" }}>{icon}</span>
                    <span style={{
                      fontSize: "0.6875rem", fontWeight: 800, letterSpacing: "0.07em",
                      padding: "2px 7px", borderRadius: "4px",
                      background: OP_COLORS[op]?.bg, color: OP_COLORS[op]?.color,
                    }}>{op.toUpperCase()}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--text-secondary, #666)", lineHeight: 1.55 }}>
                    {text}
                  </p>
                </div>
              ))}
            </div>

            {/* Voice callout */}
            <div style={{
              maxWidth: "680px", width: "100%",
              padding: "16px 20px", borderRadius: "12px",
              background: "rgba(226,35,26,0.04)",
              border: "1.5px solid rgba(226,35,26,0.18)",
              display: "flex", gap: "14px", alignItems: "flex-start", textAlign: "left",
            }}>
              <span style={{ fontSize: "1.5rem", flexShrink: 0 }}>🎙️</span>
              <div>
                <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--twilio-red, #e22)", marginBottom: "4px" }}>
                  Works from voice sessions too
                </div>
                <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--text-secondary, #666)", lineHeight: 1.6 }}>
                  Start a voice session from any page and speak naturally — "Mark the Acme onboarding task as done" or "Add a note to Globex, they want to expand to 3 seats." The agent resolves vague references, looks up records, and applies updates hands-free.
                </p>
              </div>
            </div>

            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--text-secondary, #aaa)" }}>
              Select a record type on the left to see specific capabilities and example prompts.
            </p>
          </div>
        ) : (
          /* Detail for selected record type */
          (() => {
            const skill = AGENT_SKILL_DEFS[activeIdx]!;
            return (
              <div style={{ padding: "32px 40px", display: "flex", flexDirection: "column", gap: "24px" }}>

                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  <span style={{ fontSize: "2rem" }}>{skill.icon}</span>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.375rem", fontWeight: 700, fontFamily: "var(--font-base)" }}>
                      {skill.name}
                    </h2>
                    <p style={{ margin: "4px 0 0", fontSize: "0.875rem", color: "var(--text-secondary, #666)", lineHeight: 1.5 }}>
                      {skill.description}
                    </p>
                  </div>
                </div>

                {/* Operations */}
                <div>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.07em", color: "var(--text-secondary, #999)", marginBottom: "10px" }}>
                    SUPPORTED OPERATIONS
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {skill.ops.map(op => (
                      <div key={op.op} style={{
                        display: "flex", alignItems: "center", gap: "12px",
                        padding: "10px 14px", borderRadius: "8px",
                        background: "var(--surface, #fff)",
                        border: "1px solid var(--border, rgba(0,0,0,0.08))",
                      }}>
                        <span style={{
                          flexShrink: 0, fontSize: "0.6875rem", fontWeight: 800,
                          padding: "3px 8px", borderRadius: "4px", letterSpacing: "0.05em",
                          background: OP_COLORS[op.op]?.bg, color: OP_COLORS[op.op]?.color,
                          minWidth: "52px", textAlign: "center",
                        }}>{op.op}</span>
                        <code style={{
                          fontSize: "0.8125rem", fontFamily: "var(--font-mono, monospace)",
                          color: "var(--text-primary, #111)", background: "rgba(0,0,0,0.04)",
                          padding: "2px 7px", borderRadius: "4px",
                        }}>{op.label}</code>
                      </div>
                    ))}
                  </div>
                  {skill.deleteNote && (
                    <div style={{
                      marginTop: "10px", padding: "10px 14px", borderRadius: "8px",
                      background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)",
                      fontSize: "0.8125rem", color: "#dc2626", lineHeight: 1.5,
                    }}>
                      ⚠️ {skill.deleteNote}
                    </div>
                  )}
                </div>

                {/* Example prompts */}
                <div>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.07em", color: "var(--text-secondary, #999)", marginBottom: "10px" }}>
                    EXAMPLE PROMPTS — click to send to chat
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {skill.examples.map((ex, i) => (
                      <button
                        key={i}
                        onClick={() => injectToChat(ex)}
                        style={{
                          textAlign: "left", padding: "10px 14px", borderRadius: "8px",
                          background: "var(--surface, #fff)",
                          border: "1px solid var(--border, rgba(0,0,0,0.08))",
                          cursor: "pointer", fontSize: "0.875rem", fontFamily: "var(--font-base)",
                          color: "var(--text-primary, #111)", lineHeight: 1.5,
                          display: "flex", alignItems: "center", gap: "10px",
                          transition: "border-color 0.12s, background 0.12s",
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.borderColor = "var(--twilio-red, #e22)";
                          e.currentTarget.style.background = "rgba(226,35,26,0.03)";
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.borderColor = "var(--border, rgba(0,0,0,0.08))";
                          e.currentTarget.style.background = "var(--surface, #fff)";
                        }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--twilio-red, #e22)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                        </svg>
                        <span style={{ flex: 1 }}>"{ex}"</span>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary, #aaa)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                          <path d="M5 12h14"/><polyline points="12 5 19 12 12 19"/>
                        </svg>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Fuzzy lookup callout */}
                <div style={{
                  padding: "16px 20px", borderRadius: "12px",
                  background: "rgba(59,130,246,0.05)",
                  border: "1px solid rgba(59,130,246,0.18)",
                  display: "flex", gap: "12px", alignItems: "flex-start",
                }}>
                  <span style={{ fontSize: "1.25rem", flexShrink: 0 }}>🔍</span>
                  <div>
                    <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#2563eb", marginBottom: "4px" }}>
                      Fuzzy lookup — no ID required
                    </div>
                    <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--text-secondary, #666)", lineHeight: 1.6 }}>
                      You never need to know a record ID. Say "that meeting where we discussed pricing" or "the action item about onboarding" and the agent will search, find the best match, and either proceed or ask you to confirm if there are multiple candidates.
                    </p>
                  </div>
                </div>
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}

// ── Platform tool catalog (mirrors backend _PLATFORM_TOOL_CATALOG) ────────────

const PLATFORM_TOOLS = [
  "create_action_item", "update_action_item", "delete_action_item",
  "create_calendar_event", "update_calendar_event", "delete_calendar_event",
  "get_airtable_records", "search_records", "update_meeting", "delete_meeting",
  "update_account", "add_account_note",
];

// ── Agent Skill status styles ─────────────────────────────────────────────────

const AGENT_STATUS_STYLES: Record<AgentSkillStatus, { bg: string; color: string; label: string }> = {
  draft:          { bg: "rgba(107,114,128,0.12)", color: "#6b7280", label: "Draft" },
  pending_review: { bg: "rgba(234,179,8,0.15)",  color: "#ca8a04", label: "Pending Review" },
  approved:       { bg: "rgba(34,197,94,0.15)",  color: "#16a34a", label: "Approved" },
  rejected:       { bg: "rgba(239,68,68,0.15)",  color: "#dc2626", label: "Rejected" },
};

function AgentStatusBadge({ status }: { status: AgentSkillStatus }) {
  const s = AGENT_STATUS_STYLES[status];
  return (
    <span style={{
      padding: "2px 8px", borderRadius: "5px", fontSize: "0.75rem", fontWeight: 600,
      background: s.bg, color: s.color, whiteSpace: "nowrap",
    }}>{s.label}</span>
  );
}

// ── New Agent Skill Form ──────────────────────────────────────────────────────

function NewAgentSkillForm({
  onCreated, onBack,
}: {
  onCreated: (s: AgentSkill) => void;
  onBack: () => void;
}) {
  const [displayName, setDisplayName]   = useState("");
  const [description, setDescription]  = useState("");
  const [instructions, setInstructions] = useState("");
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [needsScript, setNeedsScript]   = useState(false);
  const [script, setScript]             = useState("");
  const [generating, setGenerating]     = useState(false);
  const [saving, setSaving]             = useState(false);
  const [reviewing, setReviewing]       = useState(false);
  const [error, setError]               = useState<string | null>(null);

  const codeName = displayName.trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    || "";
  const [saved, setSaved]               = useState<AgentSkill | null>(null);

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    padding: "8px 12px", borderRadius: "7px", fontSize: "0.875rem",
    border: "1px solid var(--border, rgba(0,0,0,0.12))",
    background: "var(--surface, #fff)", outline: "none",
    fontFamily: "var(--font-base)",
  };
  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: "0.8125rem", fontWeight: 600,
    color: "var(--text-secondary, #666)", marginBottom: "6px", letterSpacing: "0.04em",
  };

  async function handleGenerate() {
    if (!description.trim()) return;
    setGenerating(true); setError(null);
    try {
      const { data } = await agentSkillsApi.generate(description.trim());
      if (data.name && !displayName.trim()) setDisplayName(
        data.name.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())
      );
      if (data.description) setDescription(data.description);
      if (data.instructions) setInstructions(data.instructions);
      if (Array.isArray(data.allowed_tools) && data.allowed_tools.length > 0) {
        // Only accept tools that exist in our catalog — never trust generated names blindly
        const valid = data.allowed_tools.filter((t: string) => PLATFORM_TOOLS.includes(t));
        if (valid.length > 0) setAllowedTools(valid);
      }
      if (data.needs_script) { setNeedsScript(true); setScript(data.script ?? ""); }
    } catch {
      setError("Generation failed — check server logs.");
    } finally { setGenerating(false); }
  }

  async function handleSaveDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!codeName || !description.trim() || !instructions.trim()) return;
    setSaving(true); setError(null);
    try {
      const scripts = needsScript && script.trim()
        ? [{ filename: `${codeName}.py`, language: "python", code: script.trim() }]
        : [];
      const { data } = await agentSkillsApi.create({
        name: codeName, description: description.trim(),
        instructions: instructions.trim(),
        allowed_tools: allowedTools, scripts,
      });
      setSaved(data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Save failed.";
      setError(msg);
    } finally { setSaving(false); }
  }

  async function handleReview() {
    if (!saved) return;
    setReviewing(true); setError(null);
    try {
      const { data } = await agentSkillsApi.review(saved.id);
      onCreated(data);
    } catch {
      setError("Review failed — check server logs.");
    } finally { setReviewing(false); }
  }

  return (
    <form onSubmit={handleSaveDraft} style={{ display: "flex", flexDirection: "column", gap: "20px", padding: "24px 28px", overflowY: "auto" }}>
      <button type="button" onClick={onBack} style={{
        display: "inline-flex", alignItems: "center", gap: "8px",
        alignSelf: "flex-start", background: "transparent", border: "none",
        cursor: "pointer", padding: "0", fontSize: "0.875rem",
        color: "var(--text-secondary, #888)", fontFamily: "var(--font-base)",
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </button>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
        <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700, fontFamily: "var(--font-base)" }}>
          New Claude Skill
        </h3>
        {saved && <AgentStatusBadge status={saved.status} />}
      </div>

      {/* Name */}
      <div>
        <label style={labelStyle}>SKILL NAME</label>
        <input
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder="e.g. Weekly Account Summary"
          required
          style={inputStyle}
        />
        {codeName && (
          <div style={{ marginTop: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #aaa)" }}>Code name:</span>
            <code style={{
              fontSize: "0.75rem", fontFamily: "var(--font-mono, monospace)",
              padding: "2px 7px", borderRadius: "4px",
              background: "rgba(0,0,0,0.05)", color: "var(--text-secondary, #666)",
            }}>{codeName}</code>
          </div>
        )}
      </div>

      {/* Description */}
      <div>
        <label style={labelStyle}>DESCRIPTION <span style={{ fontWeight: 400, opacity: 0.6 }}>(what it does AND when to trigger)</span></label>
        <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
          <textarea value={description} onChange={e => setDescription(e.target.value)}
            placeholder="e.g. Use when the user asks for a weekly summary of account health across all active accounts."
            required rows={3} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5, flex: 1 }} />
        </div>
        <button type="button" onClick={handleGenerate} disabled={generating || !description.trim()}
          style={{
            display: "inline-flex", alignItems: "center", gap: "6px",
            padding: "7px 14px", borderRadius: "7px", fontSize: "0.8125rem", fontWeight: 600,
            background: description.trim() ? "rgba(226,35,26,0.08)" : "transparent",
            border: `1px solid ${description.trim() ? "rgba(226,35,26,0.3)" : "rgba(0,0,0,0.1)"}`,
            color: description.trim() ? "var(--twilio-red, #e22)" : "var(--text-secondary, #bbb)",
            cursor: (generating || !description.trim()) ? "not-allowed" : "pointer",
            opacity: generating ? 0.7 : 1, fontFamily: "var(--font-base)",
          }}>
          {generating ? (
            <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Generating…</>
          ) : (
            <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>Generate with Claude</>
          )}
        </button>
      </div>

      {/* Instructions */}
      <div>
        <label style={labelStyle}>INSTRUCTIONS <span style={{ fontWeight: 400, opacity: 0.6 }}>(markdown — steps Claude follows)</span></label>
        <textarea value={instructions} onChange={e => setInstructions(e.target.value)}
          placeholder={"1. Search for all accounts with status Active.\n2. For each account, retrieve open action items.\n3. Summarise health score and outstanding items."}
          required rows={8} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6, fontFamily: "var(--font-mono, monospace)", fontSize: "0.8125rem" }} />
      </div>

      {/* Allowed tools */}
      <div>
        <label style={labelStyle}>ALLOWED TOOLS <span style={{ fontWeight: 400, opacity: 0.6 }}>(platform tools this skill may reference)</span></label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {PLATFORM_TOOLS.map(tool => {
            const active = allowedTools.includes(tool);
            return (
              <button key={tool} type="button"
                onClick={() => setAllowedTools(prev => active ? prev.filter(t => t !== tool) : [...prev, tool])}
                style={{
                  padding: "4px 12px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 600,
                  fontFamily: "var(--font-mono, monospace)",
                  border: active ? "1.5px solid var(--twilio-red, #e22)" : "1.5px solid rgba(0,0,0,0.12)",
                  background: active ? "rgba(226,35,26,0.07)" : "transparent",
                  color: active ? "var(--twilio-red, #e22)" : "var(--text-secondary, #888)",
                  cursor: "pointer", transition: "all 0.12s",
                }}>
                {active ? "✓ " : ""}{tool}
              </button>
            );
          })}
        </div>
        <p style={{ margin: "6px 0 0", fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", lineHeight: 1.5 }}>
          Instructions may only reference tools checked here. Claude will reject any unlisted tool during review.
        </p>
      </div>

      {/* Script toggle + editor */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>SCRIPT</label>
          <button type="button"
            onClick={() => setNeedsScript(p => !p)}
            style={{
              padding: "3px 10px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 600,
              border: `1.5px solid ${needsScript ? "rgba(226,35,26,0.3)" : "rgba(0,0,0,0.12)"}`,
              background: needsScript ? "rgba(226,35,26,0.07)" : "transparent",
              color: needsScript ? "var(--twilio-red, #e22)" : "var(--text-secondary, #888)",
              cursor: "pointer", transition: "all 0.12s",
            }}>
            {needsScript ? "Included" : "Not needed"}
          </button>
          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #aaa)" }}>
            Only add a script for deterministic computation — totals, parsing, formatting.
          </span>
        </div>
        {needsScript && (
          <CodeEditor value={script} onChange={setScript}
            placeholder={"# Python only — no network calls, no os/subprocess\ndef run(**kwargs):\n    return {}"} />
        )}
      </div>

      {error && (
        <div style={{ padding: "10px 14px", borderRadius: "7px", fontSize: "0.8125rem",
          background: "rgba(239,68,68,0.08)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.2)" }}>
          {error}
        </div>
      )}

      {!saved ? (
        <button type="submit" disabled={saving || !codeName || !description.trim() || !instructions.trim()} style={{
          padding: "8px 20px", borderRadius: "7px", fontSize: "0.875rem", fontWeight: 600,
          background: "var(--twilio-red, #e22)", color: "#fff", border: "none",
          cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1,
          alignSelf: "flex-start", fontFamily: "var(--font-base)",
        }}>
          {saving ? "Saving…" : "Save as Draft"}
        </button>
      ) : (
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button type="button" onClick={handleReview} disabled={reviewing} style={{
            padding: "8px 20px", borderRadius: "7px", fontSize: "0.875rem", fontWeight: 600,
            background: "var(--twilio-red, #e22)", color: "#fff", border: "none",
            cursor: reviewing ? "not-allowed" : "pointer", opacity: reviewing ? 0.7 : 1,
            fontFamily: "var(--font-base)",
          }}>
            {reviewing ? "Reviewing…" : "Review with Claude"}
          </button>
          <p style={{ margin: "auto 0", fontSize: "0.8125rem", color: "var(--text-secondary, #888)" }}>
            Saved as draft. Review submits for security check.
          </p>
        </div>
      )}
    </form>
  );
}

// ── Agent Skill detail panel ──────────────────────────────────────────────────

function AgentSkillDetail({ skill, currentUsername, onBack, onUpdated, onDeleted }: {
  skill: AgentSkill;
  currentUsername: string | null;
  onBack: () => void;
  onUpdated: (s: AgentSkill) => void;
  onDeleted?: (id: number) => void;
}) {
  const isOwner = skill.created_by_username === currentUsername;
  const canEdit = skill.status === "draft" && isOwner;

  const [editing, setEditing]               = useState(false);
  const [editInstructions, setEditInstructions] = useState(skill.instructions);
  const [editTools, setEditTools]           = useState<string[]>(skill.allowed_tools);
  const [editRoles, setEditRoles]           = useState<string[]>(skill.pinned_to_roles ?? []);
  const [saving, setSaving]                 = useState(false);
  const [reviewing, setReviewing]           = useState(false);
  const [pinning, setPinning]               = useState(false);
  const [running, setRunning]               = useState(false);
  const [runResult, setRunResult]           = useState<string | null>(null);
  const [actionError, setActionError]       = useState<string | null>(null);
  const [deleting, setDeleting]             = useState(false);
  const [confirmDelete, setConfirmDelete]   = useState(false);

  // Keep edit state in sync when skill updates
  useEffect(() => {
    setEditInstructions(skill.instructions);
    setEditTools(skill.allowed_tools);
    setEditRoles(skill.pinned_to_roles ?? []);
  }, [skill]);

  async function handleSaveEdit() {
    setSaving(true); setActionError(null);
    try {
      const { data } = await agentSkillsApi.updateSkill(skill.id, {
        instructions: editInstructions,
        allowed_tools: editTools,
        pinned_to_roles: editRoles,
      });
      onUpdated(data);
      setEditing(false);
    } catch {
      setActionError("Save failed.");
    } finally { setSaving(false); }
  }

  async function handleReview() {
    setReviewing(true); setActionError(null);
    try {
      const { data } = await agentSkillsApi.review(skill.id);
      // Merge back auto-selected tools from review
      onUpdated(data);
      setEditTools(data.allowed_tools);
    } catch {
      setActionError("Review failed — check server logs.");
    } finally { setReviewing(false); }
  }

  async function handlePin() {
    setPinning(true);
    try {
      const { data } = skill.pinned_by_me
        ? await agentSkillsApi.unpin(skill.id)
        : await agentSkillsApi.pin(skill.id);
      onUpdated(data);
    } finally { setPinning(false); }
  }

  async function handleRun() {
    setRunning(true); setRunResult(null); setActionError(null);
    try {
      const { data } = await agentSkillsApi.run(skill.id);
      window.dispatchEvent(new CustomEvent("chat-inject", { detail: { text: data.prompt } }));
      setRunResult("Sent to chat.");
    } catch {
      setActionError("Run failed.");
    } finally { setRunning(false); }
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true); setActionError(null);
    try {
      await agentSkillsApi.delete(skill.id);
      onDeleted?.(skill.id);
      onBack();
    } catch {
      setActionError("Delete failed.");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const labelStyle: React.CSSProperties = {
    fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.06em",
    color: "var(--text-secondary, #999)", marginBottom: "8px",
  };

  return (
    <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: "20px", overflowY: "auto" }}>
      {/* Back */}
      <button onClick={onBack} style={{
        display: "inline-flex", alignItems: "center", gap: "8px", alignSelf: "flex-start",
        background: "transparent", border: "none", cursor: "pointer", fontSize: "0.875rem",
        color: "var(--text-secondary, #888)", fontFamily: "var(--font-base)", padding: 0,
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </button>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>
              {skill.name.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
            </h2>
            <AgentStatusBadge status={skill.status} />
          </div>
          <div style={{ marginTop: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #aaa)" }}>Code name:</span>
            <code style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono, monospace)",
              padding: "2px 7px", borderRadius: "4px", background: "rgba(0,0,0,0.05)",
              color: "var(--text-secondary, #666)" }}>{skill.name}</code>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
          {canEdit && !editing && (
            <button onClick={() => setEditing(true)} style={{
              display: "inline-flex", alignItems: "center", gap: "5px",
              padding: "6px 14px", borderRadius: "6px", fontSize: "0.8125rem", fontWeight: 600,
              background: "transparent", border: "1px solid rgba(0,0,0,0.15)",
              color: "var(--text-secondary, #666)", cursor: "pointer", fontFamily: "var(--font-base)",
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Edit
            </button>
          )}
          {/* Pin to my page */}
          <button onClick={handlePin} disabled={pinning} style={{
            display: "inline-flex", alignItems: "center", gap: "5px",
            padding: "6px 14px", borderRadius: "6px", fontSize: "0.8125rem", fontWeight: 600,
            background: skill.pinned_by_me ? "rgba(226,35,26,0.08)" : "transparent",
            border: `1px solid ${skill.pinned_by_me ? "rgba(226,35,26,0.3)" : "rgba(0,0,0,0.15)"}`,
            color: skill.pinned_by_me ? "var(--twilio-red, #e22)" : "var(--text-secondary, #666)",
            cursor: pinning ? "not-allowed" : "pointer", fontFamily: "var(--font-base)",
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill={skill.pinned_by_me ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            {pinning ? "…" : skill.pinned_by_me ? "Pinned to my page" : "Pin to my page"}
          </button>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: "0.9375rem", color: "var(--text-secondary, #666)", lineHeight: 1.6 }}>
        {skill.description}
      </p>

      {/* Allowed tools */}
      <div>
        <div style={labelStyle}>ALLOWED TOOLS</div>
        {editing ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {PLATFORM_TOOLS.map(tool => {
              const active = editTools.includes(tool);
              return (
                <button key={tool} type="button"
                  onClick={() => setEditTools(prev => active ? prev.filter(t => t !== tool) : [...prev, tool])}
                  style={{
                    padding: "4px 12px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 600,
                    fontFamily: "var(--font-mono, monospace)",
                    border: active ? "1.5px solid var(--twilio-red, #e22)" : "1.5px solid rgba(0,0,0,0.12)",
                    background: active ? "rgba(226,35,26,0.07)" : "transparent",
                    color: active ? "var(--twilio-red, #e22)" : "var(--text-secondary, #888)",
                    cursor: "pointer", transition: "all 0.12s",
                  }}>
                  {active ? "✓ " : ""}{tool}
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {skill.allowed_tools.length > 0 ? skill.allowed_tools.map(t => (
              <code key={t} style={{ padding: "3px 8px", borderRadius: "5px", fontSize: "0.75rem",
                background: "rgba(0,0,0,0.05)", fontFamily: "var(--font-mono, monospace)",
                color: "var(--text-primary, #111)" }}>{t}</code>
            )) : (
              <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #aaa)", fontStyle: "italic" }}>None selected</span>
            )}
          </div>
        )}
      </div>

      {/* Instructions */}
      <div>
        <div style={labelStyle}>INSTRUCTIONS</div>
        {editing ? (
          <textarea
            value={editInstructions}
            onChange={e => setEditInstructions(e.target.value)}
            rows={12}
            style={{
              width: "100%", boxSizing: "border-box", padding: "12px 14px",
              borderRadius: "8px", fontSize: "0.8125rem", lineHeight: 1.6,
              border: "1px solid var(--border, rgba(0,0,0,0.12))",
              background: "var(--surface, #fff)", fontFamily: "var(--font-mono, monospace)",
              resize: "vertical", outline: "none",
            }}
          />
        ) : (
          <pre style={{
            margin: 0, padding: "14px 16px", borderRadius: "8px",
            background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))",
            fontSize: "0.8125rem", fontFamily: "var(--font-mono, monospace)",
            whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6,
            maxHeight: "220px", overflowY: "auto",
          }}>
            {skill.instructions}
          </pre>
        )}
      </div>

      {/* Pin to role pages */}
      <div>
        <div style={labelStyle}>PIN TO ROLE PAGES</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {ROLE_OPTIONS.map(role => {
            const active = editRoles.includes(role);
            return (
              <button key={role} type="button"
                onClick={async () => {
                  const next = active ? editRoles.filter(r => r !== role) : [...editRoles, role];
                  setEditRoles(next);
                  try {
                    const { data } = await agentSkillsApi.updateSkill(skill.id, { pinned_to_roles: next });
                    onUpdated(data);
                  } catch { setEditRoles(editRoles); }
                }}
                style={{
                  padding: "4px 12px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 600,
                  border: active ? "1.5px solid #7c3aed" : "1.5px solid rgba(0,0,0,0.12)",
                  background: active ? "rgba(124,58,237,0.1)" : "transparent",
                  color: active ? "#7c3aed" : "var(--text-secondary, #888)",
                  cursor: "pointer", transition: "all 0.12s", fontFamily: "var(--font-base)",
                }}>
                {active ? "✓ " : ""}{role}
              </button>
            );
          })}
        </div>
        <p style={{ margin: "6px 0 0", fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", lineHeight: 1.5 }}>
          This skill will appear as a quick-launch button on the selected role pages.
        </p>
      </div>

      {/* Scripts */}
      {skill.scripts.length > 0 && skill.scripts.map(s => (
        <div key={s.filename}>
          <div style={labelStyle}>SCRIPT — {s.filename}</div>
          <CodeEditor value={s.code} readOnly />
        </div>
      ))}

      {/* Review findings */}
      {skill.review_verdict && (
        <div style={{ padding: "14px 18px", borderRadius: "10px",
          background: skill.review_verdict === "PASS" ? "rgba(34,197,94,0.06)" : "rgba(239,68,68,0.06)",
          border: `1px solid ${skill.review_verdict === "PASS" ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}` }}>
          <div style={{ fontWeight: 700, fontSize: "0.875rem", marginBottom: "8px",
            color: skill.review_verdict === "PASS" ? "#16a34a" : "#dc2626" }}>
            Review: {skill.review_verdict}
          </div>
          {Object.entries(skill.review_findings).map(([k, v]) => (
            <div key={k} style={{ fontSize: "0.8125rem", lineHeight: 1.6, color: "var(--text-secondary, #666)" }}>
              <strong>{k.replace(/_/g, " ")}:</strong> {v}
            </div>
          ))}
        </div>
      )}

      {/* Test & Run panel */}
      <div style={{ borderRadius: "10px", border: "1px solid var(--border, rgba(0,0,0,0.1))",
        background: "var(--surface-alt, rgba(0,0,0,0.02))", padding: "16px 18px" }}>
        <div style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.06em",
          color: "var(--text-secondary, #999)", marginBottom: "12px" }}>TEST & RUN</div>
        <p style={{ margin: "0 0 12px", fontSize: "0.8125rem", color: "var(--text-secondary, #888)", lineHeight: 1.5 }}>
          Sends this skill's instructions to the Agent chat. Only available for approved skills.
        </p>
        <button onClick={handleRun} disabled={running || skill.status !== "approved"}
          title={skill.status !== "approved" ? "Skill must be approved before running" : undefined}
          style={{
            display: "inline-flex", alignItems: "center", gap: "6px",
            padding: "7px 18px", borderRadius: "7px", fontSize: "0.875rem", fontWeight: 600,
            background: skill.status === "approved" ? "var(--twilio-red, #e22)" : "rgba(0,0,0,0.07)",
            color: skill.status === "approved" ? "#fff" : "var(--text-secondary, #aaa)",
            border: "none", cursor: running || skill.status !== "approved" ? "not-allowed" : "pointer",
            opacity: running ? 0.7 : 1, fontFamily: "var(--font-base)",
          }}>
          {running ? (
            <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Running…</>
          ) : (
            <><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>Run in Chat</>
          )}
        </button>
        {runResult && (
          <p style={{ margin: "8px 0 0", fontSize: "0.8125rem", color: "#16a34a" }}>{runResult}</p>
        )}
      </div>

      {/* Edit save/cancel / review actions */}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        {editing && (
          <>
            <button onClick={handleSaveEdit} disabled={saving} style={{
              padding: "7px 18px", borderRadius: "7px", fontSize: "0.875rem", fontWeight: 600,
              background: "var(--twilio-red, #e22)", color: "#fff", border: "none",
              cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1, fontFamily: "var(--font-base)",
            }}>{saving ? "Saving…" : "Save"}</button>
            <button onClick={() => { setEditing(false); setEditInstructions(skill.instructions); setEditTools(skill.allowed_tools); }} style={{
              padding: "7px 16px", borderRadius: "7px", fontSize: "0.875rem", fontWeight: 600,
              background: "transparent", border: "1px solid rgba(0,0,0,0.15)",
              color: "var(--text-secondary, #666)", cursor: "pointer", fontFamily: "var(--font-base)",
            }}>Cancel</button>
          </>
        )}
        {(skill.status === "draft" || skill.status === "rejected") && isOwner && (
          <button onClick={handleReview} disabled={reviewing} style={{
            padding: "7px 18px", borderRadius: "7px", fontSize: "0.875rem", fontWeight: 600,
            background: reviewing ? "rgba(0,0,0,0.07)" : "rgba(226,35,26,0.08)",
            color: reviewing ? "var(--text-secondary, #aaa)" : "var(--twilio-red, #e22)",
            border: "1px solid rgba(226,35,26,0.25)",
            cursor: reviewing ? "not-allowed" : "pointer", fontFamily: "var(--font-base)",
          }}>
            {reviewing ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                Reviewing…
              </span>
            ) : "Review with Claude"}
          </button>
        )}
        {isOwner && !editing && (
          <>
            <button onClick={handleDelete} disabled={deleting} style={{
              padding: "7px 16px", borderRadius: "7px", fontSize: "0.875rem", fontWeight: 600,
              background: confirmDelete ? "rgba(239,68,68,0.12)" : "transparent",
              color: confirmDelete ? "#dc2626" : "var(--text-secondary, #888)",
              border: `1px solid ${confirmDelete ? "rgba(239,68,68,0.3)" : "rgba(0,0,0,0.1)"}`,
              cursor: deleting ? "not-allowed" : "pointer", fontFamily: "var(--font-base)",
            }}>
              {deleting ? "Deleting…" : confirmDelete ? "Confirm delete" : "Delete"}
            </button>
            {confirmDelete && (
              <button onClick={() => setConfirmDelete(false)} style={{
                padding: "7px 16px", borderRadius: "7px", fontSize: "0.875rem", fontWeight: 600,
                background: "transparent", color: "var(--text-secondary, #888)",
                border: "1px solid rgba(0,0,0,0.1)", cursor: "pointer", fontFamily: "var(--font-base)",
              }}>
                Cancel
              </button>
            )}
          </>
        )}
      </div>

      {actionError && (
        <div style={{ padding: "10px 14px", borderRadius: "7px", fontSize: "0.8125rem",
          background: "rgba(239,68,68,0.08)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.2)" }}>
          {actionError}
        </div>
      )}
    </div>
  );
}

// ── Agent PM Skills panel (structured skills) ─────────────────────────────────

function AgentPMSkillsPanel() {
  const currentUser = useCurrentUser();
  const [skills, setSkills]         = useState<AgentSkill[]>([]);
  const [loading, setLoading]       = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showForm, setShowForm]     = useState(false);

  useEffect(() => {
    agentSkillsApi.list()
      .then(({ data }) => setSkills(data.results))
      .finally(() => setLoading(false));
  }, []);

  function handleCreated(skill: AgentSkill) {
    setSkills(prev => [skill, ...prev]);
    setSelectedId(skill.id);
    setShowForm(false);
  }

  const selected = skills.find(s => s.id === selectedId) ?? null;

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* Left panel */}
      <div style={{
        width: "300px", flexShrink: 0, borderRight: "1px solid var(--border, rgba(0,0,0,0.08))",
        display: "flex", flexDirection: "column", background: "var(--surface, #fff)", overflowY: "auto",
      }}>
        <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-secondary, #666)", letterSpacing: "0.04em" }}>
              CLAUDE SKILLS
            </span>
            <button onClick={() => { setShowForm(true); setSelectedId(null); }} style={{
              padding: "4px 10px", borderRadius: "5px", fontSize: "0.8125rem", fontWeight: 600,
              background: "var(--twilio-red, #e22)", color: "#fff", border: "none", cursor: "pointer",
            }}>+ New</button>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: "0.8125rem", color: "var(--text-secondary, #888)", lineHeight: 1.4 }}>
            Instructions-based skills for Claude.
          </p>
        </div>

        {loading ? (
          <div style={{ padding: "20px 16px", fontSize: "0.875rem", color: "var(--text-secondary, #888)" }}>Loading…</div>
        ) : skills.length === 0 ? (
          <div style={{ padding: "20px 16px", fontSize: "0.875rem", color: "var(--text-secondary, #888)" }}>
            No skills yet. Click <strong>+ New</strong> to create one.
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto" }}>
            {skills.map(skill => {
              const s = AGENT_STATUS_STYLES[skill.status];
              const isSelected = skill.id === selectedId;
              return (
                <button key={skill.id}
                  onClick={() => { setSelectedId(skill.id); setShowForm(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    width: "100%", textAlign: "left", padding: "12px 16px",
                    background: isSelected ? "rgba(226,35,26,0.06)" : "transparent",
                    borderTop: "none", borderRight: "none",
                    borderBottom: "1px solid rgba(0,0,0,0.06)",
                    borderLeft: isSelected ? "3px solid var(--twilio-red, #e22)" : "3px solid transparent",
                    cursor: "pointer", transition: "background 0.1s",
                  }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-primary, #111)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {skill.name.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary, #888)", marginTop: "2px",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {skill.description}
                    </div>
                  </div>
                  <span style={{ flexShrink: 0, fontSize: "0.6875rem", fontWeight: 700,
                    padding: "2px 6px", borderRadius: "4px", background: s.bg, color: s.color }}>
                    {s.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto", background: "var(--bg, #f5f5f5)" }}>
        {showForm ? (
          <NewAgentSkillForm onCreated={handleCreated} onBack={() => setShowForm(false)} />
        ) : selected ? (
          <AgentSkillDetail
            skill={selected}
            currentUsername={currentUser?.username ?? null}
            onBack={() => setSelectedId(null)}
            onUpdated={skill => setSkills(prev => prev.map(s => s.id === skill.id ? skill : s))}
            onDeleted={id => {
              setSkills(prev => prev.filter(s => s.id !== id));
              setSelectedId(null);
            }}
          />
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: "24px", padding: "60px", textAlign: "center" }}>
            <div style={{ width: "96px", height: "96px", borderRadius: "28px", background: "rgba(226,35,26,0.06)",
              display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="var(--twilio-red, #e22)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>Build a Claude Skill</h2>
              <p style={{ margin: "10px 0 0", fontSize: "0.875rem", color: "var(--text-secondary, #888)", maxWidth: "480px", lineHeight: 1.6 }}>
                Skills are instructions-based — write what Claude should do, pick the tools it can use, and optionally attach a Python script for deterministic steps.
              </p>
            </div>
            <button onClick={() => setShowForm(true)} style={{
              padding: "9px 22px", borderRadius: "8px", fontSize: "0.875rem", fontWeight: 600,
              background: "var(--twilio-red, #e22)", color: "#fff", border: "none", cursor: "pointer",
            }}>+ Create your first skill</button>
            <div style={{
              marginTop: "12px", display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)", gap: "14px", maxWidth: "800px", width: "100%",
            }}>
              {[
                { step: "1", title: "Describe it", body: "Give it a name, a description that tells Claude when to use it, and step-by-step instructions." },
                { step: "2", title: "Pick your tools", body: "Select which platform tools (create, update, search…) this skill is allowed to reference." },
                { step: "3", title: "Claude reviews it", body: "An agent checks for safety, instruction integrity, and tool scope before it goes live." },
              ].map(({ step, title, body }) => (
                <div key={step} style={{
                  padding: "16px", borderRadius: "10px",
                  border: "1px solid var(--border, rgba(0,0,0,0.08))",
                  background: "var(--surface, #fff)",
                  textAlign: "left",
                }}>
                  <div style={{
                    width: "28px", height: "28px", borderRadius: "50%",
                    background: "var(--twilio-red, #e22)", color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "0.875rem", fontWeight: 700, marginBottom: "10px",
                  }}>{step}</div>
                  <div style={{ fontSize: "0.875rem", fontWeight: 700, marginBottom: "4px" }}>{title}</div>
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #888)", lineHeight: 1.5 }}>{body}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ClaudeSkillsPage() {
  const pageRef = useRef<HTMLDivElement>(null);
  useLogGlow(pageRef);
  const currentUser = useCurrentUser();
  const isStaffAdmin = !!(currentUser?.is_staff && currentUser?.role === "admin");
  const [activeTab, setActiveTab] = useState<PageTab>("agent-skills");
  const [filterTerm, setFilterTerm] = useState("");

  useEffect(() => {
    function onFilter(e: Event) {
      const term = (e as CustomEvent<{ term: string }>).detail?.term ?? "";
      setFilterTerm(term);
    }
    window.addEventListener("skills-filter", onFilter);
    return () => window.removeEventListener("skills-filter", onFilter);
  }, []);

  const tabs: { id: PageTab; label: string }[] = [
    { id: "agent-skills", label: "Agent PM Skills" },
    { id: "twilio",       label: "Twilio Skills" },
    ...(isStaffAdmin ? [{ id: "claude-tools" as PageTab, label: "Agent PM Tools" }] : []),
    { id: "agent-crud",   label: "Agent Capabilities" },
  ];

  return (
    <div ref={pageRef} className="relative h-full overflow-hidden flex flex-col" style={{ fontFamily: "var(--font-base)" }}>
      <div style={{
        padding: "16px 24px 0",
        borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))",
        background: "var(--surface, #fff)",
        flexShrink: 0,
      }}>
        <h1 style={{ margin: "0 0 12px", fontSize: "1.125rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}><CodeIcon width={18} height={18} style={{ flexShrink: 0 }} />Claude Skills</h1>
        <div style={{ display: "flex", gap: "6px" }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "6px 18px",
                borderRadius: "2px 2px 0 0",
                fontSize: "0.875rem", fontWeight: activeTab === tab.id ? 700 : 500,
                fontFamily: "var(--font-base)",
                background: activeTab === tab.id ? "var(--twilio-red, #e22)" : "transparent",
                border: "none",
                color: activeTab === tab.id ? "#fff" : "var(--text-secondary, #888)",
                cursor: "pointer", transition: "background 0.12s, color 0.12s",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        {activeTab === "agent-skills"
          ? <AgentPMSkillsPanel />
          : activeTab === "twilio"
          ? <TwilioPanel filterTerm={filterTerm} onFilterChange={setFilterTerm} />
          : activeTab === "agent-crud"
          ? <AgentSkillsPanel />
          : (activeTab === "claude-tools" && isStaffAdmin)
          ? <AgentPMPanel filterTerm={filterTerm} onFilterChange={setFilterTerm} />
          : <AgentPMSkillsPanel />
        }
      </div>
    </div>
  );
}
