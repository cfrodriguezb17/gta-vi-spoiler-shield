import { api, settings, sites } from "./api";
const field = document.querySelector("#networks")!,
  progress = document.querySelector<HTMLInputElement>("#progress")!,
  form = document.querySelector("form")!,
  out = document.querySelector("output")!,
  sync = document.querySelector<HTMLButtonElement>("#sync")!;
const names = { reddit: "Reddit", youtube: "YouTube", x: "X", facebook: "Facebook", instagram: "Instagram" };
async function init() {
  const current = settings((await api.storage.local.get("settings")).settings);
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
  progress.value = current.progress?.toString() ?? "";
  form.onchange = () => {
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    void api.storage.local.set({
      settings: {
        mode: data.get("mode"),
        disabled: sites.filter((s) => !data.has(s)),
        progress: progress.value === "" ? null : progress.valueAsNumber,
      },
    });
  };
  await status("status");
}
async function status(type: string) {
  sync.disabled = true;
  try {
    const info = await api.runtime.sendMessage({ type });
    const last = info?.cursor?.lastSync;
    out.textContent =
      (last
        ? "Última sincronización · " + new Date(last).toLocaleString("es")
        : "Aún no hay un catálogo sincronizado.") + (info?.syncError ? " No se pudo actualizar." : "");
  } finally {
    sync.disabled = false;
  }
}
sync.onclick = () => void status("sync");
void init();
