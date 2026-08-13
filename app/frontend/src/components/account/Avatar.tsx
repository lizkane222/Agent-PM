import { ROLE_META, getTitleRole } from "../../lib/titleRoles";

export function Avatar({ name, avatarUrl, size = 9 }: { name: string; avatarUrl?: string; size?: number }) {
  const mc = ROLE_META[getTitleRole("")];
  const initials = name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  const cls = `h-${size} w-${size} rounded-full flex items-center justify-center text-[11px] font-semibold ring-2 ring-white shrink-0`;
  if (avatarUrl) return <img src={avatarUrl} alt={name} className={`${cls} object-cover`} />;
  return <div className={cls} style={{ backgroundColor: mc.bg, color: mc.text }}>{initials}</div>;
}
