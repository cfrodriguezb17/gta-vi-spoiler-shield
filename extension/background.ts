import { api } from "./api";
import { apply, cursor, type Cursor } from "./db";
import { modelVersion } from "../shared/model";
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
async function download() {
  let base = await cursor();
  if (base?.modelVersion !== modelVersion) base = undefined;
  let res = await request(base);
  if (base && res.status === 410) {
    base = undefined;
    res = await request();
  }
  if (!res.ok) throw Error("HTTP " + res.status);
  let batch = await res.json();
  if (base && batch.modelVersion !== base.modelVersion) {
    base = undefined;
    res = await request();
    if (!res.ok) throw Error("HTTP " + res.status);
    batch = await res.json();
  }
  await apply(batch, base);
  invalidate();
  worker?.postMessage({ refresh: true });
  const changed = !base || base.version !== batch.version;
  await api.storage.local.set({
    syncError: null,
    ...(changed ? { catalogVersion: { version: batch.version, modelVersion, committedAt: Date.now() } } : {}),
  });
}
function sync() {
  return (running ??= download()
    .catch(async (error) => {
      await api.storage.local.set({ syncError: String(error.message) });
    })
    .finally(() => {
      running = undefined;
    }));
}
function start() {
  api.alarms.create("catalog", { periodInMinutes: 60 });
  void sync();
}
api.runtime.onInstalled.addListener(start);
api.runtime.onStartup.addListener(start);
api.alarms.onAlarm.addListener((alarm: any) => {
  if (alarm.name === "catalog") void sync();
});
api.runtime.onMessage.addListener((msg: any, _sender: any, respond: (r: any) => void) => {
  const handle = async () => {
    if (msg.type === "sync") await sync();
    if (msg.type === "status" || msg.type === "sync")
      return { cursor: await cursor(), ...(await api.storage.local.get("syncError")) };
    if (msg.type === "classify") return await detect(msg);
  };
  handle().then(respond, () => respond({ error: true }));
  return true;
});
