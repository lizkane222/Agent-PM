import { REMINDER_CHANNELS, type ReminderChannels } from "../../lib/reminderDraft";

/**
 * "Notify me via" — how the person making the reminder wants to be told. It is deliberately about
 * the creator only: anyone added under "Also notify" is reached the way *they* chose in their own
 * Settings, so ticking Phone here never texts a teammate.
 */
export default function ReminderChannelsField({
  value,
  onChange,
  showTeammateNote = true,
}: {
  value: ReminderChannels;
  onChange: (next: ReminderChannels) => void;
  /** Whether to add the line about how teammates are reached (only meaningful where they can be added). */
  showTeammateNote?: boolean;
}) {
  return (
    <fieldset className="border-0 p-0 m-0 flex flex-col gap-1">
      <legend className="text-[11px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)] mb-1">Notify me via</legend>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {REMINDER_CHANNELS.map((ch) => (
          <label key={ch.key} className="flex items-center gap-1.5 text-[13px] text-[var(--twilio-navy)] cursor-pointer">
            <input
              type="checkbox"
              checked={value[ch.key]}
              onChange={(e) => onChange({ ...value, [ch.key]: e.target.checked })}
              onClick={(e) => e.stopPropagation()}
            />
            {ch.label}
          </label>
        ))}
      </div>
      {showTeammateNote && (
        <p className="m-0 text-[11px] text-[var(--twilio-gray-60)]">
          These are for you. Anyone you add under “Also notify” is reached the way they chose in their own Settings.
        </p>
      )}
    </fieldset>
  );
}
