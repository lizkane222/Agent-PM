import { renderEventDescriptionHtml } from "../../lib/safeEventHtml";

/** Calendar event description with real line breaks and safe links. */
export function EventDescription({ text, className = "", style }: { text: string; className?: string; style?: React.CSSProperties }) {
  const html = renderEventDescriptionHtml(text);
  if (!html) return null;
  return (
    <div
      data-testid="event-description"
      className={`leading-relaxed break-words rich-text ${className}`}
      style={style}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
