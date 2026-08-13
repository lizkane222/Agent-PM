import { useState, useRef, useEffect } from "react";
import { accountsApi } from "../../lib/api";
import type { AccountQuickLink } from "../../types";
import { resolveEmojiShortcodes } from "../../lib/emojiShortcodes";
import segmentIconUrl from "../../assets/icons/Segment.svg";

export function QuickLinksPanel({
  accountId,
  links,
  onLinksChange,
}: {
  accountId: number;
  links: AccountQuickLink[];
  onLinksChange: (links: AccountQuickLink[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) nameInputRef.current?.focus();
  }, [adding]);

  async function handleCreate() {
    const name = newName.trim();
    const url = newUrl.trim();
    if (!name || !url) return;
    setSaving(true);
    try {
      const { data } = await accountsApi.createQuickLink(accountId, name, url);
      onLinksChange([...links, data]);
      setNewName("");
      setNewUrl("");
      setAdding(false);
    } catch { /* best effort */ } finally {
      setSaving(false);
    }
  }

  function startEdit(link: AccountQuickLink) {
    setEditingId(link.id);
    setEditName(link.name);
    setEditUrl(link.url);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditUrl("");
  }

  async function commitEdit() {
    if (editingId === null) return;
    const name = editName.trim();
    const url = editUrl.trim();
    if (!name || !url) { cancelEdit(); return; }
    setSaving(true);
    try {
      const { data } = await accountsApi.updateQuickLink(editingId, { name, url });
      onLinksChange(links.map((l) => (l.id === editingId ? data : l)));
      cancelEdit();
    } catch { /* best effort */ } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await accountsApi.deleteQuickLink(id);
      onLinksChange(links.filter((l) => l.id !== id));
    } catch { /* best effort */ }
  }

  function getFaviconUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      const h = parsed.hostname.replace(/^www\./, "");
      const p = parsed.pathname;
      // Google products — favicon API returns generic G; use gstatic CDN instead
      if (h === "docs.google.com") {
        if (p.startsWith("/spreadsheets/")) return "https://ssl.gstatic.com/images/branding/product/1x/sheets_2020q4_32dp.png";
        if (p.startsWith("/presentation/")) return "https://ssl.gstatic.com/images/branding/product/1x/slides_2020q4_32dp.png";
        if (p.startsWith("/forms/")) return "https://ssl.gstatic.com/images/branding/product/1x/forms_2020q4_32dp.png";
        return "https://ssl.gstatic.com/images/branding/product/1x/docs_2020q4_32dp.png";
      }
      if (h === "sheets.google.com") return "https://ssl.gstatic.com/images/branding/product/1x/sheets_2020q4_32dp.png";
      if (h === "slides.google.com") return "https://ssl.gstatic.com/images/branding/product/1x/slides_2020q4_32dp.png";
      if (h === "forms.google.com") return "https://ssl.gstatic.com/images/branding/product/1x/forms_2020q4_32dp.png";
      if (h === "drive.google.com") return "https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png";
      if (h === "calendar.google.com") return "https://ssl.gstatic.com/images/branding/product/1x/calendar_2020q4_32dp.png";
      if (h === "mail.google.com" || h === "gmail.com") return "https://ssl.gstatic.com/images/branding/product/1x/gmail_2020q4_32dp.png";
      if (h === "sites.google.com") return "https://ssl.gstatic.com/images/branding/product/1x/sites_2020q4_32dp.png";
      if (h === "notebooklm.google.com") return "https://www.gstatic.com/images/branding/product/1x/notebooklm_32dp.png";
      if (h === "gemini.google.com") return "https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg";
      // Twilio subdomains — normalize to twilio.com so favicon resolves correctly
      if (h === "twilio.com" || h.endsWith(".twilio.com"))
        return `https://www.google.com/s2/favicons?sz=16&domain=twilio.com`;
      // Segment subdomains — use local asset
      if (h === "segment.com" || h.endsWith(".segment.com") || h.endsWith(".segment.io"))
        return segmentIconUrl;
      // Salesforce Lightning (*.force.com) — use root salesforce.com so favicon resolves
      if (h.endsWith(".force.com") || h.endsWith(".salesforce.com"))
        return `https://www.google.com/s2/favicons?sz=16&domain=salesforce.com`;
      // Everything else — generic favicon API works fine for non-Google domains
      return `https://www.google.com/s2/favicons?sz=16&domain=${h}`;
    } catch { return null; }
  }

  return (
    <div style={{ borderTop: "1px solid var(--border, rgba(0,0,0,0.08))", paddingTop: "0.75rem", margin: "0 1rem 0.75rem" }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] text-[var(--twilio-gray-60)] uppercase tracking-wide">Quick Links</p>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="text-[11px] font-medium hover:opacity-70 transition-opacity"
            style={{ color: "var(--twilio-red, #e22)" }}
            title="Add quick link"
          >+ Add</button>
        )}
      </div>

      {/* Existing links */}
      <div className="flex flex-col gap-1">
        {links.map((link) => {
          const favicon = getFaviconUrl(link.url);
          if (editingId === link.id) {
            return (
              <div key={link.id} className="flex flex-col gap-1.5">
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(resolveEmojiShortcodes(e.target.value))}
                  placeholder="Link name"
                  className="w-full text-xs rounded border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-red-300"
                  style={{ border: "1px solid rgba(0,0,0,0.12)", color: "var(--text-primary, #111)" }}
                  onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }}
                />
                <input
                  value={editUrl}
                  onChange={(e) => setEditUrl(e.target.value)}
                  placeholder="https://…"
                  className="w-full text-xs rounded border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-red-300"
                  style={{ border: "1px solid rgba(0,0,0,0.12)", color: "var(--text-primary, #111)" }}
                  onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }}
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={commitEdit}
                    disabled={saving || !editName.trim() || !editUrl.trim()}
                    className="flex-1 text-xs font-semibold py-1 rounded-lg text-white disabled:opacity-40 transition-colors"
                    style={{ background: "var(--twilio-red, #e22)" }}
                  >Save</button>
                  <button
                    onClick={cancelEdit}
                    className="flex-1 text-xs font-semibold py-1 rounded-lg border transition-colors hover:bg-gray-50"
                    style={{ color: "var(--text-secondary, #888)", border: "1px solid rgba(0,0,0,0.1)" }}
                  >Cancel</button>
                </div>
              </div>
            );
          }
          return (
            <div key={link.id} className="group relative flex items-center gap-1.5">
              {favicon && <img src={favicon} alt="" className="w-3.5 h-3.5 shrink-0 rounded-sm" />}
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-xs truncate hover:underline"
                style={{ color: "var(--twilio-red, #e22)" }}
                title={link.url}
              >{resolveEmojiShortcodes(link.name)}</a>
              <div className="absolute right-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white pl-2">
                <button
                  onClick={() => startEdit(link)}
                  className="text-[10px] leading-none hover:text-[var(--twilio-navy)]"
                  style={{ color: "var(--twilio-gray-60)" }}
                  title="Edit"
                >✎</button>
                <button
                  onClick={() => handleDelete(link.id)}
                  className="text-[10px] leading-none hover:text-red-500"
                  style={{ color: "var(--twilio-gray-60)" }}
                  title="Remove"
                >✕</button>
              </div>
            </div>
          );
        })}
        {links.length === 0 && !adding && (
          <p className="text-[11px] italic" style={{ color: "var(--twilio-gray-60)" }}>No quick links yet</p>
        )}
      </div>

      {/* Inline add form */}
      {adding && (
        <div className="mt-2 flex flex-col gap-1.5">
          <input
            ref={nameInputRef}
            value={newName}
            onChange={(e) => setNewName(resolveEmojiShortcodes(e.target.value))}
            placeholder="Link name"
            className="w-full text-xs rounded border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-red-300"
            style={{ border: "1px solid rgba(0,0,0,0.12)", color: "var(--text-primary, #111)" }}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setAdding(false); setNewName(""); setNewUrl(""); } }}
          />
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://…"
            className="w-full text-xs rounded border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-red-300"
            style={{ border: "1px solid rgba(0,0,0,0.12)", color: "var(--text-primary, #111)" }}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setAdding(false); setNewName(""); setNewUrl(""); } }}
          />
          <div className="flex gap-1.5">
            <button
              onClick={handleCreate}
              disabled={saving || !newName.trim() || !newUrl.trim()}
              className="flex-1 text-xs font-semibold py-1 rounded-lg text-white disabled:opacity-40 transition-colors"
              style={{ background: "var(--twilio-red, #e22)" }}
            >Add</button>
            <button
              onClick={() => { setAdding(false); setNewName(""); setNewUrl(""); }}
              className="flex-1 text-xs font-semibold py-1 rounded-lg border transition-colors hover:bg-gray-50"
              style={{ color: "var(--text-secondary, #888)", border: "1px solid rgba(0,0,0,0.1)" }}
            >Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
