const EMOJI_SHORTCODES: Record<string, string> = {
  // Slack standard shortcodes
  link: "🔗", memo: "📝", pencil: "✏️", pencil2: "✏️", page_facing_up: "📄",
  page_with_curl: "📃", file_folder: "📁", open_file_folder: "📂", bar_chart: "📊",
  chart_with_upwards_trend: "📈", chart_with_downwards_trend: "📉", clipboard: "📋",
  pushpin: "📌", round_pushpin: "📍", bulb: "💡", star: "⭐", star2: "🌟",
  tada: "🎉", rocket: "🚀", fire: "🔥", zap: "⚡", check: "✅", white_check_mark: "✅",
  x: "❌", warning: "⚠️", construction: "🚧", lock: "🔒", key: "🔑",
  globe_with_meridians: "🌐", earth_americas: "🌎", world_map: "🗺️",
  computer: "💻", desktop_computer: "🖥️", iphone: "📱", phone: "📞",
  email: "📧", mailbox: "📬", bell: "🔔", eyes: "👀", brain: "🧠",
  hammer: "🔨", wrench: "🔧", gear: "⚙️", package: "📦", inbox_tray: "📥",
  outbox_tray: "📤", speech_balloon: "💬", thought_balloon: "💭",
  calendar: "📅", date: "📅", clock1: "🕐", hourglass: "⏳", timer_clock: "⏱️",
  trophy: "🏆", medal: "🏅", handshake: "🤝", wave: "👋", point_right: "👉",
  point_left: "👈", point_up: "☝️", thumbsup: "👍", thumbsdown: "👎",
  heart: "❤️", blue_heart: "💙", green_heart: "💚", purple_heart: "💜",
  snowflake: "❄️", sun: "☀️", rainbow: "🌈", cloud: "☁️", lightning: "⚡",
  // Vendor / brand shortcodes
  snowflakedb: "❄️", snowflake_db: "❄️",
  salesforce: "☁️", jira: "📋", confluence: "📖", slack: "💬",
  github: "🐙", notion: "📓", figma: "🎨", loom: "🎬",
  google_docs: "📄", google_sheets: "📊", google_slides: "📽️", google_drive: "📁",
};

export function resolveEmojiShortcodes(text: string): string {
  return text.replace(/:([a-z0-9_]+):/gi, (match, code) => EMOJI_SHORTCODES[code.toLowerCase()] ?? match);
}
