import { modelVersion, validEvent } from "../shared/model";

const base = process.env.CATALOG_URL;
if (!base) throw Error("Set CATALOG_URL");
async function get(path: string, status: number) {
  const res = await fetch(new URL(path, base), { redirect: "error", signal: AbortSignal.timeout(10000) });
  if (res.status !== status) throw Error(`${path} returned ${res.status}, expected ${status}`);
  return res;
}
await get("/health/live", 204);
const ready = await get("/health/ready", 204);
if (process.env.EXPECT_REVISION && ready.headers.get("X-Catalog-Revision") !== process.env.EXPECT_REVISION)
  throw Error("The running API does not match the release commit");
const full = await (await get("/api/spoilers", 200)).json();
if (!Number.isSafeInteger(full.version) || full.version < 0 || full.modelVersion !== modelVersion ||
    !Array.isArray(full.added) || !full.added.every(validEvent) || full.updated?.length !== 0 || full.deleted?.length !== 0)
  throw Error("Invalid snapshot");
const delta = await (await get("/api/spoilers?since=" + full.version, 200)).json();
if (delta.version < full.version || delta.modelVersion !== modelVersion ||
    ![delta.added, delta.updated, delta.deleted].every(Array.isArray)) throw Error("Invalid delta");
await get("/api/spoilers?since=9223372036854775807", 410);
await get("/api/spoilers?since=-1", 400);
await get("/api/spoilers?since=1&since=2", 400);
await get("/api/world", 200);
console.log(`Catalog v${full.version}, ${full.added.length} published events. Health, cursor and recovery checks passed.`);
