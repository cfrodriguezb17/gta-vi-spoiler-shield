export const api = (globalThis as any).browser ?? (globalThis as any).chrome;
export const sites = ["reddit", "youtube", "x", "facebook", "instagram"] as const;
export type Site = (typeof sites)[number];
export type Settings = { mode: "preventive" | "smart"; disabled: Site[]; progress: number | null };
export const defaults: Settings = { mode: "preventive", disabled: [], progress: null };
export function settings(value: Partial<Settings> = {}): Settings {
  return {
    mode: value.mode === "smart" ? "smart" : "preventive",
    disabled: Array.isArray(value.disabled) ? value.disabled.filter((s) => sites.includes(s)) : [],
    progress: Number.isSafeInteger(value.progress) && value.progress! >= 0 ? value.progress! : null,
  };
}
