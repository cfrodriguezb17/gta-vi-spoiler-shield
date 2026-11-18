import { api, settings, sites } from "./api";
import { resolveLocale, translate, type Language, type Message } from "./i18n";
const field = document.querySelector("#networks")!,
  language = document.querySelector<HTMLSelectElement>("#language")!,
  form = document.querySelector("form")!,
  out = document.querySelector("output")!,
  sync = document.querySelector<HTMLButtonElement>("#sync")!;
const names = { reddit: "Reddit", youtube: "YouTube", x: "X", facebook: "Facebook", instagram: "Instagram" };
let current = settings();
let syncStatus: { lastSync?: number; failed: boolean } | undefined;

function renderStatus() {
  if (!syncStatus) return;
  const locale = resolveLocale(current.language);
  const date = syncStatus.lastSync;
  const summary = date
    ? translate(locale, "lastSync") + " · " + new Date(date).toLocaleString(locale)
    : translate(locale, "noCatalog");
  out.textContent = summary + (syncStatus.failed ? " " + translate(locale, "syncError") : "");
}

function renderLanguage() {
  const locale = resolveLocale(current.language);
  document.documentElement.lang = locale;
  document.title = translate(locale, "extensionName");
  for (const element of document.querySelectorAll<HTMLElement>("[data-message]"))
    element.textContent = translate(locale, element.dataset.message as Message);
  renderStatus();
}

async function init() {
  current = settings(await api.storage.local.get("settings").then(
    (stored: any) => stored.settings,
    () => undefined,
  ));
  for (const site of sites) {
    const label = document.createElement("label"),
      input = document.createElement("input");
    input.type = "checkbox";
    input.name = site;
    input.checked = !current.disabled.includes(site);
    label.append(input, names[site]);
    field.append(label);
  }
  (form.elements.namedItem("mode") as RadioNodeList).value = current.mode;
  language.value = current.language;
  form.onchange = () => {
    const data = new FormData(form);
    const previousLanguage = current.language;
    current = settings({
      mode: data.get("mode") === "smart" ? "smart" : "preventive",
      disabled: sites.filter((s) => !data.has(s)),
      language: language.value as Language,
    });
    if (previousLanguage !== current.language) renderLanguage();
    void api.storage.local.set({ settings: current });
  };
  renderLanguage();
  document.querySelector("main")!.hidden = false;
  await status("status");
}
async function status(type: string) {
  sync.disabled = true;
  try {
    const info = await api.runtime.sendMessage({ type });
    syncStatus = { lastSync: info?.cursor?.lastSync, failed: Boolean(info?.syncError || info?.error) };
  } catch {
    syncStatus = { lastSync: syncStatus?.lastSync, failed: true };
  } finally {
    renderStatus();
    sync.disabled = false;
  }
}
sync.onclick = () => void status("sync");
void init();
