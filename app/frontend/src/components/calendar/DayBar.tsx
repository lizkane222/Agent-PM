import type { CalendarEvent } from "../../types";

interface Props {
  events: CalendarEvent[];
  selectedEvent: CalendarEvent;
  onSelect: (event: CalendarEvent) => void;
}

function sameDay(a: string, b: string) {
  return a.slice(0, 10) === b.slice(0, 10);
}

export default function DayBar({ events, selectedEvent, onSelect }: Props) {
  const dayEvents = events.filter((e) =>
    sameDay(e.start_datetime, selectedEvent.start_datetime)
  );

  if (dayEvents.length <= 1) return null;

  return (
    <div className="mt-4 px-1">
      <p className="text-sm text-[var(--twilio-gray-60)] uppercase tracking-wide mb-2">
        All meetings —{" "}
        {new Date(selectedEvent.start_datetime).toLocaleDateString(undefined, {
          weekday: "long",
          month: "short",
          day: "numeric",
        })}
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1 flex-wrap">
        {dayEvents.map((e) => {
          const active = e.id === selectedEvent.id;
          return (
            <button
              key={e.id}
              onClick={() => onSelect(e)}
              className="shrink-0 flex flex-col items-center px-3 py-1 rounded-lg border text-center transition-colors"
              style={{
                background: active ? "#0263E0" : "#f9fafb",
                borderColor: active ? "#0263E0" : "#e5e7eb",
                color: active ? "#fff" : "#374151",
                minWidth: "200px",
                maxWidth: "280px",
              }}
            >
              <span className="text-[11px] font-semibold truncate w-full">{e.title}</span>
              <span className="text-[10px] opacity-70">
                {new Date(e.start_datetime).toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
