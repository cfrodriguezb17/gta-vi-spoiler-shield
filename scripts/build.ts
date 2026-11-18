import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { version } from "../package.json";
import { selectors } from "../extension/adapters";
const endpoint = new URL(process.env.CATALOG_URL ?? "http://127.0.0.1:5071");
if (
  endpoint.protocol !== "https:" &&
  !(endpoint.protocol === "http:" && ["localhost", "127.0.0.1"].includes(endpoint.hostname))
)
  throw Error("El catálogo requiere HTTPS o loopback");
if (process.env.RELEASE_BUILD === "1" && (endpoint.protocol !== "https:" ||
  !endpoint.hostname.endsWith(".up.railway.app") || endpoint.href !== endpoint.origin + "/"))
  throw Error("Release builds require the public HTTPS Railway origin in CATALOG_URL");
const domains = {
  reddit: ["reddit.com"],
  youtube: ["youtube.com"],
  x: ["x.com", "twitter.com"],
  facebook: ["facebook.com"],
  instagram: ["instagram.com"],
};
const output = resolve(process.env.EXTENSION_OUT_DIR ?? "dist");
const locales = ["en", "es"];
const icons = Object.fromEntries([16, 32, 48, 128].map((size) => [size, `art/shield-${size}.png`]));
const artwork = [
  ...Object.values(icons),
  "art/bay-at-dusk.webp",
  "art/barlow-condensed-bold-italic.woff2",
  "art/barlow-OFL.txt",
];
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
  await mkdir(resolve(dir, "art"), { recursive: true });
  await Promise.all(
    ["popup.html", "popup.css", "notice.css", ...artwork].map((n) => copyFile("extension/" + n, dir + "/" + n)),
  );
  await copyFile("shared/vector.wasm", dir + "/vector.wasm");
  for (const locale of locales) {
    const path = "_locales/" + locale;
    await mkdir(dir + "/" + path, { recursive: true });
    await copyFile("extension/" + path + "/messages.json", dir + "/" + path + "/messages.json");
  }
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
    name: "__MSG_extensionName__",
    version,
    description: "__MSG_extensionDescription__",
    default_locale: "en",
    permissions: ["storage", "alarms"],
    host_permissions: [
      (browser === "firefox" ? endpoint.protocol + "//" + endpoint.hostname : endpoint.origin) + "/*",
    ],
    icons,
    action: { default_popup: "popup.html", default_icon: icons },
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
    ...artwork,
    ...locales.map((locale) => "_locales/" + locale + "/messages.json"),
    ...Object.keys(domains).map((site) => site + ".css"),
  ];
  const proc =
    process.platform === "win32"
      ? Bun.spawn(["tar", "-a", "-cf", zip, "-C", dir, ...members])
      : Bun.spawn(["zip", "-q", "-FS", zip, ...members], { cwd: dir });
  if ((await proc.exited) !== 0) throw Error("No se pudo crear " + zip);
  console.log(browser + " -> " + zip);
}
