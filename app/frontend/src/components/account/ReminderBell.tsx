import type { CSSProperties } from "react";

export function ReminderBell({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className} style={style}>
      <path d="M10 2a6 6 0 00-6 6v3l-1.5 2.5h15L16 11V8a6 6 0 00-6-6z" strokeLinejoin="round"/>
      <path d="M8.5 16.5a1.5 1.5 0 003 0" strokeLinecap="round"/>
    </svg>
  );
}
