import { expect, test } from "bun:test";
import { settings } from "../extension/api";
import { resolveLocale, translate } from "../extension/i18n";

test("automatic language follows Spanish and falls back to English", () => {
  expect(resolveLocale("auto", "es-CO")).toBe("es");
  expect(resolveLocale("auto", "ES")).toBe("es");
  expect(resolveLocale("auto", "en-GB")).toBe("en");
  expect(resolveLocale("auto", "fr-FR")).toBe("en");
  expect(resolveLocale("en", "es-CO")).toBe("en");
  expect(resolveLocale("es", "en-US")).toBe("es");
  expect(translate("es", "showPost")).toBe("Mostrar");
  expect(translate("en", "showPost")).toBe("Show");
  expect(translate("es", "combined")).toBe("Combinado");
  expect(translate("en", "combined")).toBe("Combined");
});

test("existing settings preserve mode and networks and ignore stored progress", () => {
  const current = { mode: "smart" as const, disabled: ["x" as const] };
  const previous = { ...current, progress: 99 };
  expect(settings(previous)).toEqual({ ...current, language: "auto" });
  expect(settings({ ...previous, language: "es" })).toEqual({ ...current, language: "es" });
  expect(settings({ ...previous, mode: "combined" })).toEqual({ ...current, mode: "combined", language: "auto" });
  expect(settings({ mode: "unknown" }).mode).toBe("preventive");
});
