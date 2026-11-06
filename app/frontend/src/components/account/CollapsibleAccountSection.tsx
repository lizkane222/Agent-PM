import { useId, type ReactNode } from "react";
import { useAccountSectionCollapse } from "../../hooks/useAccountSectionCollapse";

const CARD_STYLE = {
  background: "var(--surface, #fff)",
  border: "1px solid var(--border, rgba(0,0,0,0.08))",
  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
} as const;

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" style={{ transition: "transform 0.18s", transform: open ? "rotate(0deg)" : "rotate(-90deg)", flexShrink: 0 }}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

/**
 * Wraps one Account Detail section so it can be folded away.
 *
 * Wraps at the container level, so whatever the section renders is untouched. The children
 * stay MOUNTED while collapsed (hidden, not unmounted): their fetches, drafts and open
 * modals survive a fold, and the section opens instantly. Collapsed, a slim bar with the
 * title replaces it; expanded, a small chevron sits in the section's own right padding.
 * The preference is global (see useAccountSectionCollapse).
 */
export default function CollapsibleAccountSection({
  id, title, children, bare = false, className,
}: {
  id: string;
  title: string;
  children: ReactNode;
  /** Collapsed bar without the card chrome (for sections already inside a card). */
  bare?: boolean;
  className?: string;
}) {
  const { isCollapsed, toggle } = useAccountSectionCollapse();
  const collapsed = isCollapsed(id);
  const bodyId = useId();
  return (
    <div className={`relative ${className ?? ""}`} data-section={id} data-collapsed={collapsed ? "true" : "false"}>
      {collapsed && (
        <button
          type="button"
          onClick={() => toggle(id)}
          aria-expanded={false}
          aria-controls={bodyId}
          aria-label={`Expand ${title}`}
          title={`Expand ${title}`}
          className="w-full flex items-center gap-2 rounded-lg px-4 py-2 text-left hover:opacity-80"
          style={bare ? { color: "var(--twilio-gray-60)" } : { ...CARD_STYLE, color: "var(--twilio-gray-60)" }}
        >
          <Chevron open={false} />
          <span className="text-xs font-semibold uppercase tracking-wide">{title}</span>
        </button>
      )}
      <div id={bodyId} hidden={collapsed}>{children}</div>
      {!collapsed && (
        <button
          type="button"
          onClick={() => toggle(id)}
          aria-expanded={true}
          aria-controls={bodyId}
          aria-label={`Collapse ${title}`}
          title={`Collapse ${title}`}
          className="absolute rounded hover:bg-gray-100 flex items-center justify-center"
          style={{ top: 6, right: 3, width: 16, height: 16, color: "var(--twilio-gray-60)", zIndex: 1 }}
        >
          <Chevron open />
        </button>
      )}
    </div>
  );
}
