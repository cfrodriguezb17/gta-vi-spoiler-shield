import { modelVersion, validEvent, type StoryEvent } from "../shared/model";
export type Batch = {
  version: number;
  modelVersion: string;
  added: StoryEvent[];
  updated: StoryEvent[];
  deleted: string[];
};
export type Cursor = { version: number; modelVersion: string; lastSync: string };
let opening: Promise<IDBDatabase> | undefined;
function open() {
  return (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("vi-catalog", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("events", { keyPath: "id" });
      req.result.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      opening = undefined;
      reject(req.error);
    };
  }));
}
function read<T>(req: IDBRequest<T>) {
  return new Promise<T>((ok, fail) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}
export async function cursor() {
  return await read<Cursor | undefined>((await open()).transaction("meta").objectStore("meta").get("cursor"));
}
export async function events() {
  const tx = (await open()).transaction(["meta", "events"]);
  const [meta, rows] = await Promise.all([
    read<Cursor | undefined>(tx.objectStore("meta").get("cursor")),
    read<StoryEvent[]>(tx.objectStore("events").getAll()),
  ]);
  if (meta && meta.modelVersion !== modelVersion) throw Error("Catálogo local incompatible");
  return rows;
}
export async function apply(batch: Batch, base?: Cursor) {
  if (
    !batch ||
    batch.modelVersion !== modelVersion ||
    !Number.isSafeInteger(batch.version) ||
    batch.version < (base?.version ?? 0) ||
    !Array.isArray(batch.added) ||
    !Array.isArray(batch.updated) ||
    !Array.isArray(batch.deleted) ||
    ![...batch.added, ...batch.updated].every(validEvent) ||
    !batch.deleted.every((x) => typeof x === "string")
  )
    throw Error("Catálogo incompatible");
  const ids = [...batch.added, ...batch.updated].map((e) => e.id).concat(batch.deleted);
  if (new Set(ids).size !== ids.length) throw Error("Lote ambiguo");
  const db = await open(),
    tx = db.transaction(["meta", "events"], "readwrite");
  const done = new Promise<void>((ok, fail) => {
    tx.oncomplete = () => ok();
    tx.onabort = () => fail(tx.error ?? Error("Cursor modificado"));
  });
  const meta = tx.objectStore("meta"),
    store = tx.objectStore("events"),
    req = meta.get("cursor");
  req.onsuccess = () => {
    if (base && (req.result?.version !== base.version || req.result?.modelVersion !== base.modelVersion)) {
      tx.abort();
      return;
    }
    if (!base) store.clear();
    for (const id of batch.deleted) store.delete(id);
    for (const e of [...batch.added, ...batch.updated]) store.put(e);
    meta.put({ version: batch.version, modelVersion, lastSync: new Date().toISOString() }, "cursor");
  };
  await done;
}
