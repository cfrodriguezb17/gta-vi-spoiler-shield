// Install the distribution builds, serve fixture cards under the real host names
// using per-profile loopback DNS, and serve test catalog batches on loopback.
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { kernel, embed, modelVersion } from "../shared/model";
const root = await mkdtemp(join(tmpdir(), "vi-browser-"));
const builds = resolve(process.env.EXTENSION_OUT_DIR ?? "dist");
const catalogUrl = new URL(process.env.CATALOG_URL ?? "http://127.0.0.1:5071");
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T>, label: string, ms = 12000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await delay(100);
  }
  throw Error(label + " timed out " + (last ?? ""));
}
const ssl = process.env.OPENSSL ?? "openssl";
const cert = join(root, "cert.pem"),
  key = join(root, "key.pem");
const gen = Bun.spawn(
  [
    ssl,
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-out",
    cert,
    "-keyout",
    key,
    "-days",
    "1",
    "-subj",
    "/CN=fixture.invalid",
  ],
  { stderr: "pipe" },
);
if ((await gen.exited) !== 0) throw Error(await new Response(gen.stderr).text());
const cases = [
  ["www.reddit.com", "shreddit-post", "", "/r/gaming/comments/"],
  ["www.youtube.com", "ytd-rich-item-renderer", "", "/watch?v="],
  ["x.com", "article", 'data-testid="tweet"', "/fixture/status/"],
  ["www.facebook.com", "article", 'role="article"', "/fixture/posts/"],
  ["www.instagram.com", "article", "", "/p/"],
];
const trackNotices = `<script>
  window.fixtureNoticeCount = 0;
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element && node.hasAttribute("data-vi-notice")) {
          window.fixtureNoticeCount++;
        }
      }
    }
  }).observe(document, { subtree: true, childList: true });
</script>`;
const fixtures = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  tls: { cert: await readFile(cert), key: await readFile(key) },
  fetch(req) {
    const url = new URL(req.url);
    const [, tag, attrs, permalink] = cases.find(([host]) => host === url.hostname) ?? cases[0];
    const disguised = url.searchParams.has("disguised");
    const title = disguised ? "GТΑ V\u200bІ" : "GTA VI";
    const story = url.searchParams.has("harmless")
      ? "the official trailer is available"
      : disguised ? "Rhеa tr@ici0n4 a M1l0" : "Rhea betrays Milo";
    const link = url.searchParams.has("permalink")
      ? `<a id="permalink" href="${permalink}101"><time>Posted today</time></a>`
      : "";
    const content = `<span>${title}: ${story}</span><img alt="private thumbnail"><video></video>${link}`;
    const nested = url.searchParams.has("nested");
    const wrapped = nested ? `<yt-lockup-view-model>${content}</yt-lockup-view-model>` : content;
    return new Response(
      `<!doctype html><html><head>
        <style>body{height:300vh}section,article,shreddit-post,ytd-rich-item-renderer{display:block}</style>
        ${trackNotices}
        </head><body><${tag} ${attrs} id="story" ${nested ? `aria-label="${title}"` : ""}>${wrapped}</${tag}></body></html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  },
});
const wasm = await kernel(await Bun.file("shared/vector.wasm").arrayBuffer());
const event = {
  id: "one",
  description: "Rhea betrays Milo",
  participants: [
    { name: "Rhea", role: "actor", aliases: [] },
    { name: "Milo", role: "target", aliases: [] },
  ],
  action: "betray",
  forms: [],
  negated: false,
  mission: 7,
  severity: 5,
  confidence: 0.95,
  status: "confirmed",
  vector: embed("Rhea betrays Milo", wasm),
};
let version = 1,
  offline = false,
  fault: "invalid" | "expired" | "model" | null = null;
const requests: { url: string; method: string; cookie: string | null; referer: string | null }[] = [];
const catalog = Bun.serve({
  hostname: catalogUrl.hostname,
  port: Number(catalogUrl.port),
  fetch(req) {
    requests.push({
      url: req.url,
      method: req.method,
      cookie: req.headers.get("cookie"),
      referer: req.headers.get("referer"),
    });
    if (offline) return new Response(null, { status: 503 });
    const u = new URL(req.url);
    if (u.pathname !== "/api/spoilers") return new Response(null, { status: 404 });
    const since = u.searchParams.get("since");
    if (since !== null && fault === "expired") return new Response(null, { status: 410 });
    if (since !== null && fault === "model")
      return Response.json({ version, modelVersion: "old-fixture-model" });
    if (fault === "invalid")
      return Response.json({
        version: 3,
        modelVersion,
        added: [{ ...event, vector: [1] }],
        updated: [],
        deleted: ["one"],
      });
    const item = { ...event, mission: version === 2 ? 8 : 7 };
    return Response.json({
      version,
      modelVersion,
      added: version < 3 && (since === null || +since < 1) ? [item] : [],
      updated: version === 2 && since === "1" ? [item] : [],
      deleted: version === 3 && since !== null && +since < 3 ? ["one"] : [],
    });
  },
});
type Driver = {
  go: (url: string) => Promise<void>;
  js: (code: string) => Promise<any>;
  key: (key: string) => Promise<void>;
  panel: string;
  close: () => Promise<void>;
  ax?: () => Promise<string>;
};
async function chrome(): Promise<Driver> {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
  const dir = join(root, "chrome-extension");
  await (await import("node:fs/promises")).mkdir(dir);
  if ((await Bun.spawn(["tar", "-xf", join(builds, "chrome.zip"), "-C", dir]).exited) !== 0)
    throw Error("Cannot extract Chrome ZIP");
  const flags = process.env.CHROME_CDP_INSTALL
    ? ["--enable-unsafe-extension-debugging"]
    : ["--disable-extensions-except=" + dir, "--load-extension=" + dir];
  const context = await chromium.launchPersistentContext(join(root, "chromium"), {
    executablePath: process.env.CHROMIUM,
    channel: "chromium",
    headless: true,
    ignoreHTTPSErrors: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      "--no-first-run",
      "--no-proxy-server",
      "--disable-background-networking",
      ...flags,
      "--host-resolver-rules=" + cases.map(([h]) => "MAP " + h + " 127.0.0.1").join(","),
    ],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const cdp = await context.newCDPSession(page);
  if (process.env.CHROME_CDP_INSTALL) {
    const browserSession = await context.browser().newBrowserCDPSession();
    await browserSession.send("Extensions.loadUnpacked", { path: dir });
  }
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 10000 }).catch(async (e: any) => {
      console.error(await page.locator("body").ariaSnapshot());
      await context.close();
      throw e;
    }));
  return {
    go: async (url) => {
      await page.goto(url);
    },
    js: (code) => page.evaluate(code),
    key: (k) => page.keyboard.press(k),
    panel: new URL("popup.html", worker.url()).href,
    ax: async () =>
      (await cdp.send("Accessibility.getFullAXTree")).nodes
        .filter((node: any) => !node.ignored)
        .map((node: any) => node.name?.value)
        .join(" "),
    close: () => context.close(),
  };
}
async function firefox(): Promise<Driver> {
  const { createServer } = await import("node:net");
  const port = await new Promise<number>((ok) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as any).port;
      s.close(() => ok(p));
    });
  });
  const profile = join(root, "firefox");
  await (await import("node:fs/promises")).mkdir(profile);
  const uuid = "bf2837e3-badd-40db-9099-124615aa50cb";
  const prefs: Record<string, unknown> = {
    "network.dns.localDomains": cases.map((x) => x[0]).join(","),
    "network.proxy.type": 0,
    "network.trr.mode": 5,
    "extensions.webextensions.uuids": JSON.stringify({ "gta-vi-shield@local.invalid": uuid }),
    "browser.shell.checkDefaultBrowser": false,
    "app.update.enabled": false,
    "browser.startup.page": 0,
  };
  await writeFile(
    join(profile, "user.js"),
    Object.entries(prefs)
      .map(([k, v]) => "user_pref(" + JSON.stringify(k) + "," + JSON.stringify(v) + ");")
      .join("\n"),
  );
  const proc = Bun.spawn(
    [
      process.env.FIREFOX ?? "firefox",
      "-headless",
      "-no-remote",
      "-profile",
      profile,
      "-remote-allow-system-access",
      "--remote-debugging-port",
      String(port),
      "about:blank",
    ],
    { env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" }, stdout: "ignore", stderr: "inherit" },
  );
  let ws: WebSocket | undefined;
  try {
    ws = await until(
      () =>
        new Promise<WebSocket | false>((ok) => {
          const s = new WebSocket("ws://127.0.0.1:" + port + "/session");
          s.onopen = () => ok(s);
          s.onerror = () => ok(false);
        }),
      "Firefox BiDi",
      25000,
    );
    const pending = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
    let id = 0;
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)),
        p = pending.get(m.id);
      if (m.method === "log.entryAdded" && m.params.level === "error") console.error(m.params.text);
      if (!p) return;
      pending.delete(m.id);
      if (m.type === "error") p.fail(Error(m.error + " " + m.message));
      else p.ok(m.result);
    };
    function call(method: string, params: object): Promise<any> {
      return new Promise((ok, fail) => {
        pending.set(++id, { ok, fail });
        ws!.send(JSON.stringify({ id, method, params }));
      });
    }
    await call("session.new", { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
    await call("session.subscribe", { events: ["log.entryAdded"] });
    const archive = join(root, "shield.xpi");
    await writeFile(archive, await readFile(join(builds, "firefox.zip")));
    await call("webExtension.install", { extensionData: { type: "path", path: archive } });
    const { contexts } = await call("browsingContext.getTree", {}),
      context = contexts[0].context;
    return {
      go: async (url) => {
        if (!url.startsWith("moz-extension:")) {
          await call("browsingContext.navigate", { context, url, wait: "complete" });
          return;
        }
        if ((await call("browsingContext.getTree", { root: context })).contexts[0].url === url) return;
        const chromeTree = await call("browsingContext.getTree", { "moz:scope": "chrome" });
        const windowCtx = chromeTree.contexts.find((c: any) => c.url.includes("browser.xhtml"));
        if (!windowCtx) throw Error("Browser window missing " + JSON.stringify(chromeTree));
        const nav = await call("script.evaluate", {
          target: { context: windowCtx.context },
          expression: "window.gURLBar.value=" + JSON.stringify(url) + ";window.gURLBar.handleCommand();true",
          awaitPromise: false,
        });
        if (nav.type === "exception") throw Error(nav.exceptionDetails.text);
        await until(
          async () => (await call("browsingContext.getTree", { root: context })).contexts[0].url === url,
          "Firefox panel",
        );
      },
      js: async (expression) => {
        const v = await call("script.evaluate", { expression, target: { context }, awaitPromise: true });
        if (v.type === "exception") throw Error(v.exceptionDetails.text);
        return v.result.value;
      },
      key: async (k) => {
        const value = k === "Tab" ? "\uE004" : "\uE006";
        await call("input.performActions", {
          context,
          actions: [
            {
              type: "key",
              id: "kb",
              actions: [
                { type: "keyDown", value },
                { type: "keyUp", value },
              ],
            },
          ],
        });
      },
      ax: async () => {
        const names = ["Mostrar", "private thumbnail", "GTA VI: Rhea betrays Milo"],
          found = [];
        for (const name of names) {
          const matches = await call("browsingContext.locateNodes", {
            context,
            locator: { type: "accessibility", value: { name } },
          });
          if (matches.nodes.length) found.push(name);
        }
        return found.join(" ");
      },
      panel: "moz-extension://" + uuid + "/popup.html",
      close: async () => {
        ws!.close();
        proc.kill();
        await proc.exited;
      },
    };
  } catch (e) {
    ws?.close();
    proc.kill();
    throw e;
  }
}
try {
  for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ["chrome", "firefox"]) {
    version = 1;
    offline = false;
    fault = null;
    const d = await (name === "firefox" ? firefox() : chrome());
    try {
      const url = (host: string) => "https://" + host + ":" + fixtures.port + "/fixture";
      const state = (hidden: boolean) =>
        until(
          () =>
            d.js(
              "!!document.querySelector('#story[data-vi-checked]') && (getComputedStyle(document.querySelector('#story')).display==='none')===" +
                hidden +
                " && !!document.querySelector('[data-vi-notice]')===" +
                hidden,
            ),
          name + " covered=" + hidden,
        ).catch(async (e) => {
          const details = await d.js(
            "JSON.stringify({url:location.href, card:document.querySelector('#story')?.outerHTML, notices:window.fixtureNoticeCount})",
          );
          throw Error(e.message + " " + details);
        });
      async function revealWhileUpdating(host: string, permalink: string) {
        await d.go(url(host) + "?permalink" + (host === "www.youtube.com" ? "&nested" : ""));
        await state(true);
        await d.js(`
          document.addEventListener('click', () => {
            document.querySelector('#story span').append(' (caption updated)');
            document.querySelector('#story img').src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
          }, { capture: true, once: true });
          document.querySelector('[data-vi-notice] button').click();
        `);
        await state(false);
        await d.js("document.querySelector('#story img').alt='thumbnail loaded'");
        await state(false);
        await d.js(`document.querySelector('#permalink').setAttribute('href', ${JSON.stringify(permalink + "102")})`);
        await state(true);
        await d.js(`
          document.addEventListener('click', () => {
            document.querySelector('#permalink').setAttribute('href', ${JSON.stringify(permalink + "103")});
          }, { capture: true, once: true });
          document.querySelector('[data-vi-notice] button').click();
        `);
        await state(true);
      }
      for (const [host, , , permalink] of cases) {
        await d.go(url(host));
        await state(true);
        await d.js(
          "window.originalNotice=document.querySelector('[data-vi-notice]');document.querySelector('#story span').append(' (updated)')",
        );
        await state(true);
        if (!(await d.js("document.querySelector('[data-vi-notice]')===window.originalNotice")))
          throw Error(name + " recreated the notice after a harmless card update");
        await d.js("window.originalNotice.remove()");
        await state(true);
        if (d.ax) {
          const ax = await d.ax();
          if (ax.includes("betrays") || ax.includes("thumbnail") || !ax.includes("Mostrar"))
            throw Error("accessibility tree " + ax);
        }
        await d.js(
          "window.fixturePlayed=false;const v=document.querySelector('video'),canvas=document.createElement('canvas');v.muted=true;v.addEventListener('play',()=>window.fixturePlayed=true,{once:true});v.srcObject=canvas.captureStream(5);canvas.getContext('2d').fillRect(0,0,20,20);v.play().catch(()=>{});true",
        );
        await until(
          () => d.js("window.fixturePlayed && document.querySelector('video').paused"),
          "media pause",
        );
        await d.js(
          "window.keyTrace=[];for(const type of ['keydown','keyup','click'])document.addEventListener(type,e=>window.keyTrace.push([type,e.key,e.target.tagName,e.isTrusted]),true)",
        );
        await d.key("Tab");
        if (!(await d.js("!!document.activeElement?.closest('[data-vi-notice]')"))) {
          await d.key("Tab");
        }
        if (!(await d.js("!!document.activeElement?.closest('[data-vi-notice]')")))
          throw Error("Keyboard focus: " + (await d.js("document.activeElement?.outerHTML.slice(0,500)")));
        await d.key("Enter");
        await state(false).catch(async (e) => {
          throw Error(
            e.message +
              " " +
              (await d.js(
                "JSON.stringify([window.keyTrace,document.activeElement?.tagName,document.querySelector('#story')?.outerHTML])",
              )),
          );
        });
        await d.js(
          "document.querySelector('#story span').textContent='GTA VI: replacement post';history.pushState({},'', '/new-route')",
        );
        await state(true);
        await d.js(
          "const next=document.querySelector('#story').cloneNode(true); next.id='more';next.removeAttribute('data-vi-checked');next.removeAttribute('data-vi-covered');document.body.append(next);scrollTo(0,document.body.scrollHeight)",
        );
        await until(() => d.js("document.querySelectorAll('[data-vi-notice]').length===2"), "infinite feed");
        await d.go(url(host) + "?disguised");
        await state(true);
        await revealWhileUpdating(host, permalink);
        console.log(name, host, "cover / keyboard / reveal during update / reuse / SPA / disguised title passed");
      }
      async function panel(code: string) {
        await d.go(d.panel);
        await until(
          () =>
            d.js(
              "!!document.querySelector('input[name=instagram]') && !document.querySelector('#sync').disabled",
            ),
          "popup",
        );
        await d.js(code);
      }
      async function sync() {
        await panel("document.querySelector('#sync').click()");
        await until(() => d.js("!document.querySelector('#sync').disabled"), "sync");
      }
      const progress = (n: number) =>
        "const v=document.querySelector('#progress');v.value='" +
        n +
        "';v.dispatchEvent(new Event('change',{bubbles:true}))";
      await sync();
      const initialStatus = await d.js(
        "(globalThis.browser??chrome).runtime.sendMessage({type:'status'}).then(JSON.stringify)",
      );
      if (!JSON.parse(initialStatus)?.cursor) throw Error("Initial sync " + initialStatus);
      const detection = await d.js(
        "(globalThis.browser??chrome).runtime.sendMessage({type:'classify',text:'Rhea traiciona a Milo',context:'GTA VI',progress:null}).then(r=>r.hide)",
      );
      if (detection !== true) throw Error("Bilingual classification from the cached catalog failed");
      await panel("document.querySelector('[value=smart]').click()");
      for (const [host, , , permalink] of cases) {
        for (const query of ["?harmless", "?harmless&disguised"]) {
          await d.go(url(host) + query);
          await state(false);
          if ((await d.js("window.fixtureNoticeCount")) !== 0)
            throw Error(name + " flashed a warning for benign GTA VI content on " + host);
        }
        await d.go(url(host) + "?disguised");
        await state(true);
        await revealWhileUpdating(host, permalink);
      }
      console.log(name, "smart mode covered disguised spoilers and never warned on benign content across all five sites");
      await d.go(url(cases[0][0]));
      await state(true);
      await panel(progress(7));
      await d.go(url(cases[0][0]));
      await state(false);
      version = 2;
      await sync();
      await d.go(url(cases[0][0]));
      await state(true);
      offline = true;
      await sync();
      await d.go(url(cases[0][0]));
      await state(true);
      await d.js("document.querySelector('#story span').textContent='GTA VI: harmless photo'");
      await state(false);
      offline = false;
      version = 3;
      await sync();
      await d.go(url(cases[0][0]));
      await state(false);
      for (const kind of ["expired", "model"] as const) {
        fault = kind;
        const count = requests.length;
        await sync();
        if (requests.length !== count + 2 || !requests.at(-1)!.url.endsWith("/api/spoilers"))
          throw Error(
            "full refresh " +
              kind +
              " " +
              JSON.stringify(requests.slice(count)) +
              " " +
              (await d.js("document.querySelector('output')?.textContent")),
          );
      }
      fault = "invalid";
      await sync();
      if (!(await d.js("document.querySelector('output').textContent.includes('No se pudo actualizar')")))
        throw Error("malformed catalog accepted");
      await d.go(url(cases[0][0]));
      await state(false);
      await panel(
        "document.querySelector('[value=preventive]').click();document.querySelector('input[name=reddit]').click()",
      );
      await d.go(url(cases[0][0]));
      await state(false);
      await d.go(url(cases[1][0]));
      await state(true);
      console.log(
        name,
        "catalog additions, updates, deletions, offline classification, mission progress passed",
      );
    } finally {
      await d.close();
    }
  }
  if (
    !requests.length ||
    requests.some(
      (r) =>
        r.method !== "GET" ||
        r.cookie ||
        r.referer ||
        new URL(r.url).origin !== catalogUrl.origin ||
        !/^\/api\/spoilers(?:\?since=\d+)?$/.test(r.url.slice(catalogUrl.origin.length)),
    )
  )
    throw Error("unexpected catalog traffic " + JSON.stringify(requests));
  console.log(requests.length, "catalog requests contained only the expected path and optional cursor");
} finally {
  fixtures.stop();
  catalog.stop();
  await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(() => {});
}
