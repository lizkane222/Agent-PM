import type { CanvasNode } from "./types";

export interface ComponentVariant {
  id: string;
  baseType: string;   // e.g. "ActionItemCard"
  name: string;
  node: CanvasNode;   // full props snapshot
  scope: "me" | "all";
  pinned: boolean;
  hearted: boolean;
  createdAt: string;
}

const STORAGE_KEY = "agentpm_component_variants";

export function loadVariants(): ComponentVariant[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ComponentVariant[]) : [];
  } catch { return []; }
}

export function saveVariants(variants: ComponentVariant[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(variants));
}

export function addVariant(variant: ComponentVariant): ComponentVariant[] {
  const variants = loadVariants();
  const next = [...variants, variant];
  saveVariants(next);
  return next;
}

export function updateVariant(id: string, patch: Partial<ComponentVariant>): ComponentVariant[] {
  const variants = loadVariants().map((v) => v.id === id ? { ...v, ...patch } : v);
  saveVariants(variants);
  return variants;
}

export function deleteVariant(id: string): ComponentVariant[] {
  const variants = loadVariants().filter((v) => v.id !== id);
  saveVariants(variants);
  return variants;
}
