import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { agentSkillsApi } from "../lib/api";
import { TWILIO_SKILLS } from "../lib/twilioSkills";

/**
 * "/" skill lookup for chat composers.
 *
 * Not built on `useResource`: the list is fetched lazily, on the first "/" typed, and the result is
 * kept for the life of the composer (same exemption `useCalendarColors` documents).
 */
export interface SlashSkillItem {
  key: string;
  /** What gets inserted after the slash. */
  name: string;
  description: string;
  kind: "agent" | "twilio";
}

const MAX_ITEMS = 50;
/** A "/" that starts the input or follows whitespace, then the characters typed so far. */
const TOKEN_RE = /(^|\s)\/([^\s/]*)$/;

export function filterSlashSkills(all: SlashSkillItem[], query: string): SlashSkillItem[] {
  const q = query.toLowerCase();
  if (!q) return all.slice(0, MAX_ITEMS);
  const starts: SlashSkillItem[] = [];
  const contains: SlashSkillItem[] = [];
  for (const s of all) {
    const n = s.name.toLowerCase();
    if (n.startsWith(q)) starts.push(s);
    else if (n.includes(q) || s.description.toLowerCase().includes(q)) contains.push(s);
  }
  return [...starts, ...contains].slice(0, MAX_ITEMS);
}

interface Options {
  value: string;
  onChange: (next: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function useSlashSkills({ value, onChange, inputRef }: Options) {
  const [agentSkills, setAgentSkills] = useState<SlashSkillItem[]>([]);
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const fetched = useRef(false);

  const match = TOKEN_RE.exec(value.slice(0, caret));
  const tokenStart = match ? match.index + match[1].length : -1;
  const query = match ? match[2] : "";
  const tokenKey = match ? `${tokenStart}:${query}` : null;

  // Lazy: nothing is requested until the user types a "/".
  useEffect(() => {
    if (!match || fetched.current) return;
    fetched.current = true;
    agentSkillsApi.list()
      .then((r) => {
        const rows = r.data.results ?? [];
        setAgentSkills(
          rows.filter((s) => s.status === "approved")
            .map((s) => ({ key: `agent-${s.id}`, name: s.name, description: s.description, kind: "agent" as const })),
        );
      })
      .catch(() => { fetched.current = false; });
  }, [match]);

  const all = useMemo<SlashSkillItem[]>(() => {
    const twilio = TWILIO_SKILLS.map((t) => ({ key: `twilio-${t.slug}`, name: t.slug, description: t.description, kind: "twilio" as const }));
    return [...agentSkills, ...twilio];
  }, [agentSkills]);

  const items = useMemo(() => (match ? filterSlashSkills(all, query) : []), [match, all, query]);
  const open = tokenKey !== null && dismissed !== tokenKey && items.length > 0;

  useEffect(() => { setHighlight(0); }, [query]);
  useEffect(() => { if (tokenKey === null) setDismissed(null); }, [tokenKey]);

  const select = useCallback((item: SlashSkillItem) => {
    if (tokenStart < 0) return;
    const insert = `/${item.name} `;
    const next = value.slice(0, tokenStart) + insert + value.slice(caret);
    const pos = tokenStart + insert.length;
    onChange(next);
    setCaret(pos);
    setDismissed(null);
    setTimeout(() => {
      const el = inputRef.current;
      if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    }, 0);
  }, [tokenStart, value, caret, onChange, inputRef]);

  /** Returns true when the key was consumed by the menu (caller must not also act on it). */
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, items.length - 1)); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); return true; }
    if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
      e.preventDefault();
      const item = items[Math.min(highlight, items.length - 1)];
      if (item) select(item);
      return true;
    }
    if (e.key === "Escape") { e.preventDefault(); setDismissed(tokenKey); return true; }
    return false;
  }, [open, items, highlight, select, tokenKey]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    setCaret(e.target.selectionStart ?? e.target.value.length);
  }, [onChange]);

  /** Wire to the textarea's onSelect so moving the caret re-evaluates the token. */
  const handleSelect = useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    setCaret(e.currentTarget.selectionStart ?? 0);
  }, []);

  // Programmatic changes (inject, clear after send) can leave the caret past the end.
  const safeCaret = Math.min(caret, value.length);
  useEffect(() => { if (caret !== safeCaret) setCaret(safeCaret); }, [caret, safeCaret]);
  useEffect(() => { if (value === "") setCaret(0); }, [value]);

  return { open, items, highlight, setHighlight, select, handleKeyDown, handleChange, handleSelect };
}

export type SlashSkillsState = ReturnType<typeof useSlashSkills>;
