import type { AppError } from "../types/errors";

interface Props {
  errors: AppError[];
  onDismiss: (id: string) => void;
}

export default function AppErrorBanner({ errors, onDismiss }: Props) {
  if (errors.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: "1.5rem",
        right: "1.5rem",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        maxWidth: "24rem",
        width: "calc(100vw - 3rem)",
        pointerEvents: "none",
      }}
      aria-live="assertive"
    >
      {errors.map((err) => (
        <div
          key={err.id}
          role="alert"
          style={{
            pointerEvents: "auto",
            background: "#fff",
            border: "1px solid #fca5a5",
            borderLeft: "4px solid #ef4444",
            borderRadius: "0.5rem",
            padding: "0.75rem 1rem",
            boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
            display: "flex",
            alignItems: "flex-start",
            gap: "0.75rem",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {err.source && (
              <span
                style={{
                  display: "inline-block",
                  marginBottom: "0.25rem",
                  padding: "0 0.5rem",
                  borderRadius: "9999px",
                  fontSize: "0.625rem",
                  fontWeight: 600,
                  lineHeight: "1.5rem",
                  background: "#fee2e2",
                  color: "#b91c1c",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {err.source}
              </span>
            )}
            <p style={{ margin: 0, fontSize: "0.875rem", color: "#1f2937", lineHeight: 1.4 }}>
              {err.message}
            </p>
          </div>
          <button
            onClick={() => onDismiss(err.id)}
            aria-label="Dismiss error"
            style={{
              flexShrink: 0,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0.125rem 0.25rem",
              color: "#9ca3af",
              lineHeight: 1,
              fontSize: "1.125rem",
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
