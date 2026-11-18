import en from "./_locales/en/messages.json";
import es from "./_locales/es/messages.json";
import { api } from "./api";

export type Locale = "en" | "es";
export type Language = Locale | "auto";
export type Message = keyof typeof en;

const messages: Record<Locale, Record<Message, { message: string }>> = { en, es };

export function resolveLocale(language: Language, browserLocale?: string): Locale {
  if (language !== "auto") return language;
  const browserLanguage = (browserLocale ?? api.i18n.getUILanguage()).toLowerCase();
  return /^es(?:[-_]|$)/.test(browserLanguage) ? "es" : "en";
}

export function translate(locale: Locale, key: Message): string {
  return messages[locale][key].message;
}
