import SiteFavicon, { safeHttpUrl } from "../shared/SiteFavicon";
import type { AppletPin } from "../../types/discover";

/**
 * A compact list of pinned Discovery items: favicon + name linking out in a new tab, with an
 * unpin ✕ where the viewer is allowed to remove it. Renders nothing when empty (`emptyText`
 * to show a line instead).
 */
export default function PinnedTools({
  pins, onUnpin, emptyText, showAccount = false,
}: {
  pins: AppletPin[];
  onUnpin?: (id: number) => void | Promise<unknown>;
  emptyText?: string;
  showAccount?: boolean;
}) {
  if (pins.length === 0) {
    return emptyText ? <p className="text-xs" style={{ color: "var(--text-secondary, #9ca3af)" }}>{emptyText}</p> : null;
  }
  return (
    <ul className="flex flex-col gap-1.5" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {pins.map((p) => {
        const href = safeHttpUrl(p.applet.url);
        const label = (
          <>
            <SiteFavicon url={p.applet.url} name={p.applet.name} size={16} />
            <span className="truncate">{p.applet.name}</span>
          </>
        );
        return (
          <li key={p.id} className="flex items-center gap-2 min-w-0 text-xs" data-testid="pinned-tool">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                title={p.applet.description}
                className="flex items-center gap-2 min-w-0 flex-1 hover:underline"
                style={{ color: "var(--text-primary, #111)", textDecoration: "none" }}
              >
                {label}
              </a>
            ) : (
              <span className="flex items-center gap-2 min-w-0 flex-1">{label}</span>
            )}
            {showAccount && p.account_name && (
              <span className="shrink-0 text-[10px]" style={{ color: "var(--text-secondary, #9ca3af)" }}>{p.account_name}</span>
            )}
            {p.can_remove && onUnpin && (
              <button
                type="button"
                onClick={() => { void onUnpin(p.id); }}
                aria-label={`Unpin ${p.applet.name}`}
                title="Unpin"
                className="shrink-0 rounded hover:bg-[var(--surface-subtle-2)]"
                style={{ width: 18, height: 18, color: "var(--text-secondary, #9ca3af)", lineHeight: 1 }}
              >
                ✕
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
