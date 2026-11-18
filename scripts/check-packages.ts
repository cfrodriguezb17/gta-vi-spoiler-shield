import { version } from "../package.json";
const { origin, hostname, protocol } = new URL(process.env.CATALOG_URL ?? "http://127.0.0.1:5071");
const out = process.env.EXTENSION_OUT_DIR ?? "dist";
for (const browser of ["chrome", "firefox"]) {
  const path = out + "/" + browser;
  const manifest = await Bun.file(path + "/manifest.json").json();
  const expectedHost = (browser === "chrome" ? origin : protocol + "//" + hostname) + "/*";
  if (manifest.version !== version || manifest.manifest_version !== 3 ||
      String(manifest.host_permissions) !== expectedHost || String(manifest.permissions) !== "storage,alarms" ||
      manifest.content_scripts.length !== 5 || manifest.default_locale !== "en")
    throw Error("Unexpected manifest for " + browser);
  for (const lang of ["en", "es"]) {
    const messages = await Bun.file(path + "/_locales/" + lang + "/messages.json").json();
    if (!messages.extensionName?.message) throw Error("Missing locale " + lang);
  }
  if (!(await Bun.file(path + "/background.js").text()).includes(origin) ||
      !await WebAssembly.validate(await Bun.file(path + "/vector.wasm").arrayBuffer()))
    throw Error("Invalid endpoint or WASM in " + browser);
}
console.log("Package versions, permissions, locales, endpoint and WASM verified.");
