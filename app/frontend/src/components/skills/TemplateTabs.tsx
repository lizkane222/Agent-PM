import { useRef, useState } from "react";
import RichTextMentionEditor from "../shared/RichTextMentionEditor";
import { agentSkillsApi } from "../../lib/api";
import { markdownToHtml } from "../../lib/markdownToHtml";
import { sanitizeHtml } from "../../lib/noteHelpers";
import type { SkillTemplate } from "../../types/agents";

/**
 * A skill's selectable templates, one tab each (e.g. "Weekly update" / "Net-new plan").
 *
 * Authors can import a document — it is split at its headings into one tab per template —
 * and edit each body with `@`, `@#` and `@#--` lookups. With `readOnly` the same tabs are a
 * viewer, and `selectedKey` / `onSelect` let a runner pick which template to use.
 */
export default function TemplateTabs({
  templates, onChange, readOnly, selectedKey, onSelect,
}: {
  templates: SkillTemplate[];
  onChange?: (next: SkillTemplate[]) => void;
  readOnly?: boolean;
  selectedKey?: string;
  onSelect?: (key: string) => void;
}) {
  const [localKey, setLocalKey] = useState(templates[0]?.key ?? "");
  const active = selectedKey ?? localKey;
  const current = templates.find((t) => t.key === active) ?? templates[0];
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intro, setIntro] = useState("");

  const select = (key: string) => { setLocalKey(key); onSelect?.(key); };
  const patch = (key: string, change: Partial<SkillTemplate>) =>
    onChange?.(templates.map((t) => (t.key === key ? { ...t, ...change } : t)));

  async function importFile(file: File) {
    setBusy(true); setError(null);
    try {
      const { data } = await agentSkillsApi.parseTemplate(file);
      const sections = data.sections.length > 0
        ? data.sections
        : [{ key: "template", title: file.name.replace(/\.[^.]+$/, ""), markdown: data.text }];
      const existing = new Set(templates.map((t) => t.key));
      const added: SkillTemplate[] = sections.map((s) => {
        let key = s.key, n = 2;
        while (existing.has(key)) key = `${s.key}-${n++}`;
        existing.add(key);
        return { key, title: s.title, body_html: markdownToHtml(s.markdown) };
      });
      onChange?.([...templates, ...added]);
      setIntro(data.intro);
      select(added[0].key);
    } catch (e) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Couldn't read that file.");
    } finally { setBusy(false); }
  }

  function addBlank() {
    const key = `template-${templates.length + 1}-${Math.random().toString(36).slice(2, 5)}`;
    onChange?.([...templates, { key, title: `Template ${templates.length + 1}`, body_html: "" }]);
    select(key);
  }
  function remove(key: string) {
    const next = templates.filter((t) => t.key !== key);
    onChange?.(next);
    if (active === key) select(next[0]?.key ?? "");
  }

  if (readOnly && templates.length === 0) return null;

  return (
    <div data-testid="template-tabs">
      {!readOnly && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
          <label style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary, #666)", letterSpacing: "0.04em" }}>
            TEMPLATES <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional — runners choose which one to use)</span>
          </label>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} style={btn}>
            {busy ? "Reading…" : "Import from document"}
          </button>
          <button type="button" onClick={addBlank} style={btn}>+ Blank template</button>
          <input ref={fileRef} type="file" accept=".md,.markdown,.txt,.docx,.pdf,.html" style={{ display: "none" }}
            data-testid="template-file-input"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
        </div>
      )}
      {error && <p style={{ margin: "0 0 8px", fontSize: "0.8125rem", color: "#dc2626" }}>{error}</p>}
      {intro && !readOnly && (
        <details style={{ marginBottom: "8px", fontSize: "0.8125rem", color: "var(--text-secondary, #666)" }}>
          <summary style={{ cursor: "pointer" }}>Document intro (not a template)</summary>
          <div className="rich-text" dangerouslySetInnerHTML={{ __html: markdownToHtml(intro) }} />
        </details>
      )}

      {templates.length > 0 && (
        <>
          <div role="tablist" style={{ display: "flex", gap: "4px", flexWrap: "wrap", borderBottom: "1px solid rgba(0,0,0,0.1)" }}>
            {templates.map((t) => {
              const on = t.key === current?.key;
              return (
                <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => select(t.key)}
                  style={{
                    padding: "7px 14px", fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer",
                    border: "none", borderBottom: `2px solid ${on ? "var(--twilio-red, #e22)" : "transparent"}`,
                    background: "transparent", color: on ? "var(--twilio-red, #e22)" : "var(--text-secondary, #888)",
                    fontFamily: "var(--font-base)", maxWidth: "260px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                  {t.title}
                </button>
              );
            })}
          </div>
          {current && (
            <div role="tabpanel" style={{ paddingTop: "10px" }}>
              {readOnly ? (
                <div className="prose prose-sm max-w-none rich-text" style={{ fontSize: "0.875rem", lineHeight: 1.6 }}
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(current.body_html) }} />
              ) : (
                <>
                  <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                    <input value={current.title} onChange={(e) => patch(current.key, { title: e.target.value })}
                      aria-label="Template name"
                      style={{ flex: 1, padding: "6px 10px", borderRadius: "6px", fontSize: "0.875rem", border: "1px solid var(--border, rgba(0,0,0,0.12))", fontFamily: "var(--font-base)" }} />
                    <button type="button" onClick={() => remove(current.key)} style={btn}>Remove tab</button>
                  </div>
                  <RichTextMentionEditor
                    key={current.key}
                    value={current.body_html}
                    onChange={(html) => patch(current.key, { body_html: html })}
                    enableKeywords
                    minHeightClassName="min-h-[160px]"
                    placeholder="Template body. Type @ for people, @# for records, @#-- for lookups like all action items for an account…"
                  />
                  <p style={{ margin: "6px 0 0", fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", lineHeight: 1.5 }}>
                    Use <code>[[Account]]</code> where the chosen account should go, and{" "}
                    <code>@#--all-action-items-${"{account_name}"}</code> or{" "}
                    <code>@#--all-meeting-notes-${"{account_name}"}-${"{date-range}"}</code> for live lookups when the skill runs.
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: "4px 12px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer",
  border: "1px solid rgba(0,0,0,0.15)", background: "transparent", color: "var(--text-secondary, #666)",
  fontFamily: "var(--font-base)",
};
