import { useEffect, useRef, useState } from "react";
import { feedbackApi } from "../../lib/api";
import { useFeedback } from "../../context/FeedbackContext";

interface Props {
  onClose: () => void;
}

export default function FeedbackModal({ onClose }: Props) {
  const { pickMode, attachedElement, startPick, cancelPick, attachElement, clearAttached } = useFeedback();
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Close on Escape (Escape in pick mode cancels the pick instead)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (pickMode) cancelPick();
        else onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickMode, cancelPick, onClose]);

  // Pick mode: intercept next click on the document to capture element info
  useEffect(() => {
    if (!pickMode) return;
    function onPick(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      const target = e.target as HTMLElement;
      const label = [
        target.getAttribute("aria-label"),
        target.getAttribute("title"),
        (target.textContent ?? "").trim().slice(0, 80),
      ].find(v => v && v.trim()) ?? target.tagName.toLowerCase();

      // Build a short ancestor path
      const parts: string[] = [];
      let el: HTMLElement | null = target;
      for (let i = 0; i < 4 && el; i++) {
        let seg = el.tagName.toLowerCase();
        if (el.id) seg += `#${el.id}`;
        else if (typeof el.className === "string" && el.className.trim()) {
          seg += `.${el.className.trim().split(/\s+/)[0]}`;
        }
        parts.unshift(seg);
        el = el.parentElement;
      }

      attachElement({ label, path: parts.join(" > "), pageUrl: window.location.href });
    }
    document.addEventListener("click", onPick, true);
    return () => document.removeEventListener("click", onPick, true);
  }, [pickMode, attachElement]);

  async function submit() {
    if (!description.trim()) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("description", description.trim());
      if (attachedElement) {
        fd.append("element_label", attachedElement.label);
        fd.append("element_path", attachedElement.path);
        fd.append("page_url", attachedElement.pageUrl);
      }
      if (file) fd.append("attachment", file);
      await feedbackApi.create(fd);
      setDone(true);
      clearAttached();
      setTimeout(onClose, 1400);
    } catch {
      // keep open on error
    } finally {
      setSubmitting(false);
    }
  }

  // Pick mode overlay — hides modal, shows instructions
  if (pickMode) {
    return (
      <>
        <div style={{
          position: "fixed", inset: 0, zIndex: 9100,
          cursor: "crosshair",
          background: "rgba(219,19,26,0.06)",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
          zIndex: 9200, pointerEvents: "auto",
          background: "var(--twilio-navy, #0d1b2e)",
          color: "#fff", borderRadius: 8, padding: "10px 18px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
          display: "flex", alignItems: "center", gap: 10,
          fontSize: "0.875rem", fontFamily: "var(--font-base)",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--twilio-red,#DB131A)" strokeWidth="2" strokeLinecap="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>
          Click any element to attach it to your feedback
          <button
            onClick={cancelPick}
            style={{ marginLeft: 4, background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)", fontSize: "0.8125rem" }}
          >
            Cancel
          </button>
        </div>
      </>
    );
  }

  if (done) {
    return (
      <ModalShell onClose={onClose}>
        <div style={{ textAlign: "center", padding: "32px 24px" }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--twilio-red,#DB131A)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto 12px", display: "block" }}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <p style={{ fontSize: "1rem", fontWeight: 600, color: "var(--twilio-navy)", margin: 0 }}>Thanks for the feedback!</p>
          <p style={{ fontSize: "0.8125rem", color: "var(--twilio-gray-60)", marginTop: 4 }}>We'll look into it.</p>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell onClose={onClose}>
      <div style={{ padding: "20px 20px 16px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <p style={{ fontSize: "1rem", fontWeight: 700, color: "var(--twilio-navy)", margin: 0 }}>
            Share Feedback
          </p>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--twilio-gray-60)", padding: 2 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Description */}
        <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--twilio-gray-60)", marginBottom: 4 }}>
          What's not working?
        </label>
        <textarea
          autoFocus
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Describe the issue…"
          rows={4}
          style={{
            width: "100%", boxSizing: "border-box", resize: "vertical",
            padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border, rgba(0,0,0,0.12))",
            fontSize: "0.875rem", fontFamily: "var(--font-base)", color: "var(--twilio-navy)",
            background: "var(--surface, #fff)", outline: "none",
          }}
        />

        {/* Attach element */}
        <div style={{ marginTop: 12 }}>
          <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--twilio-gray-60)", marginBottom: 4 }}>
            Attach a page element <span style={{ fontWeight: 400, color: "var(--twilio-gray-40)" }}>(optional)</span>
          </label>
          {attachedElement ? (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 10px", borderRadius: 6,
              border: "1px solid rgba(219,19,26,0.3)", background: "rgba(219,19,26,0.05)",
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--twilio-red,#DB131A)" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: "0.75rem", fontWeight: 600, color: "var(--twilio-navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{attachedElement.label}</p>
                <p style={{ margin: 0, fontSize: "0.6875rem", color: "var(--twilio-gray-60)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{attachedElement.pageUrl}</p>
              </div>
              <button onClick={clearAttached} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--twilio-gray-60)", flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          ) : (
            <button
              onClick={startPick}
              style={{
                display: "flex", alignItems: "center", gap: 6, width: "100%",
                padding: "6px 10px", borderRadius: 6, cursor: "pointer",
                border: "1px dashed var(--border, rgba(0,0,0,0.15))",
                background: "transparent", fontSize: "0.8125rem", color: "var(--twilio-gray-60)",
                fontFamily: "var(--font-base)",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>
              Click to select an element on this page
            </button>
          )}
        </div>

        {/* File attachment */}
        <div style={{ marginTop: 12 }}>
          <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--twilio-gray-60)", marginBottom: 4 }}>
            Screenshot / attachment <span style={{ fontWeight: 400, color: "var(--twilio-gray-40)" }}>(optional)</span>
          </label>
          {file ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(0,0,0,0.1)", background: "var(--surface,#fff)" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span style={{ flex: 1, fontSize: "0.8125rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
              <button onClick={() => setFile(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--twilio-gray-60)" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={() => fileRef.current?.click()}
                style={{
                  display: "flex", alignItems: "center", gap: 6, width: "100%",
                  padding: "6px 10px", borderRadius: 6, cursor: "pointer",
                  border: "1px dashed var(--border, rgba(0,0,0,0.15))",
                  background: "transparent", fontSize: "0.8125rem", color: "var(--twilio-gray-60)",
                  fontFamily: "var(--font-base)",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                Attach screenshot or file
              </button>
              <input ref={fileRef} type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={e => setFile(e.target.files?.[0] ?? null)} />
            </>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button
            onClick={onClose}
            style={{
              padding: "7px 14px", borderRadius: 6, border: "1px solid var(--border, rgba(0,0,0,0.12))",
              background: "transparent", fontSize: "0.875rem", cursor: "pointer",
              color: "var(--twilio-gray-60)", fontFamily: "var(--font-base)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!description.trim() || submitting}
            style={{
              padding: "7px 16px", borderRadius: 6, border: "none",
              background: description.trim() ? "var(--twilio-red,#DB131A)" : "rgba(0,0,0,0.1)",
              color: description.trim() ? "#fff" : "rgba(0,0,0,0.35)",
              fontSize: "0.875rem", fontWeight: 600,
              cursor: description.trim() ? "pointer" : "not-allowed",
              fontFamily: "var(--font-base)", transition: "background 0.15s",
            }}
          >
            {submitting ? "Submitting…" : "Submit Feedback"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,0.35)" }}
      />
      <div style={{
        position: "fixed", bottom: 72, left: 240 + 16, zIndex: 9001,
        width: 420, maxWidth: "calc(100vw - 40px)",
        borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        background: "var(--surface, #fff)",
        border: "1px solid var(--border, rgba(0,0,0,0.08))",
        overflow: "hidden",
      }}>
        {children}
      </div>
    </>
  );
}
