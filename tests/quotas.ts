const base = process.env.CATALOG_URL;
if (!base) throw Error("Set CATALOG_URL to a disposable test API");
// smoke.ts already requested one snapshot and several deltas from this address.
async function expectQuota(path: string, attempts: number) {
  for (let i = 0; i < attempts; i++) {
    const r = await fetch(new URL(path, base));
    await r.arrayBuffer();
    if (r.status === 429 && Number(r.headers.get("Retry-After")) > 0) return;
    if (!r.ok) throw Error("Unexpected status " + r.status);
  }
  throw Error("Missing quota for " + path);
}
await expectQuota("/api/spoilers", 11);
await expectQuota("/api/world", 61);
console.log("Snapshot and total read quotas enforced.");
