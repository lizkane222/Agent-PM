import { useScheduledOccurrences } from "../../hooks/useScheduledOccurrences";

export function ActionItemCardOccurrences({ airtableId }: { airtableId: string }) {
  const occurrences = useScheduledOccurrences(airtableId);
  if (occurrences.length === 0) return null;
  return (
    <div className="mt-0.5 pt-1.5 border-t border-gray-200/70">
      <p className="text-[9px] font-semibold text-indigo-500 uppercase tracking-wide mb-0.5">On calendar</p>
      {occurrences.map((o) => (
        <p key={o.start} className="text-[10px] text-indigo-600 leading-tight">
          {new Date(o.start).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </p>
      ))}
    </div>
  );
}
