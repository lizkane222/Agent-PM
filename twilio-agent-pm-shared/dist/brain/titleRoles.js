export { ROLE_OPTIONS } from "../types.js";
export const ROLE_ORDER = ["SA", "PM", "PgM", "CSM", "MA", "TAM", "AE", "ENG", "other"];
export const ROLE_META = {
    SA: { border: "#7c3aed", bg: "#ede9fe", text: "#5b21b6", label: "Solutions Architect", slug: "sa" },
    PM: { border: "#0284c7", bg: "#e0f2fe", text: "#075985", label: "Product Manager", slug: "pm" },
    PgM: { border: "#4f46e5", bg: "#eef2ff", text: "#3730a3", label: "Program Manager", slug: "pgm" },
    CSM: { border: "#059669", bg: "#d1fae5", text: "#065f46", label: "Customer Success Manager", slug: "csm" },
    MA: { border: "#d97706", bg: "#fef3c7", text: "#92400e", label: "Manager", slug: "ma" },
    TAM: { border: "#e11d48", bg: "#ffe4e6", text: "#9f1239", label: "Technical Account Manager", slug: "tam" },
    AE: { border: "#0891b2", bg: "#cffafe", text: "#155e75", label: "Account Executive", slug: "ae" },
    ENG: { border: "#475569", bg: "#f1f5f9", text: "#1e293b", label: "Engineer", slug: "eng" },
    other: { border: "#9ca3af", bg: "#f3f4f6", text: "#374151", label: "Other", slug: "other" },
};
export const ROLED_PAGES = ["SA", "CSM", "PM", "PgM", "MA", "TAM", "AE"];
export const SLUG_TO_ROLE = Object.fromEntries(Object.entries(ROLE_META).map(([k, v]) => [v.slug, k]));
// Match in specificity order: TAM before MA, SA before generic.
export function getTitleRole(title) {
    if (!title)
        return "other";
    const t = title.toLowerCase();
    if (t.includes("solution") && t.includes("architect"))
        return "SA";
    if (/\bsa\b/.test(t))
        return "SA";
    if (t.includes("technical account"))
        return "TAM";
    if (/\btam\b/.test(t))
        return "TAM";
    if (t.includes("customer success"))
        return "CSM";
    if (/\bcsm\b/.test(t))
        return "CSM";
    if (t.includes("program manager") || t.includes("project manager"))
        return "PgM";
    if (/\bpgm\b/.test(t))
        return "PgM";
    if (t.includes("product manager"))
        return "PM";
    if (/\bpm\b/.test(t))
        return "PM";
    if (t.includes("manager"))
        return "MA";
    if (/\bma\b/.test(t))
        return "MA";
    if (t.includes("account executive") || /\bae\b/.test(t))
        return "AE";
    if (t.includes("engineer") || /\beng\b/.test(t))
        return "ENG";
    return "other";
}
//# sourceMappingURL=titleRoles.js.map