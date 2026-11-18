import { api } from "./api";
import { apply, cursor, events, type Cursor } from "./db";
import { catalogParticipantTokens, modelVersion } from "../shared/model";
import { classify, invalidate, type Query } from "./classifier";
declare const ENDPOINT: string;
let running: Promise<void> | undefined,
  worker: Worker | undefined,
  nextId = 0;
const waiting = new Map<number, (value: unknown) => void>();
function detect(input: Query) {
  if (typeof document === "undefined") return classify(input, api.runtime.getURL("vector.wasm"));
  if (!worker) {
    worker = new Worker(api.runtime.getURL("worker.js"));
    worker.onmessage = ({ data }) => {
      waiting.get(data.id)?.(data.result);
      waiting.delete(data.id);
    };
    worker.onerror = () => {
      for (const finish of waiting.values()) finish({ error: true });
      waiting.clear();
      worker?.terminate();
      worker = undefined;
    };
  }
  const id = ++nextId;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    worker!.postMessage({ id, input });
  });
}
async function request(base?: Cursor) {
  return fetch(ENDPOINT + "/api/spoilers" + (base ? "?since=" + base.version : ""), {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
}

class SyncError extends Error {
  constructor(message: string, readonly retryAt = 0) { super(message); }
}

function requireSuccess(res: Response) {
  if (res.ok) return;
  const header = res.headers.get("Retry-After")?.trim();
  let retryAt = 0;
  if (header && (res.status === 429 || res.status === 503)) {
    retryAt = /^\d+$/.test(header) ? Date.now() + Number(header) * 1000 : Date.parse(header);
    if (!Number.isFinite(retryAt)) retryAt = 0;
  }
  throw new SyncError("HTTP " + res.status, retryAt);
}

async function download() {
  let base = await cursor();
  if (base?.modelVersion !== modelVersion || base?.origin !== ENDPOINT) base = undefined;
  let res = await request(base);
  if (base && res.status === 410) {
    base = undefined;
    res = await request();
  }
  requireSuccess(res);
  let batch = await res.json();
  if (base && batch.modelVersion !== base.modelVersion) {
    base = undefined;
    res = await request();
    requireSuccess(res);
    batch = await res.json();
  }
  await apply(batch, ENDPOINT, base);
  invalidate();
  worker?.postMessage({ refresh: true });
  const changed = !base || base.version !== batch.version;
  await api.storage.local.set({
    syncError: null,
    ...(changed ? { catalogVersion: { version: batch.version, modelVersion, committedAt: Date.now() } } : {}),
  });
}
async function attempt(manual: boolean) {
  const { catalogRetry: saved } = await api.storage.local.get("catalogRetry");
  const retry = saved?.origin === ENDPOINT ? saved : undefined;
  if (retry && Date.now() < (manual ? retry.requiredUntil : retry.when)) {
    await api.alarms.create("catalog-retry", { when: retry.when });
    return;
  }
  try {
    await download();
  } catch (error) {
    const count = Math.min(7, (retry?.count ?? 0) + 1);
    const requiredUntil = error instanceof SyncError ? error.retryAt : 0;
    const delay = Math.min(3600000, 30000 * 2 ** (count - 1));
    const when = Math.max(Date.now() + delay, requiredUntil) + Math.floor(Math.random() * 30000);
    await api.storage.local.set({
      syncError: error instanceof Error ? error.message : "Download failed",
      catalogRetry: { origin: ENDPOINT, count, requiredUntil, when },
    });
    await api.alarms.create("catalog-retry", { when });
    return;
  }
  await api.storage.local.remove("catalogRetry");
  await api.alarms.clear("catalog-retry");
}
function sync(manual = false) {
  return (running ??= attempt(manual).finally(() => { running = undefined; }));
}

function start() {
  api.alarms.create("catalog", { periodInMinutes: 60 });
  void sync();
}
api.runtime.onInstalled.addListener(start);
api.runtime.onStartup.addListener(start);
api.alarms.onAlarm.addListener((alarm: any) => {
  if (alarm.name === "catalog" || alarm.name === "catalog-retry") void sync();
});
api.runtime.onMessage.addListener((msg: any, _sender: any, respond: (r: any) => void) => {
  const handle = async () => {
    if (msg.type === "sync") await sync(true);
    if (msg.type === "status" || msg.type === "sync")
      return { cursor: await cursor(), ...(await api.storage.local.get("syncError")) };
    if (msg.type === "classify") return await detect(msg);
    if (msg.type === "participantTokens") return catalogParticipantTokens(await events());
  };
  handle().then(respond, () => respond({ error: true }));
  return true;
});
