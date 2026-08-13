import { useEffect, useRef, useState } from "react";

export function AccPillSelect<T extends string>({ value, options, colorMap, placeholder, onChange }: {
  value: T | undefined;
  options: readonly T[];
  colorMap: Record<string, string>;
  placeholder: string;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  const cls = value ? colorMap[value] ?? "bg-gray-100 text-[var(--twilio-navy)]" : "bg-gray-100 text-[var(--twilio-gray-60)]";
  if (open) {
    return (
      <select ref={ref} value={value ?? ""} onChange={(e) => { onChange(e.target.value as T); setOpen(false); }} onBlur={() => setOpen(false)}
        className="rounded-full border border-indigo-400 bg-white px-2.5 py-0.5 text-[12px] font-semibold focus:outline-none cursor-pointer">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <button type="button" onClick={() => setOpen(true)} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold cursor-pointer hover:opacity-75 transition-opacity ${cls}`}>
      {value ?? placeholder}
      <svg viewBox="0 0 8 5" fill="currentColor" className="w-1.5 h-1.5 opacity-50"><path d="M0 0l4 5 4-5z"/></svg>
    </button>
  );
}

export function AccPillDate({ value, onChange }: { value: string | null | undefined; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  const label = value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Due date";
  if (open) {
    return <input ref={ref} type="date" defaultValue={value ? value.slice(0, 10) : ""} onBlur={(e) => { onChange(e.target.value || null); setOpen(false); }}
      className="rounded-full border border-indigo-400 bg-white px-2.5 py-0.5 text-[12px] font-semibold focus:outline-none" />;
  }
  return (
    <button type="button" onClick={() => setOpen(true)} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold hover:opacity-75 transition-opacity cursor-pointer ${value ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200" : "bg-gray-100 text-[var(--twilio-gray-60)]"}`}>
      {value && <svg viewBox="0 0 12 12" fill="currentColor" className="w-2.5 h-2.5 opacity-70"><path d="M4 0a1 1 0 011 1h2a1 1 0 112 0h1a2 2 0 012 2v7a2 2 0 01-2 2H2a2 2 0 01-2-2V3a2 2 0 012-2h1a1 1 0 011-1zM2 5v5h8V5H2z"/></svg>}
      {label}
    </button>
  );
}

export function AccPillNumber({ value, label, onChange }: { value: number | null | undefined; label: string; onChange: (v: number | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { ref.current?.focus(); ref.current?.select(); } }, [open]);
  const mins = value != null && value > 0 ? Math.round(value / 60) : null;
  if (open) {
    return <input ref={ref} type="number" min={0} defaultValue={mins ?? ""} onBlur={(e) => { onChange(e.target.value !== "" ? Number(e.target.value) * 60 : null); setOpen(false); }}
      className="w-16 rounded-full border border-indigo-400 bg-white px-2.5 py-0.5 text-[12px] font-semibold focus:outline-none" placeholder="0" />;
  }
  return (
    <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold bg-gray-100 text-[var(--twilio-navy)] hover:opacity-75 transition-opacity cursor-pointer">
      {mins != null ? `${mins}m` : label}
    </button>
  );
}

export function AccPillUrl({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  if (open) {
    return <input ref={ref} type="url" defaultValue={value ?? ""} onBlur={(e) => { onChange(e.target.value); setOpen(false); }} placeholder="https://…"
      className="w-40 rounded-full border border-indigo-400 bg-white px-2.5 py-0.5 text-[12px] font-semibold focus:outline-none" />;
  }
  if (value) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 px-2.5 py-0.5 text-[12px] font-semibold">
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 hover:underline"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5 shrink-0"><path d="M6 2a2 2 0 00-2 2v5a2 2 0 002 2h1v2l2.5-2.5A1 1 0 0110 10h2a2 2 0 002-2V4a2 2 0 00-2-2H6z"/></svg>
          Slack ↗
        </a>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ml-0.5 text-indigo-400 hover:text-indigo-700 leading-none"
          title="Edit URL"
        >✎</button>
      </span>
    );
  }
  return (
    <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold hover:opacity-75 transition-opacity cursor-pointer bg-gray-100 text-[var(--twilio-gray-60)]">
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5"><path d="M6 2a2 2 0 00-2 2v5a2 2 0 002 2h1v2l2.5-2.5A1 1 0 0110 10h2a2 2 0 002-2V4a2 2 0 00-2-2H6z"/></svg>
      Slack
    </button>
  );
}
