import { useState } from "react";
import { normalizeQuickLinkUrl } from "../../hooks/useQuickLinks";

/** Slack workspaces offered in the channel form's dropdown, each with a built-in icon (no network). */
export interface SlackWorkspacePreset {
  name: string;
  host: string;
  Icon: (props: { size?: number }) => JSX.Element;
}

const RED = "#F22F46";

function TwilioMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="12" fill={RED} />
      <circle cx="12" cy="12" r="7.5" fill="none" stroke="#fff" strokeWidth="1.6" />
      {[[9.2, 9.2], [14.8, 9.2], [9.2, 14.8], [14.8, 14.8]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" fill="#fff" />
      ))}
    </svg>
  );
}

function ContactCenterMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect width="24" height="24" rx="5" fill={RED} />
      <circle cx="12" cy="12" r="8" fill="#fff" />
      <path d="M7.5 10.5a5 5 0 0 1 8.4-1.6" fill="none" stroke={RED} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16.6 7.4l-.7 1.9-1.9-.7" fill="none" stroke={RED} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.5 13.5a5 5 0 0 1-8.4 1.6" fill="none" stroke={RED} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7.4 16.6l.7-1.9 1.9.7" fill="none" stroke={RED} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SegmentMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect width="24" height="24" rx="5" fill="#52BD94" />
      <path d="M17 8.2H8.6a1.6 1.6 0 0 0 0 3.2h6.8a1.6 1.6 0 0 1 0 3.2H7" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export const SLACK_WORKSPACE_PRESETS: SlackWorkspacePreset[] = [
  { name: "Twilio-Enterprise", host: "twilio.enterprise.slack.com", Icon: TwilioMark },
  { name: "Twilio Contact Center", host: "twilio-contact-center.slack.com", Icon: ContactCenterMark },
  { name: "Segment Customers", host: "segmentcustomers.slack.com", Icon: SegmentMark },
];

export function presetFor(workspace: string): SlackWorkspacePreset | undefined {
  const w = (workspace ?? "").trim().toLowerCase();
  return SLACK_WORKSPACE_PRESETS.find((p) => p.name.toLowerCase() === w);
}

/** An http(s) URL safe to put in an href/src, or null. Reuses the quick-link rules (no credentials). */
export function safeWebUrl(raw: string | undefined | null): string | null {
  const text = (raw ?? "").trim();
  if (!/^https?:\/\//i.test(text)) return null;
  return normalizeQuickLinkUrl(text);
}

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}

/** Does `url` live on `host` (or a subdomain of it)? */
export function urlOnHost(url: string, host: string): boolean {
  const h = hostOf(url).toLowerCase();
  return h === host || h.endsWith(`.${host}`);
}

/** Pulls a Slack channel id out of an `/archives/<id>` link. */
export function channelIdFromUrl(url: string): string | null {
  const m = /\/archives\/([A-Z0-9]+)/i.exec(url);
  return m ? m[1] : null;
}

/**
 * The workspace's icon. Preset -> built-in SVG; custom -> the saved image URL, else the favicon of the
 * channel link's host; if the image fails (or nothing is known) a letter tile. The workspace name is
 * only in the tooltip (title + aria-label).
 */
export function SlackWorkspaceIcon({ workspace, iconUrl, linkUrl, size = 16 }: {
  workspace: string; iconUrl?: string; linkUrl?: string; size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const preset = presetFor(workspace);
  const name = workspace.trim() || "Slack";
  const wrap = { width: size, height: size } as const;
  let inner: JSX.Element;
  if (preset) {
    inner = <preset.Icon size={size} />;
  } else {
    const src = safeWebUrl(iconUrl) ?? (safeWebUrl(linkUrl) ? `https://${hostOf(linkUrl as string)}/favicon.ico` : null);
    inner = src && !failed ? (
      <img src={src} alt="" width={size} height={size} className="rounded-sm object-contain" onError={() => setFailed(true)} />
    ) : (
      <span
        data-testid="slack-workspace-fallback"
        className="inline-flex items-center justify-center rounded font-bold uppercase"
        style={{ ...wrap, fontSize: Math.round(size * 0.6), background: "var(--twilio-gray-20, rgba(127,127,127,0.25))", color: "var(--twilio-navy)" }}
      >{name.charAt(0)}</span>
    );
  }
  return (
    <span data-testid="slack-workspace-icon" role="img" title={name} aria-label={`Slack workspace: ${name}`} className="inline-flex shrink-0 items-center" style={wrap}>
      {inner}
    </span>
  );
}
