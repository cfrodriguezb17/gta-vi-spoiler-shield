import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { selectors } from "../extension/adapters";
const endpoint = new URL(process.env.CATALOG_URL ?? "http://127.0.0.1:5071");
if (
  endpoint.protocol !== "https:" &&
  !(endpoint.protocol === "http:" && ["localhost", "127.0.0.1"].includes(endpoint.hostname))
)
  throw Error("El catálogo requiere HTTPS o loopback");
const domains = {
  reddit: ["reddit.com"],
  youtube: ["youtube.com"],
  x: ["x.com", "twitter.com"],
  facebook: ["facebook.com"],
  instagram: ["instagram.com"],
};
const output = resolve(process.env.EXTENSION_OUT_DIR ?? "dist");
for (const browser of ["chrome", "firefox"]) {
  const dir = resolve(output, browser);
  await mkdir(dir, { recursive: true });
  const result = await Bun.build({
    entrypoints: ["content", "background", "popup", "worker"].map((n) => "extension/" + n + ".ts"),
    outdir: dir,
    format: "iife",
    target: "browser",
    define: { ENDPOINT: JSON.stringify(endpoint.origin) },
  });
  if (!result.success) throw new Error(result.logs.join("\n"));
  await Promise.all(
    ["popup.html", "popup.css", "notice.css"].map((n) => copyFile("extension/" + n, dir + "/" + n)),
  );
  await copyFile("shared/vector.wasm", dir + "/vector.wasm");
  const content_scripts = [];
  for (const [key, hosts] of Object.entries(domains)) {
    const css = key + ".css";
    const pending = ":is(" + selectors[key as keyof typeof selectors] + "):not([data-vi-checked])";
    await writeFile(
      dir + "/" + css,
      pending + "," + pending + " *{visibility:hidden!important}[data-vi-covered]{display:none!important}\n",
    );
    content_scripts.push({
      matches: hosts.map((d) => "https://*." + d + "/*"),
      css: [css, "notice.css"],
      js: ["content.js"],
      run_at: "document_start",
    });
  }
  const manifest = {
    manifest_version: 3,
    name: "Protección de spoilers de GTA VI",
    version: "1.0.4",
    description: "Protección local de publicaciones y comentarios en cinco redes.",
    permissions: ["storage", "alarms"],
    host_permissions: [
      (browser === "firefox" ? endpoint.protocol + "//" + endpoint.hostname : endpoint.origin) + "/*",
    ],
    action: { default_popup: "popup.html" },
    content_scripts,
    background: browser === "chrome" ? { service_worker: "background.js" } : { scripts: ["background.js"] },
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "gta-vi-shield@local.invalid",
              strict_min_version: "140.0",
              data_collection_permissions: { required: ["none"] },
            },
          },
        }
      : {}),
  };
  await writeFile(dir + "/manifest.json", JSON.stringify(manifest, null, 2));
  const zip = resolve(output, browser + ".zip");
  const members = [
    "manifest.json",
    "content.js",
    "background.js",
    "worker.js",
    "popup.html",
    "popup.js",
    "popup.css",
    "notice.css",
    "vector.wasm",
    ...Object.keys(domains).map((site) => site + ".css"),
  ];
  const proc =
    process.platform === "win32"
      ? Bun.spawn(["tar", "-a", "-cf", zip, "-C", dir, ...members])
      : Bun.spawn(["zip", "-q", "-FS", zip, ...members], { cwd: dir });
  if ((await proc.exited) !== 0) throw Error("No se pudo crear " + zip);
  console.log(browser + " -> " + zip);
}
