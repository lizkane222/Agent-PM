import { useState, useRef, useEffect } from "react";
import { airtableApi } from "../../lib/api";
import type { AirtableAccount } from "../../types";

export function SegmentWorkspacesField({ airtableAccount, airtableId, onSaved }: { airtableAccount: AirtableAccount | null; airtableId: string; onSaved: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(airtableAccount?.segment_workspaces ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Track the resolved airtable account PK (may need a lookup if parent didn't load it)
  const resolvedIdRef = useRef<number | null>(airtableAccount?.id ?? null);

  useEffect(() => {
    setValue(airtableAccount?.segment_workspaces ?? "");
    resolvedIdRef.current = airtableAccount?.id ?? null;
  }, [airtableAccount?.id, airtableAccount?.segment_workspaces]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      // If we don't have a PK yet, look it up by airtable_id
      if (!resolvedIdRef.current && airtableId) {
        const { data: res } = await airtableApi.listAccounts({ airtable_id: airtableId });
        const found = (res.results ?? [])[0];
        if (!found) { setError("No linked Airtable account found."); return; }
        resolvedIdRef.current = found.id;
      }
      if (!resolvedIdRef.current) { setError("No linked Airtable account."); return; }
      const { data } = await airtableApi.updateAirtableAccount(resolvedIdRef.current, { segment_workspaces: value });
      onSaved(data.segment_workspaces);
      setEditing(false);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Save failed. Please try again.");
    } finally { setSaving(false); }
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={3}
          placeholder="One workspace URL per line"
          className="w-full text-xs rounded border border-indigo-300 focus:border-indigo-500 focus:outline-none px-2 py-1 resize-none"
          style={{ fontFamily: "var(--font-base)" }}
          onKeyDown={(e) => { if (e.key === "Escape") { setValue(airtableAccount?.segment_workspaces ?? ""); setEditing(false); } }}
        />
        {error && <p className="text-[11px]" style={{ color: "var(--twilio-red, #e22)" }}>{error}</p>}
        <div className="flex gap-1">
          <button
            onClick={save}
            disabled={saving}
            className="text-[11px] px-2 py-0.5 rounded font-medium"
            style={{ background: "var(--twilio-red, #e22)", color: "#fff", opacity: saving ? 0.6 : 1 }}
          >{saving ? "Saving…" : "Save"}</button>
          <button
            onClick={() => { setValue(airtableAccount?.segment_workspaces ?? ""); setEditing(false); setError(""); }}
            className="text-[11px] px-2 py-0.5 rounded font-medium"
            style={{ background: "rgba(0,0,0,0.06)", color: "var(--twilio-gray-60)" }}
          >Cancel</button>
        </div>
      </div>
    );
  }

  const workspaces = (airtableAccount?.segment_workspaces ?? "")
    .split(/[\n,]/).map((ws) => ws.trim()).filter(Boolean);

  const segmentSlug = (url: string) => url.match(/app\.segment\.com\/([^/?#]+)/)?.[1] ?? null;

  return (
    <div
      className="cursor-pointer rounded px-1 -mx-1 hover:bg-black/[0.03] transition-colors"
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      {workspaces.length > 0 ? (
        <div className="flex flex-col gap-1">
          {workspaces.map((ws) => {
            const slackMatch = ws.match(/^<([^|>]+)(?:\|([^>]+))?>$/);
            if (slackMatch) {
              const url = slackMatch[1];
              const label = segmentSlug(url) ?? slackMatch[2] ?? url.replace(/^https?:\/\//, "").replace(/\/$/, "");
              return (
                <a key={ws} href={url} target="_blank" rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[11px] px-2 py-0.5 rounded-full font-medium truncate max-w-full"
                  style={{ background: "rgba(226,34,34,0.07)", color: "var(--twilio-red, #e22)" }}
                  title={url}
                >{label}</a>
              );
            }
            if (ws.startsWith("http")) {
              const label = segmentSlug(ws) ?? ws.replace(/^https?:\/\//, "").replace(/\/$/, "");
              return (
                <a key={ws} href={ws} target="_blank" rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[11px] px-2 py-0.5 rounded-full font-medium truncate max-w-full"
                  style={{ background: "rgba(226,34,34,0.07)", color: "var(--twilio-red, #e22)" }}
                  title={ws}
                >{label}</a>
              );
            }
            return (
              <span key={ws} className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(226,34,34,0.07)", color: "var(--twilio-red, #e22)" }}>{ws}</span>
            );
          })}
        </div>
      ) : (
        <span style={{ color: "var(--twilio-gray-60)", fontStyle: "italic", fontSize: "0.75rem" }}>—</span>
      )}
    </div>
  );
}
