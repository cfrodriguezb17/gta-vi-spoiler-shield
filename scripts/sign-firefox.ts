import { createHmac, randomUUID } from "node:crypto";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const issuer = process.env.WEB_EXT_API_KEY;
const secret = process.env.WEB_EXT_API_SECRET;
if (!issuer || !secret) throw Error("Missing Mozilla signing credentials");

const source = process.argv[2];
if (!source || !(await Bun.file(source).exists())) throw Error("Missing Firefox source archive");
const manifest = await Bun.file("dist/firefox/manifest.json").json();
const { version } = manifest;
const id = manifest.browser_specific_settings.gecko.id;
const amo = new URL("https://addons.mozilla.org");
const lookup = new URL(`/api/v5/addons/addon/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}/`, amo);

function auth() {
  const encode = (data: object) => Buffer.from(JSON.stringify(data)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const token = `${encode({ alg: "HS256" })}.${encode({ iss: issuer, iat: now, exp: now + 60, jti: randomUUID() })}`;
  return `JWT ${token}.${createHmac("sha256", secret!).update(token).digest("base64url")}`;
}

async function get(url: URL) {
  if (url.origin !== amo.origin || url.username || url.password) throw Error("Unexpected Mozilla download URL");
  for (const delay of [0, 2000, 5000, 12000]) {
    if (delay) await Bun.sleep(delay);
    const response = await fetch(url, {
      headers: { Authorization: auth(), Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    }).catch(() => undefined);
    if (response && response.status !== 429 && response.status < 500) return response;
    await response?.body?.cancel();
  }
  throw Error("Mozilla did not respond after retries");
}

async function lookupVersion() {
  const response = await get(lookup);
  if (response.status === 404) return undefined;
  if (!response.ok) throw Error(`Mozilla version check returned HTTP ${response.status}`);
  const entry = await response.json();
  if (entry.version !== version || entry.channel !== "unlisted" || entry.is_disabled)
    throw Error("Unexpected Mozilla version status");
  return entry;
}

if (await lookupVersion()) {
  console.log(`Resuming the Mozilla submission for ${version}`);
} else {
  const staging = await mkdtemp(join(tmpdir(), "shield-firefox-sign-"));
  try {
    const extension = join(staging, "extension");
    await cp("dist/firefox", extension, { recursive: true });
    const upload = Bun.spawn([
      "bunx", "--package", "web-ext@10.8.0", "web-ext", "sign", "--source-dir", extension,
      "--channel", "unlisted", "--upload-source-code", source, "--artifacts-dir", join(staging, "signed"),
      "--approval-timeout", "0",
    ], { stdout: "inherit", stderr: "inherit" });
    if (await upload.exited) throw Error("Firefox submission failed");
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

console.log(`Waiting for Mozilla to approve ${version}`);
const end = Date.now() + 60 * 60 * 1000;
for (;;) {
  const entry = await lookupVersion();
  if (entry?.file?.status === "public") {
    if (!entry.source || typeof entry.file.url !== "string") throw Error("Mozilla version lacks a source or download");
    const signed = await get(new URL(entry.file.url));
    if (!signed.ok) throw Error(`Mozilla download returned HTTP ${signed.status}`);
    const bytes = await signed.arrayBuffer();
    if (!bytes.byteLength) throw Error("Mozilla returned an empty XPI");
    await Bun.write("dist/firefox.xpi", bytes);
    console.log(`Downloaded signed Firefox ${version}`);
    break;
  }
  if (Date.now() >= end) throw Error(`Mozilla approval for ${version} is still pending`);
  await Bun.sleep(15000);
}
