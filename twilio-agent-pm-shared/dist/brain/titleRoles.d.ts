import type { TitleRole } from "../types.js";
export { ROLE_OPTIONS } from "../types.js";
export type { TitleRole, RoleOption } from "../types.js";
export declare const ROLE_ORDER: TitleRole[];
export declare const ROLE_META: Record<TitleRole, {
    border: string;
    bg: string;
    text: string;
    label: string;
    slug: string;
}>;
export declare const ROLED_PAGES: TitleRole[];
export declare const SLUG_TO_ROLE: Record<string, TitleRole>;
export declare function getTitleRole(title: string | null | undefined): TitleRole;
//# sourceMappingURL=titleRoles.d.ts.map