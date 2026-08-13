import React from "react";

// Renders note text: @mentions → indigo, [text](url) → clickable link
export function renderNoteInline(text: string): React.ReactNode[] {
  const TOKEN = /(\[([^\]]+)\]\((https?:\/\/[^)]+)\))|(@\S+)/g;
  const parts: React.ReactNode[] = [];
  let last = 0, match: RegExpExecArray | null;
  while ((match = TOKEN.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1]) {
      parts.push(<a key={match.index} href={match[3]} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline underline-offset-2 hover:opacity-75" onClick={(e) => e.stopPropagation()}>{match[2]}</a>);
    } else {
      parts.push(<span key={match.index} className="text-indigo-500 font-medium">{match[0]}</span>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// On paste: if text is selected and clipboard looks like a URL, wrap as [selection](url)
export function handleLinkPaste(
  e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  value: string,
  setValue: (v: string) => void,
) {
  const pasted = e.clipboardData.getData("text").trim();
  if (!/^https?:\/\/\S+$/.test(pasted)) return;
  const el = e.currentTarget;
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  if (start === end) return; // nothing selected — let normal paste happen
  e.preventDefault();
  const selected = value.slice(start, end);
  const replacement = `[${selected}](${pasted})`;
  const next = value.slice(0, start) + replacement + value.slice(end);
  setValue(next);
  // Restore cursor after the link
  requestAnimationFrame(() => {
    const pos = start + replacement.length;
    el.setSelectionRange(pos, pos);
  });
}
