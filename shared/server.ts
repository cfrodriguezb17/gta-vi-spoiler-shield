import { embed, kernel, modelVersion } from "./model";
const wasm = await kernel(await Bun.file(new URL("./vector.wasm", import.meta.url)).arrayBuffer());
Bun.serve({
  hostname: process.env.EMBED_HOST ?? "127.0.0.1",
  port: Number(process.env.EMBED_PORT ?? 5072),
  maxRequestBodySize: 65536,
  async fetch(request) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/embed")
      return new Response(null, { status: 404 });
    const input = await request.json().catch(() => null);
    if (typeof input?.text !== "string") return new Response(null, { status: 400 });
    return Response.json({ modelVersion, vector: embed(input.text, wasm) });
  },
});
