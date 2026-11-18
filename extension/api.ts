import type { Language } from "./i18n";

export const api = (globalThis as any).browser ?? (globalThis as any).chrome;
export const sites = ["reddit", "youtube", "x", "facebook", "instagram"] as const;
export type Site = (typeof sites)[number];
export type Settings = { mode: "preventive" | "smart" | "combined"; disabled: Site[]; language: Language };
export const defaults: Settings = { mode: "preventive", disabled: [], language: "auto" };
export function settings(value: Partial<Omit<Settings, "mode">> & { mode?: unknown } = {}): Settings {
  return {
    mode: value.mode === "smart" || value.mode === "combined" ? value.mode : defaults.mode,
    disabled: Array.isArray(value.disabled) ? value.disabled.filter((s) => sites.includes(s)) : [],
    language: value.language === "en" || value.language === "es" ? value.language : "auto",
  };
}
